#!/usr/bin/env python3
"""Prove a running App serves the golden X12 UI byte-for-byte and its read-only API answers.

Read-only: issues GET requests only. It never posts to Genie.
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


ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "assets" / "app-template" / "template-lock.json"
# Every view is the same shell; the SPA switches views with ?page=.
PAGES = ("/", "/?page=siu", "/?page=genie")
GET_ROUTES = ("/api/health", "/api/meta", "/api/dashboard", "/api/siu/providers?q=10")
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
        ["databricks", *arguments, "--profile", profile, "--output", "json"], capture_output=True, text=True
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


def dist_assets(lock: dict) -> dict[str, str]:
    """Locked compiled assets keyed by the URL the App serves them at."""
    prefix = "frontend/dist/assets/"
    return {f"/assets/{name[len(prefix):]}": digest for name, digest in lock["files"].items() if name.startswith(prefix)}


def build_report(fetch: Fetch, lock: dict, *, app_name: str | None, url: str) -> dict:
    shell = lock["files"]["frontend/dist/index.html"]
    checks: list[Check] = []
    for page in PAGES:
        response = fetch(page)
        ok = response.status == 200 and sha256(response.body) == shell
        checks.append(Check(
            f"page {page}", PASS if ok else FAIL,
            "Serves the locked index.html shell" if ok
            else f"HTTP {response.status}; sha256 {sha256(response.body)[:12]} != locked {shell[:12]}",
            None if ok else "Redeploy the rendered golden App; never edit or rebuild the UI during deployment.",
        ))

    def asset(item: tuple[str, str]) -> Check:
        path, expected = item
        response = fetch(path)
        ok = response.status == 200 and sha256(response.body) == expected
        return Check(
            f"asset {path}", PASS if ok else FAIL,
            "Byte-identical to the locked build" if ok
            else f"HTTP {response.status}; sha256 {sha256(response.body)[:12]} != locked {expected[:12]}",
            None if ok else "The deployed UI is not the golden build. Redeploy from render_app.py output.",
        )

    def api(route: str) -> Check:
        response = fetch(route)
        ok = 200 <= response.status < 300 and "application/json" in response.content_type
        return Check(
            f"api {route}", PASS if ok else FAIL,
            f"HTTP {response.status} JSON" if ok
            else f"HTTP {response.status}: " + response.body[:200].decode("utf-8", errors="replace"),
            None if ok else "Confirm the Gold tables exist and the runtime identity (viewer or App) can read them.",
        )

    with ThreadPoolExecutor(max_workers=6) as pool:
        checks.extend(pool.map(asset, sorted(dist_assets(lock).items())))
        checks.extend(pool.map(api, GET_ROUTES))
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
        "limitations": [
            "Byte-identical assets prove the UI code is the golden build; rendered content still depends on the data.",
            "POST routes (Genie) and provider-specific routes are not exercised; smoke_test_genie.py covers Genie.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--timeout", type=int, default=120, help="Per-request timeout in seconds")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    lock = json.loads(LOCK.read_text(encoding="utf-8"))
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
