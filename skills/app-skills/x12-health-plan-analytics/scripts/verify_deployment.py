#!/usr/bin/env python3
"""Verify safe row-count and schema invariants without returning record values."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import time


def execute(client, warehouse_id: str, statement: str):
    response = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id, statement=statement, wait_timeout="10s"
    )
    deadline = time.monotonic() + 180
    while response.status and str(response.status.state).upper().endswith(("PENDING", "RUNNING")):
        if time.monotonic() >= deadline:
            client.statement_execution.cancel_execution(response.statement_id)
            raise TimeoutError("Verification query timed out")
        time.sleep(1)
        response = client.statement_execution.get_statement(response.statement_id)
    state = str(response.status.state) if response.status and response.status.state else "UNKNOWN"
    if "SUCCEEDED" not in state:
        message = response.status.error.message if response.status and response.status.error else state
        raise RuntimeError(f"Verification query failed: {message}")
    return response


def scalar(response) -> int:
    rows = response.result.data_array or []
    return int(rows[0][0]) if rows else 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--expected-source-records", type=int)
    args = parser.parse_args()

    from databricks.sdk import WorkspaceClient

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    client = WorkspaceClient(profile=args.profile)
    warehouse_id = manifest["sql_warehouse_id"]
    catalog = manifest["destination"]["catalog"]
    schema = manifest["destination"]["schema"]
    prefix = manifest["destination"]["table_prefix"]
    fq = lambda layer, name: f"`{catalog}`.`{schema}`.`{prefix}{layer}_{name}`"

    counts = {
        "bronze_raw_x12": scalar(execute(client, warehouse_id, f"SELECT COUNT(*) FROM {fq('bronze', 'raw_x12')}")),
        "silver_parsed_transactions": scalar(execute(client, warehouse_id, f"SELECT COUNT(*) FROM {fq('silver', 'parsed_transactions')}")),
        "silver_x12_quarantine": scalar(execute(client, warehouse_id, f"SELECT COUNT(*) FROM {fq('silver', 'x12_quarantine')}")),
        "gold_claims": scalar(execute(client, warehouse_id, f"SELECT COUNT(*) FROM {fq('gold', 'claims')}")),
        "gold_payments": scalar(execute(client, warehouse_id, f"SELECT COUNT(*) FROM {fq('gold', 'payments')}")),
        "gold_enrollments": scalar(execute(client, warehouse_id, f"SELECT COUNT(*) FROM {fq('gold', 'enrollments')}")),
    }
    checks = {
        "source_cardinality": args.expected_source_records is None or counts["bronze_raw_x12"] == args.expected_source_records,
        "positive_transactions_present": all(counts[name] > 0 for name in ("gold_claims", "gold_payments", "gold_enrollments")),
        "negative_transactions_quarantined": counts["silver_x12_quarantine"] > 0,
        "no_raw_payload_in_gold": scalar(execute(
            client,
            warehouse_id,
            f"SELECT COUNT(*) FROM `{catalog}`.information_schema.columns WHERE table_schema = '{schema}' AND table_name LIKE '{prefix}gold_%' AND lower(column_name) RLIKE 'raw_payload|edi_payload|parsed_json|member_id|member_name|source_record_id'",
        )) == 0,
        "no_parser_error_text_in_silver": scalar(execute(
            client,
            warehouse_id,
            f"SELECT COUNT(*) FROM `{catalog}`.information_schema.columns WHERE table_schema = '{schema}' AND table_name = '{prefix}silver_parsed_transactions' AND lower(column_name) IN ('parser_error', 'parser_error_raw', 'safe_message')",
        )) == 0,
        "parser_error_fingerprint_in_silver": scalar(execute(
            client,
            warehouse_id,
            f"SELECT COUNT(*) FROM `{catalog}`.information_schema.columns WHERE table_schema = '{schema}' AND table_name = '{prefix}silver_parsed_transactions' AND lower(column_name) IN ('parser_error_code', 'parser_error_fingerprint')",
        )) == 2,
        "parsed_plus_quarantine_covers_source": counts["silver_parsed_transactions"] + counts["silver_x12_quarantine"] >= counts["bronze_raw_x12"],
    }
    result = {"passed": all(checks.values()), "checks": checks, "counts": counts}
    print(json.dumps(result, indent=2, sort_keys=True))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
