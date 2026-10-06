#!/usr/bin/env python3
"""Prove a deployed Monday Morning App serves the golden UI byte-for-byte and its API answers.

Read-only: issues GET requests only. It never posts to Genie, the model, or the action log.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Callable
import urllib.error
import urllib.request

import app_contract as contract


PASS = "PASS"
FAIL = "FAIL"


@dataclass
class Check:
    name: str
    status: str
    detail: str
    remediation: str | None = None


@dataclass
class Response:
    status: int
    content_type: str
    body: bytes


Fetch = Callable[[str], Response]


def cli_json(arguments: list[str], profile: str) -> dict:
    result = subprocess.run(
        ["databricks", *arguments, "--profile", profile, "--output", "json"],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Databricks CLI command failed")
    return json.loads(result.stdout or "{}")


def http_fetcher(base_url: str, token: str, timeout: int) -> Fetch:
    def fetch(path: str) -> Response:
        request = urllib.request.Request(base_url.rstrip("/") + path, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return Response(response.status, response.headers.get("Content-Type", ""), response.read())
        except urllib.error.HTTPError as exc:
            return Response(exc.code, exc.headers.get("Content-Type", ""), exc.read())
        except (urllib.error.URLError, TimeoutError) as exc:
            return Response(0, "", str(exc).encode())

    return fetch


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def check_pages(fetch: Fetch, shell_sha: str) -> list[Check]:
    checks = []
    for page in contract.PAGES:
        response = fetch(page)
        if response.status == 200 and sha256(response.body) == shell_sha:
            checks.append(Check(f"page {page}", PASS, "Serves the locked dist/index.html shell"))
        else:
            checks.append(Check(
                f"page {page}",
                FAIL,
                f"HTTP {response.status}; body sha256 {sha256(response.body)[:12]} != locked {shell_sha[:12]}",
                "Redeploy the rendered golden App; never edit or rebuild the UI during deployment.",
            ))
    return checks


def check_assets(fetch: Fetch, assets: dict[str, str]) -> list[Check]:
    def one(item: tuple[str, str]) -> Check:
        path, expected = item
        response = fetch(path)
        if response.status == 200 and sha256(response.body) == expected:
            return Check(f"asset {path}", PASS, "Byte-identical to the locked build")
        return Check(
            f"asset {path}",
            FAIL,
            f"HTTP {response.status}; sha256 {sha256(response.body)[:12]} != locked {expected[:12]}",
            "The deployed UI is not the golden build. Redeploy from render_app.py output.",
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(one, sorted(assets.items())))


def check_api(fetch: Fetch) -> list[Check]:
    def one(route: str) -> Check:
        response = fetch(route)
        is_json = "application/json" in response.content_type
        if 200 <= response.status < 300 and is_json:
            return Check(f"api {route}", PASS, f"HTTP {response.status} JSON")
        detail = f"HTTP {response.status}, Content-Type {response.content_type or 'none'}"
        if not is_json and response.status == 200:
            detail += " (SPA fallback: route is not mounted)"
        return Check(
            f"api {route}",
            FAIL,
            detail + ": " + response.body[:160].decode("utf-8", errors="replace"),
            "Confirm every REQUIRED_TABLES view exists in the curated schema and the runtime identity can read it.",
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        return list(pool.map(one, contract.UI_GET_ROUTES))


def build_report(fetch: Fetch, lock: dict, *, app_name: str | None, url: str) -> dict:
    files = dict(lock["files"])
    checks = [
        *check_pages(fetch, files["dist/index.html"]),
        *check_assets(fetch, contract.dist_assets(lock)),
        *check_api(fetch),
    ]
    failed = [check for check in checks if check.status == FAIL]
    return {
        "version": 1,
        "read_only": True,
        "app_name": app_name,
        "url": url,
        "template_version": lock["template_version"],
        "ready": not failed,
        "summary": {"passed": len(checks) - len(failed), "failed": len(failed)},
        "checks": [asdict(check) for check in checks],
        "known_gaps": contract.KNOWN_UNMOUNTED,
        "limitations": [
            "Byte-identical assets prove the UI code is the golden build; rendered content still depends on the customer's data.",
            "POST routes (Genie, home brief, action log) and path-parameter routes are not exercised.",
            "Web fonts load from fonts.googleapis.com at runtime and are outside the lock.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--timeout", type=int, default=180, help="Per-request timeout in seconds")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    lock = contract.verify_template()
    try:
        url = cli_json(["apps", "get", args.app_name], args.profile).get("url")
        # `databricks auth token` supports U2M profiles only (databricks auth login).
        token = cli_json(["auth", "token"], args.profile)["access_token"] if url else None
    except (RuntimeError, json.JSONDecodeError, KeyError) as exc:
        raise SystemExit(f"Could not resolve the App URL or a U2M token for profile {args.profile}: {exc}")
    if not url:
        raise SystemExit(f"App {args.app_name} has no URL; is it deployed and running?")
    report = build_report(http_fetcher(url, token, args.timeout), lock, app_name=args.app_name, url=url)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "ready": report["ready"],
        "summary": report["summary"],
        "failed": [check["name"] for check in report["checks"] if check["status"] == FAIL],
    }, indent=2))
    raise SystemExit(0 if report["ready"] else 2)


if __name__ == "__main__":
    main()
