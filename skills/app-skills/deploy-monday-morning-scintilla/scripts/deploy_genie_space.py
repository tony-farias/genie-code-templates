#!/usr/bin/env python3
"""Create the Monday Morning Genie Space from build_genie_space.py output, or update one you name.

Without --space-id it always creates a new space; it never finds a space to overwrite
by title, because shared spaces often share a title. Pass --space-id (for example from
an earlier run's output) to update that exact space. In user mode, grant the viewer
group CAN RUN; the App identity needs no access.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess

from build_genie_space import DESCRIPTION, TITLE


def api(profile: str, method: str, path: str, body: dict | None = None) -> dict:
    command = ["databricks", "api", method, path, "--profile", profile]
    if body is not None:
        command += ["--json", json.dumps(body)]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f"{method.upper()} {path} failed: {result.stderr.strip()[:400]}")
    return json.loads(result.stdout or "{}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--config", type=Path, required=True, help="build_genie_space.py output")
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--title", default=TITLE)
    parser.add_argument("--parent-path", help="Workspace folder for the space (default: the caller's home)")
    parser.add_argument("--viewer-group", help="Grant this group CAN RUN (user authorization mode)")
    parser.add_argument("--space-id", help="Update this exact space instead of creating a new one")
    parser.add_argument("--output", type=Path, required=True, help="Writes the space ID and URL here")
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8"))
    if config.get("version") != 2:
        raise SystemExit("serialized_space version must be 2")
    me = api(args.profile, "get", "/api/2.0/preview/scim/v2/Me")
    parent = args.parent_path or f"/Users/{me['userName']}"
    payload = {
        "title": args.title,
        "description": DESCRIPTION,
        "warehouse_id": args.warehouse_id,
        "parent_path": parent,
        "serialized_space": json.dumps(config, separators=(",", ":"), sort_keys=True),
    }
    if args.space_id:
        space_id = args.space_id
        # Keep a copy of the space being replaced, so an update can be undone.
        previous = api(args.profile, "get", f"/api/2.0/genie/spaces/{space_id}?include_serialized_space=true")
        backup = args.output.with_name(f"{args.output.stem}.previous-{space_id}.json")
        backup.write_text(json.dumps(previous, indent=2) + "\n", encoding="utf-8")
        payload.pop("parent_path")
        api(args.profile, "patch", f"/api/2.0/genie/spaces/{space_id}", payload)
        action = "updated"
    else:
        created = api(args.profile, "post", "/api/2.0/genie/spaces", payload)
        space_id = created.get("space_id") or created.get("id")
        action = "created"
    if args.viewer_group:
        api(args.profile, "patch", f"/api/2.0/permissions/genie/{space_id}", {
            "access_control_list": [{"group_name": args.viewer_group, "permission_level": "CAN_RUN"}],
        })
    host = subprocess.run(["databricks", "auth", "describe", "--profile", args.profile, "--output", "json"],
                          capture_output=True, text=True)
    url_host = json.loads(host.stdout or "{}").get("details", {}).get("host", "") if host.returncode == 0 else ""
    result = {"action": action, "space_id": space_id, "title": args.title,
              "previous_version": str(backup) if args.space_id else None,
              "url": f"{url_host.rstrip('/')}/genie/rooms/{space_id}" if url_host else None,
              "viewer_group_can_run": args.viewer_group}
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
