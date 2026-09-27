#!/usr/bin/env python3
"""Create the immutable handoff between source confirmation and deployment."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path


PARSER_COMMIT = "ac6d84d3f322310816a55a43569242afe295b4c5"
SKILL_VERSION = "0.2.0"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--discovery-report", type=Path, required=True)
    parser.add_argument("--source-table", required=True)
    parser.add_argument("--payload-column", required=True)
    parser.add_argument("--primary-key-column", required=True)
    parser.add_argument("--transaction-types", nargs="+", required=True, choices=("837", "835", "834"))
    parser.add_argument("--target-catalog", required=True)
    parser.add_argument("--target-schema", required=True)
    parser.add_argument("--table-prefix", default="x12_demo_")
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--app-name", default="x12-health-plan-analytics")
    parser.add_argument("--genie-title", default="X12 Health Plan Analytics")
    parser.add_argument("--output", type=Path, default=Path("deployment-manifest.json"))
    args = parser.parse_args()

    report = json.loads(args.discovery_report.read_text(encoding="utf-8"))
    matches = [
        candidate
        for candidate in report.get("candidates", [])
        if candidate.get("table") == args.source_table
        and candidate.get("payload_column") == args.payload_column
    ]
    if len(matches) != 1:
        raise SystemExit("The confirmed table and payload column must match exactly one discovery candidate")
    candidate = matches[0]
    if int(candidate.get("x12_matches", 0)) < 1:
        raise SystemExit("The selected discovery candidate has no structurally identifiable X12 records")
    discovered_types = set(candidate.get("transaction_types", []))
    requested_types = set(args.transaction_types)
    if not requested_types.issubset(discovered_types):
        missing = ", ".join(sorted(requested_types - discovered_types))
        raise SystemExit(f"Requested transaction types were not discovered: {missing}")

    manifest = {
        "manifest_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "confirmed": True,
        "source": {
            "table": args.source_table,
            "payload_column": args.payload_column,
            "primary_key_column": args.primary_key_column,
            "transaction_types": sorted(requested_types),
            "sample_fingerprints": candidate.get("sample_fingerprints", []),
        },
        "destination": {
            "catalog": args.target_catalog,
            "schema": args.target_schema,
            "table_prefix": args.table_prefix,
        },
        "parser": {
            "repository": "https://github.com/databricks-industry-solutions/x12-edi-parser",
            "commit": PARSER_COMMIT,
            "entrypoint": "from_edi_exploded",
            "compute": "classic_job_cluster",
        },
        "sql_warehouse_id": args.warehouse_id,
        "app": {"name": args.app_name, "template_version": "1.0.1"},
        "genie": {"title": args.genie_title, "serialized_space_version": 2},
        "skill_version": SKILL_VERSION,
    }
    args.output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "source": args.source_table,
        "transaction_types": sorted(requested_types),
        "target": f"{args.target_catalog}.{args.target_schema}",
    }, indent=2))


if __name__ == "__main__":
    main()
