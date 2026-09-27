from __future__ import annotations

import sys
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_synthetic_x12 import generate_records
from discover_x12_sources import (
    assess_bronze_readiness,
    choose_record_key,
    score_candidate,
    score_record_key_candidate,
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


if __name__ == "__main__":
    unittest.main()
