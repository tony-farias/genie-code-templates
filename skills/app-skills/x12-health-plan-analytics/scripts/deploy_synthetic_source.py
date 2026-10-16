#!/usr/bin/env python3
"""Load generated fictional X12 into a user-approved UC source table or Volume."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import re
import subprocess
import time


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def ident(value: str) -> str:
    if not IDENTIFIER.fullmatch(value):
        raise ValueError(f"Unsafe Unity Catalog identifier: {value!r}")
    return f"`{value}`"


def execute(client, warehouse_id: str, statement: str):
    response = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id, statement=statement, wait_timeout="10s"
    )
    deadline = time.monotonic() + 180
    while response.status and str(response.status.state).upper().endswith(("PENDING", "RUNNING")):
        if time.monotonic() >= deadline:
            client.statement_execution.cancel_execution(response.statement_id)
            raise TimeoutError("SQL statement timed out")
        time.sleep(1)
        response = client.statement_execution.get_statement(response.statement_id)
    state = str(response.status.state) if response.status and response.status.state else "UNKNOWN"
    if "SUCCEEDED" not in state:
        message = response.status.error.message if response.status and response.status.error else state
        raise RuntimeError(f"SQL statement failed: {message}")
    return response


def land_files(client, args: argparse.Namespace) -> None:
    """Write each fictional record as its own raw X12 file, as an inbound feed would land them."""
    records = [json.loads(line) for line in args.jsonl.read_text(encoding="utf-8").splitlines() if line.strip()]
    directory = f"/Volumes/{args.catalog}/{args.schema}/{args.volume}/inbound"

    def upload(record: dict) -> None:
        name = re.sub(r"[^A-Za-z0-9_.-]", "_", str(record["record_id"]))
        client.files.upload(f"{directory}/{name}.x12", io.BytesIO(str(record["edi_payload"]).encode("utf-8")), overwrite=True)

    # The Files API takes one file per request; upload in parallel.
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(upload, records))
    print(json.dumps({
        "volume_path": directory,
        "files": len(records),
        "valid_records": sum(1 for record in records if record.get("expected_status") == "valid"),
        "fictional_only": True,
    }, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--schema", required=True)
    parser.add_argument("--volume", default="x12_demo_files")
    parser.add_argument("--table", default="x12_demo_source")
    parser.add_argument("--jsonl", type=Path, required=True)
    parser.add_argument(
        "--files", action="store_true",
        help="Land one raw .x12 file per record under <volume>/inbound/ instead of creating a table",
    )
    args = parser.parse_args()

    if not args.jsonl.is_file():
        raise SystemExit(f"Synthetic input not found: {args.jsonl}")
    for value in (args.catalog, args.schema, args.volume, args.table):
        ident(value)

    from databricks.sdk import WorkspaceClient

    client = WorkspaceClient(profile=args.profile)
    full_schema = f"{ident(args.catalog)}.{ident(args.schema)}"
    execute(client, args.warehouse_id, f"CREATE VOLUME IF NOT EXISTS {full_schema}.{ident(args.volume)}")
    if args.files:
        land_files(client, args)
        return
    destination = f"dbfs:/Volumes/{args.catalog}/{args.schema}/{args.volume}/synthetic_x12.jsonl"
    command = [
        "databricks", "fs", "cp", str(args.jsonl.resolve()), destination,
        "--overwrite", "--profile", args.profile,
    ]
    copied = subprocess.run(command, capture_output=True, text=True)
    if copied.returncode:
        raise RuntimeError(copied.stderr.strip() or "Failed to upload synthetic X12")

    table = f"{full_schema}.{ident(args.table)}"
    volume_path = f"/Volumes/{args.catalog}/{args.schema}/{args.volume}/synthetic_x12.jsonl"
    execute(
        client,
        args.warehouse_id,
        f"""
        CREATE OR REPLACE TABLE {table}
        COMMENT 'Fictional X12 test transactions generated deterministically; contains no real patient data'
        AS SELECT
          CAST(record_id AS STRING) AS record_id,
          CAST(transaction_type AS STRING) AS transaction_type,
          CAST(edi_payload AS STRING) AS edi_payload,
          CAST(expected_status AS STRING) AS expected_status,
          CAST(fingerprint AS STRING) AS fingerprint
        FROM read_files('{volume_path}', format => 'json')
        """,
    )
    response = execute(
        client,
        args.warehouse_id,
        f"SELECT COUNT(*) AS records, COUNT_IF(expected_status = 'valid') AS valid_records FROM {table}",
    )
    rows = response.result.data_array or []
    counts = rows[0] if rows else [0, 0]
    print(json.dumps({
        "table": f"{args.catalog}.{args.schema}.{args.table}",
        "volume": f"{args.catalog}.{args.schema}.{args.volume}",
        "records": int(counts[0]),
        "valid_records": int(counts[1]),
        "fictional_only": True,
    }, indent=2))


if __name__ == "__main__":
    main()
