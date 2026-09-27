#!/usr/bin/env python3
"""Idempotently create or update the deterministic X12 Genie Space."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=Path("deployment-state.json"))
    args = parser.parse_args()

    from databricks.sdk import WorkspaceClient

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    config = json.loads(args.config.read_text(encoding="utf-8"))
    if config.get("version") != 2:
        raise SystemExit("Genie serialized_space version must be 2")

    client = WorkspaceClient(profile=args.profile)
    user_name = client.current_user.me().user_name
    title = manifest["genie"]["title"]
    payload = {
        "title": title,
        "description": "Governed X12 claims, payments, enrollment, and aggregate parser-quality analytics. Raw X12 and direct member identifiers are excluded.",
        "warehouse_id": manifest["sql_warehouse_id"],
        "parent_path": f"/Users/{user_name}",
        "serialized_space": json.dumps(config, separators=(",", ":"), sort_keys=True),
    }

    space_id = None
    if args.state.exists():
        previous = json.loads(args.state.read_text(encoding="utf-8"))
        space_id = previous.get("genie_space_id")
    if not space_id:
        listing = client.api_client.do("GET", "/api/2.0/genie/spaces") or {}
        spaces = listing.get("spaces", listing.get("data", [])) if isinstance(listing, dict) else []
        match = next((space for space in spaces if space.get("title") == title and space.get("parent_path") == payload["parent_path"]), None)
        if match:
            space_id = match.get("space_id", match.get("id"))

    if space_id:
        response = client.api_client.do("PATCH", f"/api/2.0/genie/spaces/{space_id}", body=payload)
        action = "updated"
    else:
        response = client.api_client.do("POST", "/api/2.0/genie/spaces", body=payload)
        space_id = response.get("space_id", response.get("id"))
        action = "created"
    if not space_id:
        raise RuntimeError("Genie API did not return a space ID")

    state = json.loads(args.state.read_text(encoding="utf-8")) if args.state.exists() else {}
    host = client.config.host.rstrip("/")
    state.update({
        "genie_space_id": space_id,
        "genie_title": title,
        "genie_url": f"{host}/genie/rooms/{space_id}",
    })
    args.state.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"action": action, "space_id": space_id, "url": state["genie_url"]}, indent=2))


if __name__ == "__main__":
    main()
