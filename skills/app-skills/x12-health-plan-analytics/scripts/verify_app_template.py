#!/usr/bin/env python3
"""Verify the golden App contract and detect unapproved template drift."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "assets" / "app-template"
LOCK = TEMPLATE / "template-lock.json"
REQUIRED_ROUTES = {
    "/api/health",
    "/api/meta",
    "/api/dashboard",
    "/api/siu/providers",
    "/api/siu/provider/{provider}",
    "/api/siu/provider/{provider}/claims",
    "/api/siu/provider/{provider}/members",
    "/api/siu/provider/{provider}/member-list",
    "/api/siu/provider/{provider}/letter",
    "/api/siu/provider/{provider}/analysis",
    "/api/siu/provider/{provider}/genie",
    "/api/genie/ask",
}
REQUIRED_NAVIGATION = {"Dashboard", "SIU Workbench", "Ask Genie"}
REQUIRED_TABLES = {"claims", "claim_lines", "members", "providers", "payments", "enrollments", "data_quality"}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_files() -> list[Path]:
    files = [
        TEMPLATE / "app.py",
        TEMPLATE / "app.yaml",
        TEMPLATE / "app-config.json",
        TEMPLATE / "app-config.schema.json",
        TEMPLATE / "requirements.txt",
        TEMPLATE / "frontend" / "index.html",
        TEMPLATE / "frontend" / "package.json",
        TEMPLATE / "frontend" / "package-lock.json",
        TEMPLATE / "frontend" / "tsconfig.json",
        TEMPLATE / "frontend" / "vite.config.ts",
    ]
    files.extend(sorted((TEMPLATE / "server").glob("*.py")))
    files.extend(sorted((TEMPLATE / "frontend" / "src").glob("*.ts")))
    files.extend(sorted((TEMPLATE / "frontend" / "src").glob("*.tsx")))
    files.extend(sorted((TEMPLATE / "frontend" / "src").glob("*.css")))
    files.extend(sorted(
        path for path in (TEMPLATE / "frontend" / "dist").rglob("*") if path.is_file()
    ))
    return files


def snapshot() -> dict[str, object]:
    config = json.loads((TEMPLATE / "app-config.json").read_text(encoding="utf-8"))
    return {
        "template_version": config["template_version"],
        "files": {
            str(path.relative_to(TEMPLATE)): digest(path)
            for path in canonical_files()
        },
    }


def validate_contract() -> dict[str, bool]:
    backend = (TEMPLATE / "app.py").read_text(encoding="utf-8")
    shell = (TEMPLATE / "frontend" / "src" / "Shell.tsx").read_text(encoding="utf-8")
    config = json.loads((TEMPLATE / "app-config.json").read_text(encoding="utf-8"))
    schema = json.loads((TEMPLATE / "app-config.schema.json").read_text(encoding="utf-8"))
    package = json.loads((TEMPLATE / "frontend" / "package.json").read_text(encoding="utf-8"))
    return {
        "stable_api_routes": all(f'"{route}"' in backend for route in REQUIRED_ROUTES),
        "stable_navigation": all(label in shell for label in REQUIRED_NAVIGATION),
        "gold_table_mappings": REQUIRED_TABLES == set(config.get("tables", {})),
        "schema_requires_tables": REQUIRED_TABLES == set(schema["properties"]["tables"]["required"]),
        "semantic_version": len(str(config.get("template_version", "")).split(".")) == 3,
        "compiled_frontend": (TEMPLATE / "frontend" / "dist" / "index.html").exists(),
        "frontend_typecheck": "typecheck" in package.get("scripts", {}),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--update-lock", action="store_true", help="Approve the current canonical source hashes")
    parser.add_argument("--skip-build", action="store_true")
    args = parser.parse_args()

    if not args.skip_build:
        subprocess.run(["npm", "run", "typecheck"], cwd=TEMPLATE / "frontend", check=True)
        subprocess.run(["npm", "run", "build"], cwd=TEMPLATE / "frontend", check=True)

    current = snapshot()
    checks = validate_contract()
    if args.update_lock:
        LOCK.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    approved = json.loads(LOCK.read_text(encoding="utf-8")) if LOCK.exists() else None
    checks["source_lock_present"] = approved is not None
    checks["source_lock_matches"] = approved == current
    result = {
        "passed": all(checks.values()),
        "template_version": current["template_version"],
        "checks": checks,
    }
    print(json.dumps(result, indent=2, sort_keys=True))
    if not result["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
