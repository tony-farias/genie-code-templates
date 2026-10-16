#!/usr/bin/env python3
"""Deploy the rendered App; SQL and Genie run as the viewer (user mode) or the App (app mode)."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


# User mode. `sql`, not `sql:restricted-query`: restricted tokens cannot fetch the
# result of a statement that outlives the 50-second Statement Execution wait.
USER_API_SCOPES = ("sql", "genie")
GOLD_TABLES = ("claims", "claim_lines", "members", "providers", "payments", "enrollments", "data_quality")


def app_spec(warehouse_id: str, authorization_mode: str) -> dict[str, object]:
    """Return the stable Databricks App definition used for create and update."""
    if authorization_mode not in ("user", "app"):
        raise ValueError("authorization_mode must be user or app")
    return {
        "description": "Governed X12 health-plan analytics",
        "resources": [{
            "name": "analytics-warehouse",
            "description": "Executes read-only queries against curated X12 Gold tables",
            "sql_warehouse": {"id": warehouse_id, "permission": "CAN_USE"},
        }],
        # User mode forwards each viewer's token for SQL and Genie; app mode
        # requests no user scopes and runs both as the App service principal.
        "user_api_scopes": list(USER_API_SCOPES) if authorization_mode == "user" else [],
    }


def run(command: list[str], *, allow_failure: bool = False) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode and not allow_failure:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "Command failed")
    return result


def execute(client, warehouse_id: str, statement: str) -> None:
    response = client.statement_execution.execute_statement(
        warehouse_id=warehouse_id, statement=statement, wait_timeout="10s"
    )
    deadline = time.monotonic() + 180
    while response.status and str(response.status.state).upper().endswith(("PENDING", "RUNNING")):
        if time.monotonic() >= deadline:
            client.statement_execution.cancel_execution(response.statement_id)
            raise TimeoutError("Grant statement timed out")
        time.sleep(1)
        response = client.statement_execution.get_statement(response.statement_id)
    state = str(response.status.state) if response.status and response.status.state else "UNKNOWN"
    if "SUCCEEDED" not in state:
        message = response.status.error.message if response.status and response.status.error else state
        raise RuntimeError(f"Grant statement failed: {message}")


def principal(value: str) -> str:
    return "`" + value.replace("`", "``") + "`"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--app-dir", type=Path, required=True)
    parser.add_argument("--state", type=Path, default=Path("deployment-state.json"))
    parser.add_argument(
        "--viewer-group",
        help="User mode: grant this group USE CATALOG, USE SCHEMA, and SELECT on the Gold tables and CAN USE on the App",
    )
    args = parser.parse_args()

    from databricks.sdk import WorkspaceClient

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    app_name = manifest["app"]["name"]
    warehouse_id = manifest["sql_warehouse_id"]
    authorization_mode = manifest["app"].get("authorization_mode", "user")
    profile_args = ["--profile", args.profile]

    existing = run(["databricks", "apps", "get", app_name, "--output", "json", *profile_args], allow_failure=True)
    definition = app_spec(warehouse_id, authorization_mode)
    if existing.returncode:
        run([
            "databricks", "apps", "create",
            "--json", json.dumps({"name": app_name, **definition}),
            *profile_args,
        ])
        action = "created"
    else:
        run([
            "databricks", "apps", "update", app_name,
            "--json", json.dumps(definition),
            *profile_args,
        ])
        action = "updated"

    app = json.loads(run(["databricks", "apps", "get", app_name, "--output", "json", *profile_args]).stdout)
    app_principal = str(app.get("service_principal_client_id") or app.get("service_principal_name") or "")
    if not app_principal:
        raise RuntimeError("App service principal was not returned")

    client = WorkspaceClient(profile=args.profile)
    catalog = manifest["destination"]["catalog"]
    schema = manifest["destination"]["schema"]
    prefix = manifest["destination"]["table_prefix"]
    state = json.loads(args.state.read_text(encoding="utf-8")) if args.state.exists() else {}

    def grant_gold(grantee: str) -> None:
        execute(client, warehouse_id, f"GRANT USE CATALOG ON CATALOG `{catalog}` TO {grantee}")
        execute(client, warehouse_id, f"GRANT USE SCHEMA ON SCHEMA `{catalog}`.`{schema}` TO {grantee}")
        for name in GOLD_TABLES:
            execute(
                client,
                warehouse_id,
                f"GRANT SELECT ON TABLE `{catalog}`.`{schema}`.`{prefix}gold_{name}` TO {grantee}",
            )

    grants: dict[str, object] = {"app_service_principal": "none (user mode)"}
    if authorization_mode == "app":
        # The App identity reads Gold and runs Genie, so it needs both.
        grant_gold(principal(app_principal))
        if state.get("genie_space_id"):
            run([
                "databricks", "api", "patch", f"/api/2.0/permissions/genie/{state['genie_space_id']}",
                "--json", json.dumps({"access_control_list": [
                    {"service_principal_name": app_principal, "permission_level": "CAN_RUN"},
                ]}),
                *profile_args,
            ])
        grants = {"app_service_principal": "Gold SELECT and Genie CAN_RUN"}
    elif args.viewer_group:
        grant_gold(principal(args.viewer_group))
        run([
            "databricks", "apps", "update-permissions", app_name,
            "--json", json.dumps({"access_control_list": [
                {"group_name": args.viewer_group, "permission_level": "CAN_USE"},
            ]}),
            *profile_args,
        ])
        grants["viewer_group"] = f"{args.viewer_group}: Gold SELECT and App CAN_USE"

    user_name = client.current_user.me().user_name
    workspace_path = f"/Workspace/Users/{user_name}/{app_name}"
    # Rendered builds normally live under an ignored build/ directory. Stage the
    # exact deployable tree outside the Git worktree so `databricks sync` does
    # not inherit repository ignore rules and silently upload zero files.
    with tempfile.TemporaryDirectory(prefix="x12-app-sync-") as temp_dir:
        staging_dir = Path(temp_dir) / "app"
        shutil.copytree(
            args.app_dir.resolve(),
            staging_dir,
            ignore=shutil.ignore_patterns("node_modules", "__pycache__", "*.pyc"),
        )
        run([
            "databricks", "sync", str(staging_dir), workspace_path,
            "--full", *profile_args,
        ])
        run([
            "databricks", "apps", "deploy", app_name,
            "--source-code-path", workspace_path,
            "--mode", "SNAPSHOT", "--timeout", "20m", *profile_args,
        ])
    app = json.loads(run(["databricks", "apps", "get", app_name, "--output", "json", *profile_args]).stdout)
    state.update({
        "app_name": app_name,
        "app_url": app.get("url"),
        "app_service_principal": app_principal,
        "authorization_mode": authorization_mode,
        "user_api_scopes": app.get("user_api_scopes") or [],
    })
    args.state.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "action": action,
        "app_name": app_name,
        "url": app.get("url"),
        "authorization_mode": authorization_mode,
        "grants": grants,
    }, indent=2))


if __name__ == "__main__":
    main()
