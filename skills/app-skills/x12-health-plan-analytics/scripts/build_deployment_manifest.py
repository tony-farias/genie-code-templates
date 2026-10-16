#!/usr/bin/env python3
"""Create the immutable handoff between source confirmation and deployment."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path


PARSER_COMMIT = "ac6d84d3f322310816a55a43569242afe295b4c5"
SKILL_VERSION = "0.3.0"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--discovery-report", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-table", help="Confirmed three-part table or view with raw X12 payloads")
    source.add_argument("--source-volume-path", help="Confirmed /Volumes/... directory of raw X12 files")
    parser.add_argument("--payload-column", help="Payload column (table sources only)")
    parser.add_argument("--primary-key-column", help="Source-record key column (table sources only)")
    parser.add_argument("--transaction-types", nargs="+", required=True, choices=("837", "835", "834"))
    parser.add_argument("--target-catalog", required=True)
    parser.add_argument("--target-schema", required=True)
    parser.add_argument("--table-prefix", default="x12_demo_")
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--app-name", default="x12-health-plan-analytics")
    parser.add_argument("--genie-title", default="X12 Health Plan Analytics")
    parser.add_argument(
        "--authorization-mode", choices=("user", "app"), default="user",
        help="Data identity for App SQL and Genie: the signed-in viewer (default) or the App service principal",
    )
    parser.add_argument("--output", type=Path, default=Path("deployment-manifest.json"))
    args = parser.parse_args()

    report = json.loads(args.discovery_report.read_text(encoding="utf-8"))
    if args.source_table:
        if not (args.payload_column and args.primary_key_column):
            raise SystemExit("--payload-column and --primary-key-column are required for a table source")
        matches = [
            candidate
            for candidate in report.get("candidates", [])
            if candidate.get("table") == args.source_table
            and candidate.get("payload_column") == args.payload_column
        ]
    else:
        matches = [
            candidate
            for candidate in report.get("candidates", [])
            if candidate.get("source_kind") == "volume"
            and candidate.get("volume_path") == args.source_volume_path.rstrip("/")
        ]
    if len(matches) != 1:
        raise SystemExit("The confirmed source must match exactly one discovery candidate")
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
            "kind": "table" if args.source_table else "volume",
            "table": args.source_table,
            "volume_path": args.source_volume_path.rstrip("/") if args.source_volume_path else None,
            "payload_column": args.payload_column if args.source_table else "value",
            "primary_key_column": args.primary_key_column if args.source_table else "_metadata.file_path",
            "transaction_types": sorted(requested_types),
            "sample_fingerprints": candidate.get("sample_fingerprints", []),
            "match_likelihood": candidate.get("match_likelihood"),
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
        "app": {
            "name": args.app_name,
            "template_version": "1.1.0",
            "authorization_mode": args.authorization_mode,
        },
        "genie": {"title": args.genie_title, "serialized_space_version": 2},
        "skill_version": SKILL_VERSION,
    }
    args.output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "source": args.source_table or args.source_volume_path,
        "transaction_types": sorted(requested_types),
        "target": f"{args.target_catalog}.{args.target_schema}",
    }, indent=2))


if __name__ == "__main__":
    main()
