#!/usr/bin/env python3
"""Read-only, PHI-safe X12 source discovery for Unity Catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import time
from typing import Any

from x12_core import classify_x12


TOKENS = {"x12": 8, "edi": 8, "837": 7, "835": 7, "834": 7, "payload": 3, "message": 2, "body": 2, "raw": 2}
GENERIC_PAYLOAD_COLUMNS = {"value", "content", "data", "text", "record"}
NON_PAYLOAD_COLUMN_TOKENS = {"hash", "fingerprint", "checksum", "digest"}
STRONG_PAYLOAD_COLUMN_TOKENS = {"x12", "edi", "837", "835", "834", "payload"}
SUPPORTED_TRANSACTION_TYPES = {"837", "835", "834"}
SUPPORTED_VERSION_PREFIXES = ("00501",)
READINESS_WEIGHTS = {
    "x12_payload_match": 30,
    "structural_validity": 20,
    "supported_version": 15,
    "supported_transaction_type": 15,
    "source_record_key": 15,
    "sample_sufficiency": 5,
}
EXACT_RECORD_KEY_SCORES = {
    "record_id": 100,
    "source_record_id": 100,
    "message_id": 95,
    "event_id": 90,
    "transaction_id": 85,
    "row_id": 80,
    "file_record_id": 80,
    "id": 60,
}
SENSITIVE_KEY_TOKENS = {
    "patient",
    "member",
    "subscriber",
    "person",
    "claim",
    "provider",
    "npi",
    "ssn",
    "account",
}


def quote_identifier(value: str) -> str:
    return "`" + value.replace("`", "``") + "`"


def score_candidate(table_name: str, column_name: str, table_comment: str, column_comment: str) -> int:
    column_text = " ".join((column_name, column_comment or "")).lower()
    normalized_column = column_name.lower()
    if any(token in normalized_column for token in NON_PAYLOAD_COLUMN_TOKENS):
        return 0
    has_column_signal = (
        any(token in column_text for token in STRONG_PAYLOAD_COLUMN_TOKENS)
        or normalized_column in GENERIC_PAYLOAD_COLUMNS
        or normalized_column in {"message", "body", "raw"}
        or normalized_column.endswith(("_message", "_body"))
    )
    if not has_column_signal:
        return 0
    text = " ".join((table_name, column_name, table_comment or "", column_comment or "")).lower()
    return sum(weight for token, weight in TOKENS.items() if token in text)


def score_record_key_candidate(column_name: str, column_comment: str = "") -> int:
    """Rank generic source-row identifiers without selecting patient or claim identifiers."""
    normalized = column_name.lower()
    if any(token in normalized for token in SENSITIVE_KEY_TOKENS):
        return 0
    if normalized in EXACT_RECORD_KEY_SCORES:
        return EXACT_RECORD_KEY_SCORES[normalized]
    if normalized.endswith("_record_id"):
        return 90
    if normalized.endswith("_message_id") or normalized.endswith("_event_id"):
        return 85
    comment = (column_comment or "").lower()
    if "primary key" in comment or "unique record" in comment or "record identifier" in comment:
        return 75
    return 0


def choose_record_key(columns: list[dict[str, Any]], payload_column: str) -> dict[str, Any] | None:
    candidates = []
    for column in columns:
        name = str(column.get("column_name") or "")
        data_type = str(column.get("data_type") or "").upper()
        if name == payload_column or data_type in {"ARRAY", "MAP", "STRUCT", "VARIANT", "BINARY"}:
            continue
        score = score_record_key_candidate(name, str(column.get("column_comment") or ""))
        if score:
            candidates.append({**column, "metadata_score": score})
    if not candidates:
        return None
    return sorted(
        candidates,
        key=lambda item: (-int(item["metadata_score"]), int(item.get("ordinal_position") or 0), item["column_name"]),
    )[0]


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _component(ratio: float, weight: int, evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        "points": round(ratio * weight, 1),
        "max_points": weight,
        "ratio": round(ratio, 4),
        **evidence,
    }


def assess_bronze_readiness(
    classifications: list[Any],
    key_evidence: dict[str, Any] | None,
    requested_sample_rows: int,
) -> dict[str, Any]:
    """Build a transparent readiness score; this is not a statistical probability."""
    sampled = len(classifications)
    x12_matches = [item for item in classifications if item.is_x12]
    structural_matches = [
        item for item in x12_matches if not any(error != "unsupported_version" for error in item.errors)
    ]
    version_matches = [
        item for item in x12_matches
        if item.version and item.version.startswith(SUPPORTED_VERSION_PREFIXES)
    ]
    type_matches = [
        item for item in x12_matches
        if item.transaction_types
        and set(item.transaction_types).issubset(SUPPORTED_TRANSACTION_TYPES)
    ]

    x12_ratio = _ratio(len(x12_matches), sampled)
    structural_ratio = _ratio(len(structural_matches), len(x12_matches))
    version_ratio = _ratio(len(version_matches), len(x12_matches))
    transaction_ratio = _ratio(len(type_matches), len(x12_matches))

    if key_evidence:
        non_null_ratio = float(key_evidence["non_null_ratio"])
        uniqueness_ratio = float(key_evidence["uniqueness_ratio"])
        key_ratio = min(non_null_ratio, uniqueness_ratio)
    else:
        key_ratio = 0.0

    evidence_target = max(10, min(requested_sample_rows, 25))
    sample_ratio = min(sampled / evidence_target, 1.0)
    components = {
        "x12_payload_match": _component(
            x12_ratio,
            READINESS_WEIGHTS["x12_payload_match"],
            {"matched_rows": len(x12_matches), "sampled_rows": sampled},
        ),
        "structural_validity": _component(
            structural_ratio,
            READINESS_WEIGHTS["structural_validity"],
            {"structurally_valid_rows": len(structural_matches), "x12_rows": len(x12_matches)},
        ),
        "supported_version": _component(
            version_ratio,
            READINESS_WEIGHTS["supported_version"],
            {"supported_version_rows": len(version_matches), "x12_rows": len(x12_matches)},
        ),
        "supported_transaction_type": _component(
            transaction_ratio,
            READINESS_WEIGHTS["supported_transaction_type"],
            {"supported_type_rows": len(type_matches), "x12_rows": len(x12_matches)},
        ),
        "source_record_key": _component(
            key_ratio,
            READINESS_WEIGHTS["source_record_key"],
            {"column": key_evidence.get("column") if key_evidence else None},
        ),
        "sample_sufficiency": _component(
            sample_ratio,
            READINESS_WEIGHTS["sample_sufficiency"],
            {"sampled_rows": sampled, "evidence_target_rows": evidence_target},
        ),
    }

    blocking_issues = []
    warnings = []
    if not sampled:
        blocking_issues.append("no_non_null_payload_rows_sampled")
    elif not x12_matches:
        blocking_issues.append("no_x12_payloads_detected")
    if x12_matches and not type_matches:
        blocking_issues.append("no_supported_834_835_or_837_transactions_detected")
    if not key_evidence:
        blocking_issues.append("source_record_key_not_detected")
    elif float(key_evidence["non_null_ratio"]) < 1:
        blocking_issues.append("source_record_key_contains_null_or_blank_values")
    elif float(key_evidence["uniqueness_ratio"]) < 1:
        blocking_issues.append("source_record_key_is_not_unique_in_sample")

    if sampled < evidence_target:
        warnings.append("sample_smaller_than_readiness_target")
    if x12_matches and len(x12_matches) < sampled:
        warnings.append("sample_contains_non_x12_rows")
    if x12_matches and len(structural_matches) < len(x12_matches):
        warnings.append("sample_contains_structural_x12_errors")
    if x12_matches and len(version_matches) < len(x12_matches):
        warnings.append("sample_contains_unsupported_or_unknown_versions")
    if x12_matches and len(type_matches) < len(x12_matches):
        warnings.append("sample_contains_unsupported_or_unknown_transaction_types")

    score = round(sum(float(component["points"]) for component in components.values()), 1)
    if blocking_issues:
        status = "not_ready"
    elif score >= 90 and sampled >= evidence_target:
        status = "ready"
    else:
        status = "needs_review"
    return {
        "score": score,
        "max_score": 100,
        "status": status,
        "score_type": "deterministic_sample_readiness_not_probability",
        "components": components,
        "blocking_issues": blocking_issues,
        "warnings": warnings,
    }


def access_failure_readiness(error: Exception) -> dict[str, Any]:
    return {
        "score": 0.0,
        "max_score": 100,
        "status": "access_failed",
        "score_type": "deterministic_sample_readiness_not_probability",
        "components": {},
        "blocking_issues": ["candidate_could_not_be_sampled"],
        "warnings": [],
        "safe_error_type": type(error).__name__,
    }


def execute_sql(profile: str, warehouse_id: str, statement: str) -> tuple[list[str], list[list[Any]]]:
    from databricks.sdk import WorkspaceClient

    client = WorkspaceClient(profile=profile)
    response = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=statement,
        wait_timeout="10s",
    )
    deadline = time.monotonic() + 180
    while response.status and str(response.status.state).upper().endswith(("PENDING", "RUNNING")):
        if time.monotonic() >= deadline:
            if response.statement_id:
                client.statement_execution.cancel_execution(response.statement_id)
            raise TimeoutError("SQL statement did not complete within 180 seconds")
        time.sleep(1)
        response = client.statement_execution.get_statement(response.statement_id)
    state = str(response.status.state) if response.status and response.status.state else "UNKNOWN"
    if "SUCCEEDED" not in state:
        message = response.status.error.message if response.status and response.status.error else state
        raise RuntimeError(f"SQL statement failed: {message}")
    columns = [column.name for column in response.manifest.schema.columns]
    rows = response.result.data_array or []
    return columns, rows


def row_dicts(columns: list[str], rows: list[list[Any]]) -> list[dict[str, Any]]:
    return [dict(zip(columns, row)) for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--schema")
    parser.add_argument("--max-candidates", type=int, default=10)
    parser.add_argument("--sample-rows", type=int, default=25)
    parser.add_argument("--output", type=Path, default=Path("discovery-report.json"))
    args = parser.parse_args()

    catalog = quote_identifier(args.catalog)
    schema_filter = ""
    if args.schema:
        escaped = args.schema.replace("'", "''")
        schema_filter = f" AND c.table_schema = '{escaped}'"
    metadata_sql = f"""
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
               COALESCE(t.comment, '') AS table_comment,
               COALESCE(c.comment, '') AS column_comment
        FROM {catalog}.information_schema.columns c
        JOIN {catalog}.information_schema.tables t
          ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        WHERE UPPER(c.data_type) IN ('STRING', 'BINARY')
          AND c.table_schema <> 'information_schema'
          {schema_filter}
          AND lower(concat_ws(' ', c.table_name, c.column_name,
                              COALESCE(t.comment, ''), COALESCE(c.comment, '')))
              RLIKE 'x12|edi|837|835|834|payload|message|body|raw'
    """
    columns, rows = execute_sql(args.profile, args.warehouse_id, metadata_sql)
    candidates = []
    for row in row_dicts(columns, rows):
        score = score_candidate(row["table_name"], row["column_name"], row["table_comment"], row["column_comment"])
        if score:
            row["metadata_score"] = score
            candidates.append(row)
    candidates.sort(key=lambda item: (-item["metadata_score"], item["table_schema"], item["table_name"], item["column_name"]))

    report_candidates = []
    table_columns_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for candidate in candidates[: args.max_candidates]:
        table = ".".join(
            quote_identifier(value) for value in (args.catalog, candidate["table_schema"], candidate["table_name"])
        )
        payload_column = quote_identifier(candidate["column_name"])
        safe_table_name = f"{args.catalog}.{candidate['table_schema']}.{candidate['table_name']}"
        base_report = {
            "table": safe_table_name,
            "payload_column": candidate["column_name"],
            "data_type": candidate["data_type"],
            "metadata_score": candidate["metadata_score"],
        }
        try:
            table_key = (candidate["table_schema"], candidate["table_name"])
            if table_key not in table_columns_cache:
                escaped_schema = str(candidate["table_schema"]).replace("'", "''")
                escaped_table = str(candidate["table_name"]).replace("'", "''")
                table_column_sql = f"""
                    SELECT column_name, data_type, COALESCE(comment, '') AS column_comment, ordinal_position
                    FROM {catalog}.information_schema.columns
                    WHERE table_schema = '{escaped_schema}' AND table_name = '{escaped_table}'
                    ORDER BY ordinal_position
                """
                table_column_names, table_column_rows = execute_sql(
                    args.profile, args.warehouse_id, table_column_sql
                )
                table_columns_cache[table_key] = row_dicts(table_column_names, table_column_rows)
            key_candidate = choose_record_key(table_columns_cache[table_key], candidate["column_name"])

            key_projection = ""
            if key_candidate:
                key_projection = f", CAST({quote_identifier(key_candidate['column_name'])} AS STRING) AS source_record_key"
            sample_sql = (
                f"SELECT CAST({payload_column} AS STRING) AS payload{key_projection} "
                f"FROM {table} WHERE {payload_column} IS NOT NULL LIMIT {args.sample_rows}"
            )
            sample_columns, sample_rows = execute_sql(args.profile, args.warehouse_id, sample_sql)
            payload_index = sample_columns.index("payload")
            classifications = [
                classify_x12(str(row[payload_index]))
                for row in sample_rows
                if row and row[payload_index] is not None
            ]
            x12_matches = [item for item in classifications if item.is_x12]

            key_evidence = None
            if key_candidate and "source_record_key" in sample_columns:
                key_index = sample_columns.index("source_record_key")
                key_values = [
                    str(row[key_index]).strip()
                    for row in sample_rows
                    if row and row[key_index] is not None and str(row[key_index]).strip()
                ]
                non_null_ratio = _ratio(len(key_values), len(sample_rows))
                uniqueness_ratio = _ratio(len(set(key_values)), len(key_values))
                key_evidence = {
                    "column": key_candidate["column_name"],
                    "data_type": key_candidate["data_type"],
                    "metadata_score": key_candidate["metadata_score"],
                    "sampled_rows": len(sample_rows),
                    "non_null_rows": len(key_values),
                    "distinct_rows": len(set(key_values)),
                    "non_null_ratio": non_null_ratio,
                    "uniqueness_ratio": uniqueness_ratio,
                    "suitable_in_sample": non_null_ratio == 1.0 and uniqueness_ratio == 1.0,
                }

            x12_match_ratio = _ratio(len(x12_matches), len(classifications))
            report_candidates.append(
                {
                    **base_report,
                    "access": "readable",
                    "sampled_rows": len(classifications),
                    "x12_matches": len(x12_matches),
                    "valid_x12_rows": sum(1 for item in x12_matches if item.valid),
                    "transaction_types": sorted({kind for item in x12_matches for kind in item.transaction_types}),
                    "versions": sorted({item.version for item in x12_matches if item.version}),
                    "validation_errors": sorted({error for item in x12_matches for error in item.errors}),
                    "sample_fingerprints": [item.fingerprint for item in classifications[:5]],
                    "x12_match_ratio": x12_match_ratio,
                    "confidence": x12_match_ratio,
                    "source_record_key": key_evidence,
                    "bronze_readiness": assess_bronze_readiness(
                        classifications, key_evidence, args.sample_rows
                    ),
                }
            )
        except Exception as error:
            report_candidates.append(
                {
                    **base_report,
                    "access": "failed",
                    "sampled_rows": 0,
                    "x12_matches": 0,
                    "transaction_types": [],
                    "versions": [],
                    "validation_errors": [],
                    "sample_fingerprints": [],
                    "x12_match_ratio": 0.0,
                    "confidence": 0.0,
                    "source_record_key": None,
                    "bronze_readiness": access_failure_readiness(error),
                }
            )

    report_candidates.sort(
        key=lambda item: (
            -float(item["bronze_readiness"]["score"]),
            -int(item["metadata_score"]),
            item["table"],
            item["payload_column"],
        )
    )
    for rank, candidate in enumerate(report_candidates, start=1):
        candidate["rank"] = rank

    best = report_candidates[0] if report_candidates else None
    recommended_candidate = None
    if best:
        recommended_candidate = {
            "table": best["table"],
            "payload_column": best["payload_column"],
            "source_record_key_column": (
                best["source_record_key"].get("column") if best.get("source_record_key") else None
            ),
            "transaction_types": best["transaction_types"],
            "bronze_readiness_score": best["bronze_readiness"]["score"],
            "bronze_readiness_status": best["bronze_readiness"]["status"],
        }

    report = {
        "report_version": 2,
        "stage": "bronze_source_readiness",
        "catalog": args.catalog,
        "schema_scope": args.schema,
        "read_only": True,
        "write_performed": False,
        "confirmation_required": True,
        "summary": {
            "candidate_count": len(report_candidates),
            "recommended_candidate": recommended_candidate,
            "next_action": (
                "review_and_confirm_source"
                if best and best["bronze_readiness"]["status"] in {"ready", "needs_review"}
                else "remediate_source_or_permissions"
            ),
        },
        "candidates": report_candidates,
    }
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
