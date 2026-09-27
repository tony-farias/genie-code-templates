#!/usr/bin/env python3
"""Copy the fixed App asset and inject deployment identifiers only."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "assets" / "app-template"
TEMPLATE_LOCK = TEMPLATE / "template-lock.json"


def verify_template_lock() -> dict[str, object]:
    if not TEMPLATE_LOCK.exists():
        raise RuntimeError("Golden App source lock is missing")
    lock = json.loads(TEMPLATE_LOCK.read_text(encoding="utf-8"))
    for relative_path, expected in lock.get("files", {}).items():
        path = TEMPLATE / relative_path
        if not path.is_file():
            raise RuntimeError(f"Golden App file is missing: {relative_path}")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            raise RuntimeError(
                f"Unapproved Golden App drift in {relative_path}; "
                "update the template version and approve a new source lock"
            )
    return lock


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("build/app"))
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    state = json.loads(args.state.read_text(encoding="utf-8"))
    lock = verify_template_lock()
    if manifest["app"]["template_version"] != lock.get("template_version"):
        raise RuntimeError(
            "Deployment manifest template version does not match the approved Golden App lock"
        )

    if args.output.exists():
        shutil.rmtree(args.output)
    shutil.copytree(
        TEMPLATE,
        args.output,
        ignore=shutil.ignore_patterns("node_modules", "__pycache__", ".DS_Store"),
    )

    catalog = manifest["destination"]["catalog"]
    schema = manifest["destination"]["schema"]
    prefix = manifest["destination"]["table_prefix"]
    fq = lambda name: f"{catalog}.{schema}.{prefix}gold_{name}"
    config = {
        "template_version": manifest["app"]["template_version"],
        "catalog": catalog,
        "schema": schema,
        "warehouse_id": manifest["sql_warehouse_id"],
        "genie_space_id": state["genie_space_id"],
        "genie_agent_id": state["genie_space_id"],
        "genie_url": state["genie_url"],
        "branding": {
            "product_name": "FWA Shield",
            "plan_name": "Health Plan Analytics",
            "segment": "Governed X12 claims and payment analytics",
        },
        "benchmark": {
            "high_peer_ratio": 1.5,
            "medium_peer_ratio": 1.2,
            "minimum_claims": 1,
            "minimum_codes": 1,
        },
        "features": {
            "provider_analysis": True,
            "letters": True,
            "embedded_genie": True,
            "member_utilization": True,
        },
        "tables": {name: fq(name) for name in (
            "claims", "claim_lines", "members", "providers", "payments", "enrollments", "data_quality"
        )},
    }
    (args.output / "app-config.json").write_text(json.dumps(config, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    style_hash = hashlib.sha256(next((args.output / "frontend" / "dist" / "assets").glob("*.css")).read_bytes()).hexdigest()
    print(json.dumps({
        "output": str(args.output),
        "template_version": config["template_version"],
        "css_sha256": style_hash,
    }, indent=2))


if __name__ == "__main__":
    main()
