#!/usr/bin/env python3
"""Run read-only benchmark smoke tests against a deployed Gold-only Genie Space."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import time


TERMINAL_STATUSES = {"COMPLETED", "FAILED", "CANCELLED", "CANCELED"}
UNSAFE_QUERY_TOKENS = ("bronze", "silver", "edi_payload", "raw_x12", "parser_json")


def normalize_identifier(value: str) -> str:
    return value.replace("`", "").lower()


def referenced_tables(query: str) -> set[str]:
    pattern = re.compile(
        r"\b(?:from|join)\s+((?:`?[A-Za-z_][\w]*`?\.){2}`?[A-Za-z_][\w]*`?)",
        re.IGNORECASE,
    )
    return {normalize_identifier(match) for match in pattern.findall(query)}


def wait_for_message(client, endpoint: str, timeout_seconds: int) -> dict[str, object]:
    deadline = time.monotonic() + timeout_seconds
    while True:
        message = client.api_client.do("GET", endpoint)
        status = str(message.get("status", "")).upper()
        if status in TERMINAL_STATUSES:
            return message
        if time.monotonic() >= deadline:
            raise TimeoutError("Genie benchmark message did not finish before the timeout")
        time.sleep(2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--state", type=Path, default=Path("deployment-state.json"))
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--timeout-seconds", type=int, default=180)
    args = parser.parse_args()

    if args.limit < 1:
        raise SystemExit("--limit must be at least 1")

    from databricks.sdk import WorkspaceClient

    state = json.loads(args.state.read_text(encoding="utf-8"))
    config = json.loads(args.config.read_text(encoding="utf-8"))
    space_id = str(state["genie_space_id"])
    gold_tables = {
        normalize_identifier(table["identifier"])
        for table in config["data_sources"]["tables"]
    }
    questions = [
        item["question"][0]
        for item in config["benchmarks"]["questions"][: args.limit]
    ]
    client = WorkspaceClient(profile=args.profile)
    summaries: list[dict[str, object]] = []

    for question in questions:
        started = client.api_client.do(
            "POST",
            f"/api/2.0/genie/spaces/{space_id}/start-conversation",
            body={"content": question},
        )
        conversation_id = str(started["conversation_id"])
        message_id = str(started["message_id"])
        endpoint = (
            f"/api/2.0/genie/spaces/{space_id}/conversations/"
            f"{conversation_id}/messages/{message_id}"
        )
        message = wait_for_message(client, endpoint, args.timeout_seconds)
        status = str(message.get("status", "")).upper()
        if status != "COMPLETED":
            raise RuntimeError(f"Genie benchmark failed with status {status}")

        query_attachments = [
            attachment["query"]
            for attachment in message.get("attachments", [])
            if isinstance(attachment, dict) and isinstance(attachment.get("query"), dict)
        ]
        if not query_attachments:
            raise RuntimeError("Genie benchmark completed without a query attachment")
        query = str(query_attachments[0].get("query", ""))
        lower_query = query.lower()
        if any(token in lower_query for token in UNSAFE_QUERY_TOKENS):
            raise RuntimeError("Genie generated a query outside the curated Gold boundary")
        tables = referenced_tables(query)
        if not tables or not tables.issubset(gold_tables):
            raise RuntimeError("Genie generated a query against an unapproved table")

        query_result = message.get("query_result") or {}
        summaries.append({
            "question": question,
            "status": status,
            "tables": sorted(tables),
            "row_count": query_result.get("row_count"),
        })

    print(json.dumps({"space_id": space_id, "checks": summaries}, indent=2))


if __name__ == "__main__":
    main()
