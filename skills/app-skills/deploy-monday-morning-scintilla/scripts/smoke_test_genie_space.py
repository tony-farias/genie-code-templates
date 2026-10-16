#!/usr/bin/env python3
"""Ask the Genie Space the App's questions and check each is answered with bounded SQL, not a clarifying question.

Sends each question the way the App does, with its answering guidance appended. Starts real
Genie conversations as the caller. Reports statuses, row counts, and timings only.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import time

from build_genie_space import APP_GUIDANCE, APP_QUESTIONS

DONE = {"COMPLETED", "FAILED", "CANCELLED", "QUERY_RESULT_EXPIRED"}


def api(profile: str, method: str, path: str, body: dict | None = None) -> dict:
    command = ["databricks", "api", method, path, "--profile", profile]
    if body is not None:
        command += ["--json", json.dumps(body)]
    for attempt in range(6):
        result = subprocess.run(command, capture_output=True, text=True)
        if not result.returncode:
            return json.loads(result.stdout or "{}")
        # Genie limits questions per minute per workspace; back off and retry.
        if "429" not in result.stderr and "RESOURCE_EXHAUSTED" not in result.stderr:
            break
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(result.stderr.strip()[:300])


def ask(profile: str, space_id: str, question: str, guidance: str, timeout: int, max_rows: int) -> dict:
    started = time.monotonic()
    try:
        message = api(profile, "post", f"/api/2.0/genie/spaces/{space_id}/start-conversation",
                      {"content": question + guidance})
        conversation, message_id = message["conversation_id"], message["message_id"]
        while time.monotonic() - started < timeout and message.get("status") not in DONE:
            time.sleep(3)
            message = api(profile, "get",
                          f"/api/2.0/genie/spaces/{space_id}/conversations/{conversation}/messages/{message_id}")
        query = next((item for item in message.get("attachments") or [] if item.get("query")), None)
        rows = None
        if query:
            result = api(profile, "get", f"/api/2.0/genie/spaces/{space_id}/conversations/{conversation}/messages/"
                                         f"{message_id}/attachments/{query['attachment_id']}/query-result")
            rows = len(((result.get("statement_response") or {}).get("result") or {}).get("data_array") or [])
        status = message.get("status") if message.get("status") in DONE else "TIMEOUT"
    except RuntimeError as error:
        status, query, rows = f"ERROR: {error}", None, None
    return {
        "question": question,
        "status": status,
        "answered_with_sql": bool(query),
        "rows": rows,
        "bounded": rows is not None and rows <= max_rows,
        "passed": status == "COMPLETED" and bool(query) and bool(rows) and rows <= max_rows,
        "seconds": round(time.monotonic() - started),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--space", type=Path, required=True, help="deploy_genie_space.py output")
    parser.add_argument("--config", type=Path, required=True, help="build_genie_space.py output")
    parser.add_argument("--all-app-questions", action="store_true",
                        help="Ask every fixed question the App sends, not only the sample questions")
    parser.add_argument("--no-app-guidance", action="store_true", help="Send questions without the App's guidance")
    parser.add_argument("--max-rows", type=int, default=100, help="Fail answers with more rows than this")
    parser.add_argument("--timeout", type=int, default=420, help="Seconds per question")
    parser.add_argument("--workers", type=int, default=4, help="Questions asked at once")
    args = parser.parse_args()
    space_id = json.loads(args.space.read_text(encoding="utf-8"))["space_id"]
    config = json.loads(args.config.read_text(encoding="utf-8"))
    questions = (list(APP_QUESTIONS) if args.all_app_questions
                 else [item["question"][0] for item in config["config"]["sample_questions"]])
    guidance = "" if args.no_app_guidance else APP_GUIDANCE
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(
            lambda question: ask(args.profile, space_id, question, guidance, args.timeout, args.max_rows), questions))
    passed = all(item["passed"] for item in results)
    print(json.dumps({"space_id": space_id, "passed": passed,
                      "failed": sum(not item["passed"] for item in results), "results": results}, indent=2))
    raise SystemExit(0 if passed else 2)


if __name__ == "__main__":
    main()
