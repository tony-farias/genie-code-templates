from __future__ import annotations

import sys
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_synthetic_x12 import PROVIDER_NAMES, fictional_npi, generate_records
from discover_x12_sources import (
    FILE_KEY_COLUMN,
    assess_bronze_readiness,
    choose_record_key,
    evaluated_candidate,
    feature_coverage,
    key_evidence_for,
    match_likelihood,
    parser_dry_run,
    score_candidate,
    score_record_key_candidate,
    score_volume,
)
from x12_core import classify_x12


class X12CoreTests(unittest.TestCase):
    def test_generated_positive_records_validate(self) -> None:
        records = generate_records(claims=2, seed=42, include_negative=False)
        self.assertEqual(6, len(records))
        for record in records:
            classification = classify_x12(str(record["edi_payload"]))
            self.assertTrue(classification.is_x12)
            self.assertTrue(classification.valid, classification.errors)
            self.assertEqual((record["transaction_type"],), classification.transaction_types)

    def test_negative_records_are_classified(self) -> None:
        records = generate_records(claims=1, seed=42, include_negative=True)
        by_id = {record["record_id"]: record for record in records}
        invalid = classify_x12(str(by_id["synthetic-invalid-se-count"]["edi_payload"]))
        self.assertIn("segment_count_mismatch", invalid.errors)
        unsupported = classify_x12(str(by_id["synthetic-unsupported-4010"]["edi_payload"]))
        self.assertIn("unsupported_version", unsupported.errors)
        empty = classify_x12(str(by_id["synthetic-empty-payload"]["edi_payload"]))
        self.assertEqual(("not_x12",), empty.errors)

    def test_reports_do_not_return_payload(self) -> None:
        payload = str(generate_records(1, 7, False)[0]["edi_payload"])
        safe = classify_x12(payload).safe_dict()
        self.assertNotIn("payload", safe)
        self.assertEqual(64, len(str(safe["fingerprint"])))

    def test_discovery_does_not_sample_every_string_in_x12_table(self) -> None:
        self.assertGreater(score_candidate("x12_demo_source", "edi_payload", "", ""), 0)
        self.assertGreater(score_candidate("x12_demo_source", "value", "", ""), 0)
        self.assertEqual(score_candidate("x12_demo_source", "expected_status", "", ""), 0)
        self.assertEqual(score_candidate("x12_demo_source", "payload_hash", "", ""), 0)
        self.assertEqual(score_candidate("x12_demo_source", "service_date_raw", "", ""), 0)
        self.assertEqual(score_candidate("x12_demo_source", "message_id", "", ""), 0)

    def test_record_key_detection_uses_generic_source_identity(self) -> None:
        columns = [
            {"column_name": "member_id", "data_type": "STRING", "column_comment": "", "ordinal_position": 1},
            {"column_name": "record_id", "data_type": "STRING", "column_comment": "", "ordinal_position": 2},
            {"column_name": "edi_payload", "data_type": "STRING", "column_comment": "", "ordinal_position": 3},
        ]
        selected = choose_record_key(columns, "edi_payload")
        self.assertIsNotNone(selected)
        self.assertEqual("record_id", selected["column_name"])
        self.assertEqual(0, score_record_key_candidate("patient_id"))

    def test_bronze_readiness_is_transparent_and_ready_for_good_sample(self) -> None:
        records = generate_records(claims=10, seed=42, include_negative=False)
        classifications = [classify_x12(str(record["edi_payload"])) for record in records[:25]]
        key_evidence = {
            "column": "record_id",
            "non_null_ratio": 1.0,
            "uniqueness_ratio": 1.0,
        }
        readiness = assess_bronze_readiness(classifications, key_evidence, requested_sample_rows=25)
        self.assertEqual("ready", readiness["status"])
        self.assertEqual(100.0, readiness["score"])
        self.assertEqual("deterministic_sample_readiness_not_probability", readiness["score_type"])
        self.assertEqual([], readiness["blocking_issues"])

    def test_bronze_readiness_requires_stable_source_record_key(self) -> None:
        records = generate_records(claims=10, seed=42, include_negative=False)
        classifications = [classify_x12(str(record["edi_payload"])) for record in records[:25]]
        readiness = assess_bronze_readiness(classifications, None, requested_sample_rows=25)
        self.assertEqual("not_ready", readiness["status"])
        self.assertIn("source_record_key_not_detected", readiness["blocking_issues"])
        self.assertLess(readiness["score"], 100)


    def test_feature_coverage_follows_transaction_mix(self) -> None:
        self.assertEqual(
            {"provider_analysis": "supported", "siu_letters": "supported", "member_utilization": "supported",
             "payment_analysis": "missing", "coverage_context": "missing"},
            feature_coverage(["837"]),
        )
        self.assertNotIn("missing", feature_coverage(["834", "835", "837"]).values())

    def test_match_likelihood_bands(self) -> None:
        coverage = feature_coverage(["837"])
        self.assertEqual("high", match_likelihood({"score": 100, "status": "ready"}, coverage)["band"])
        self.assertEqual("medium", match_likelihood({"score": 75, "status": "needs_review"}, coverage)["band"])
        self.assertEqual("low", match_likelihood({"score": 40, "status": "not_ready"}, coverage)["band"])
        self.assertEqual("unknown", match_likelihood({"score": 0, "status": "access_failed"}, coverage)["band"])
        self.assertEqual(["coverage_context", "payment_analysis"], match_likelihood({"score": 100, "status": "ready"}, coverage)["missing_features"])

    def test_volume_candidate_uses_file_paths_and_never_returns_payloads(self) -> None:
        records = generate_records(claims=10, seed=42, include_negative=False)
        payloads = [str(record["edi_payload"]) for record in records[:25]]
        paths = [f"/Volumes/c/s/v/file_{index}.x12" for index in range(len(payloads))]
        key = key_evidence_for(FILE_KEY_COLUMN, "STRING", 100, paths, len(payloads))
        candidate = evaluated_candidate({"source_kind": "volume", "volume_path": "/Volumes/c/s/v"}, payloads, key, 25, False)
        self.assertEqual("ready", candidate["bronze_readiness"]["status"])
        self.assertEqual("high", candidate["match_likelihood"]["band"])
        serialized = str(candidate)
        self.assertNotIn("ISA*", serialized)
        self.assertNotIn("file_0.x12", serialized)

    def test_parser_dry_run_reports_counts_only(self) -> None:
        result = parser_dry_run([str(generate_records(1, 7, False)[0]["edi_payload"])])
        self.assertIn(result["status"], {"completed", "skipped"})
        self.assertNotIn("ISA*", str(result))

    def test_volume_names_rank_x12_landing_zones_first(self) -> None:
        self.assertGreater(score_volume("x12_inbound", ""), score_volume("images", ""))


    def test_generator_has_realistic_variety_and_fictional_npis(self) -> None:
        records = generate_records(claims=720, seed=42, include_negative=False)
        payloads = [str(record["edi_payload"]) for record in records]
        npis = {segment.split("*")[-1] for payload in payloads for segment in payload.split("~")
                if segment.strip().startswith("NM1*85")}
        self.assertEqual(len(PROVIDER_NAMES), len(npis))
        self.assertTrue(any("CLP*" in payload and "*4*" in payload.split("CLP*", 1)[1][:20] for payload in payloads))
        self.assertGreater(len({payload.split("SV1*HC:", 1)[1][:5] for payload in payloads if "SV1*HC:" in payload}), 8)

        def luhn_valid(npi: str) -> bool:
            digits = [int(d) for d in "80840" + npi]
            total = 0
            for position, digit in enumerate(reversed(digits)):
                doubled = digit * 2 if position % 2 == 1 else digit
                total += doubled - 9 if doubled > 9 else doubled
            return total % 10 == 0

        self.assertFalse(any(luhn_valid(fictional_npi(number)) for number in range(1, len(PROVIDER_NAMES) + 1)))

    def test_generator_is_deterministic(self) -> None:
        self.assertEqual(generate_records(5, 7, True), generate_records(5, 7, True))


if __name__ == "__main__":
    unittest.main()
