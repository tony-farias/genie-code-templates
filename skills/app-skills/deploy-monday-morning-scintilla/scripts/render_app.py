#!/usr/bin/env python3
"""Copy the golden Monday Morning App byte-for-byte and inject deployment identifiers only."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess

import app_contract as contract


def setting_values(args: argparse.Namespace) -> dict[str, str]:
    values = {
        "WAREHOUSE_ID": args.warehouse_id,
        "CATALOG": args.catalog,
        "SCHEMA": args.schema,
        "AUTHORIZATION_MODE": args.authorization_mode,
        "GENIE_SPACE_ID": args.genie_space_id,
        "LLM_MODEL": args.model_endpoint,
        "OUTCOME_MAPS_URL": args.outcome_maps_url,
    }
    for key, value in values.items():
        if key in contract.REQUIRED_SETTINGS and not value.strip():
            raise ValueError(f"{key} is required")
        if re.fullmatch(r"__[A-Z_]+__", value) or re.search(r"[<>\n]", value):
            raise ValueError(f"{key} still looks like a placeholder or contains a newline")
    if values["AUTHORIZATION_MODE"] not in contract.AUTHORIZATION_MODES:
        raise ValueError("AUTHORIZATION_MODE must be one of " + ", ".join(contract.AUTHORIZATION_MODES))
    # Checked separately: a read-only SELECT entry may legitimately contain < or >.
    values["TABLE_MAP"] = table_map_value(getattr(args, "table_map", None))
    return values


TABLE_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def table_map_value(path: Path | None) -> str:
    """Validate a table map file and return it as compact JSON ("{}" when absent)."""
    if not path:
        return "{}"
    table_map = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(table_map, dict):
        raise ValueError("The table map must be a JSON object")
    allowed = set(contract.REQUIRED_TABLES) | set(contract.MAPPABLE_EXTRA_TABLES)
    for name, target in table_map.items():
        if name not in allowed:
            raise ValueError(f"Table map key {name!r} is not a table the App queries")
        if isinstance(target, str):
            if not TABLE_NAME.fullmatch(target):
                raise ValueError(f"Table map target for {name} must be a table name in the configured schema")
        elif isinstance(target, dict) and isinstance(target.get("select"), str):
            select = target["select"].strip()
            if not re.match(r"(?is)^(SELECT|WITH)\b", select) or ";" in select:
                raise ValueError(f"Table map entry for {name} must be a single read-only SELECT")
        else:
            raise ValueError(f"Table map entry for {name} must be a table name or {{\"select\": \"SELECT ...\"}}")
    return json.dumps(table_map, separators=(",", ":"), sort_keys=True)



def inside_git_worktree(path: Path) -> bool:
    """databricks sync applies a worktree's ignore rules and can silently skip files."""
    probe = path
    while not probe.exists():
        probe = probe.parent
    result = subprocess.run(
        ["git", "-C", str(probe), "rev-parse", "--is-inside-work-tree"],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def render_app_yaml(template_text: str, values: dict[str, str]) -> str:
    rendered = template_text
    for key, value in values.items():
        placeholder = f'"__{key}__"'
        if placeholder not in rendered:
            raise RuntimeError(f"app.yaml template lacks the {key} placeholder")
        # A JSON string is a valid double-quoted YAML scalar.
        rendered = rendered.replace(placeholder, json.dumps(value))
    if '"__' in rendered:
        raise RuntimeError("app.yaml still contains an unrendered placeholder")
    return rendered


def render(values: dict[str, str], output: Path) -> dict[str, object]:
    lock = contract.verify_template()
    if output.exists() and any(output.iterdir()):
        raise RuntimeError(f"Output directory {output} must be empty or absent")
    if inside_git_worktree(output):
        raise RuntimeError(
            f"Output {output} is inside a Git worktree; render outside it (for example under /tmp) "
            "so databricks sync uploads every file"
        )
    if output.exists():
        output.rmdir()
    shutil.copytree(contract.TEMPLATE, output, ignore=shutil.ignore_patterns(*contract.IGNORED_NAMES))
    app_yaml = output / "app.yaml"
    app_yaml.write_text(render_app_yaml(app_yaml.read_text(encoding="utf-8"), values), encoding="utf-8")

    problems = contract.tree_drift(output, lock, rendered=contract.RENDERED_FILES)
    if problems:
        raise RuntimeError("Rendered App differs from the golden lock: " + "; ".join(problems[:5]))
    return {
        "output": str(output),
        "template_version": lock["template_version"],
        "ui_shell_sha256": lock["files"]["dist/index.html"],
        "rendered_files": sorted(contract.RENDERED_FILES),
        "authorization_mode": values["AUTHORIZATION_MODE"],
        "required_user_api_scopes": (
            list(contract.USER_AUTHORIZATION_SCOPES) if values["AUTHORIZATION_MODE"] == "user" else []
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--catalog", required=True, help="Curated catalog the App queries")
    parser.add_argument("--schema", required=True, help="Curated schema the App queries")
    parser.add_argument(
        "--authorization-mode", choices=("user", "app"), default="user",
        help="Data identity for SQL and Genie: the signed-in viewer (default) or the App service principal",
    )
    parser.add_argument("--genie-space-id", required=True)
    parser.add_argument("--model-endpoint", required=True)
    parser.add_argument("--outcome-maps-url", default="", help="Optional sidebar link; omit to hide it")
    parser.add_argument(
        "--table-map", type=Path,
        help="JSON file mapping App table names to differently named tables in --catalog.--schema",
    )
    parser.add_argument("--output", type=Path, required=True, help="Empty directory outside any Git worktree")
    args = parser.parse_args()
    print(json.dumps(render(setting_values(args), args.output.resolve()), indent=2))


if __name__ == "__main__":
    main()
