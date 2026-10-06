#!/usr/bin/env python3
"""Verify the golden App template: source lock, reproducible UI build, and API contract."""

from __future__ import annotations

import argparse
import filecmp
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

import app_contract as contract


TEMPLATE = contract.TEMPLATE
API_LITERAL = re.compile(r"""['"`](/api/[A-Za-z0-9_\-/]*(?:\$\{[^}]*\}[A-Za-z0-9_\-/]*)*)""")
MOUNTED_ROUTE = re.compile(r"""app\.(get|post|put|delete)\(\s*['"]([^'"]+)['"]""")


def rebuild_dist(template: Path, workdir: Path) -> Path:
    """Build the UI from a clean copy of the locked source with the locked dependencies."""
    source = workdir / "app"
    shutil.copytree(
        template,
        source,
        ignore=shutil.ignore_patterns("dist", *contract.IGNORED_NAMES),
    )
    subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=source, check=True, capture_output=True)
    subprocess.run(["npm", "run", "build:ui"], cwd=source, check=True, capture_output=True)
    return source / "dist"


def same_tree(left: Path, right: Path) -> bool:
    comparison = filecmp.dircmp(left, right)
    if comparison.left_only or comparison.right_only or comparison.funny_files:
        return False
    _, mismatch, errors = filecmp.cmpfiles(left, right, comparison.common_files, shallow=False)
    if mismatch or errors:
        return False
    return all(same_tree(left / name, right / name) for name in comparison.common_dirs)


def ui_api_calls(template: Path) -> set[str]:
    calls = set()
    for path in (template / "src").rglob("*"):
        if path.suffix in {".js", ".jsx"}:
            for match in API_LITERAL.finditer(path.read_text(encoding="utf-8")):
                route = re.sub(r"\$\{[^}]*\}", ":param", match.group(1))
                calls.add(contract.normalize_route(route))
    return calls


def mounted_routes(template: Path) -> dict[str, set[str]]:
    mounted: dict[str, set[str]] = {}
    for path in [template / "server.js", *sorted((template / "api").glob("*.js"))]:
        for method, route in MOUNTED_ROUTE.findall(path.read_text(encoding="utf-8")):
            mounted.setdefault(contract.normalize_route(route), set()).add(method.upper())
    return mounted


def identifier_hits(template: Path) -> list[str]:
    hits = []
    for path in contract.template_files(template):
        if path.suffix in {".png", ".jpg", ".ico", ".woff", ".woff2"}:
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for name, pattern in contract.IDENTIFIER_PATTERNS.items():
            if pattern.search(text):
                hits.append(f"{path.relative_to(template).as_posix()}: {name}")
    return hits


def validate_contract(template: Path = TEMPLATE) -> dict[str, bool]:
    app_jsx = (template / "src" / "App.jsx").read_text(encoding="utf-8")
    navigation = (template / "src" / "data" / "mockData.js").read_text(encoding="utf-8") + (
        template / "src" / "components" / "AppHeader.jsx"
    ).read_text(encoding="utf-8")
    package = json.loads((template / "package.json").read_text(encoding="utf-8"))
    app_yaml = (template / "app.yaml").read_text(encoding="utf-8")
    shell = (template / "dist" / "index.html").read_text(encoding="utf-8") if (template / "dist" / "index.html").is_file() else ""

    mounted = mounted_routes(template)
    get_routes = {contract.normalize_route(route) for route in contract.UI_GET_ROUTES}
    post_routes = {contract.normalize_route(route) for route in contract.UI_POST_ROUTES}
    param_routes = {contract.normalize_route(route) for route in contract.UI_PARAM_ROUTES}
    unmounted = {contract.normalize_route(route) for route in contract.KNOWN_UNMOUNTED}
    settings = [*contract.REQUIRED_SETTINGS, *contract.OPTIONAL_SETTINGS]
    shell_assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"', shell)

    return {
        "pages_routed": all(f'path="{page}"' in app_jsx for page in [*contract.PAGES, *contract.LEGACY_PAGES]),
        "navigation_stable": all(
            re.search(rf"label: '{re.escape(label)}'|>\s*{re.escape(label)}\s*<", navigation)
            for label in contract.PAGES.values()
        ),
        "get_routes_mounted": all("GET" in mounted.get(route, set()) for route in get_routes | param_routes),
        "post_routes_mounted": all("POST" in mounted.get(route, set()) for route in post_routes),
        "ui_calls_in_contract": ui_api_calls(template) <= get_routes | post_routes | param_routes | unmounted,
        "known_gaps_still_unmounted": not any(route in mounted for route in unmounted),
        "placeholders_only": all(f'- name: {key}\n    value: "__{key}__"' in app_yaml for key in settings),
        "no_platform_rebuild": "build" not in package.get("scripts", {}),
        "compiled_ui": bool(shell_assets) and all((template / "dist" / asset.lstrip("/")).is_file() for asset in shell_assets),
        "no_workspace_identifiers": not identifier_hits(template),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update-lock", action="store_true", help="Rebuild dist/ and approve the current template hashes")
    parser.add_argument("--skip-build", action="store_true", help="Skip the reproducible-build check (offline)")
    args = parser.parse_args()

    checks: dict[str, bool] = {}
    if args.update_lock or not args.skip_build:
        with tempfile.TemporaryDirectory(prefix="monday-morning-build-") as workdir:
            rebuilt = rebuild_dist(TEMPLATE, Path(workdir))
            if args.update_lock:
                shutil.rmtree(TEMPLATE / "dist", ignore_errors=True)
                shutil.copytree(rebuilt, TEMPLATE / "dist")
            checks["rebuild_matches_dist"] = same_tree(rebuilt, TEMPLATE / "dist")

    current = contract.snapshot()
    if args.update_lock:
        contract.LOCK.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    checks.update(validate_contract())
    approved = json.loads(contract.LOCK.read_text(encoding="utf-8")) if contract.LOCK.exists() else None
    checks["source_lock_present"] = approved is not None
    checks["source_lock_matches"] = approved == current
    result = {
        "passed": all(checks.values()),
        "template_version": contract.TEMPLATE_VERSION,
        "checks": checks,
        "identifier_hits": identifier_hits(TEMPLATE),
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
