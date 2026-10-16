#!/usr/bin/env python3
"""Read-only permission and resource preflight for X12 Health Plan Analytics deployments.

Run it before discovery (inventory stage) and again before any write or deployment
(deployment stage). It never creates, grants, deploys, runs a job, or reads payloads.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import subprocess
import time
from typing import Any, Iterable


PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"
GOLD_TABLES = ("claims", "claim_lines", "members", "providers", "payments", "enrollments", "data_quality")
# Scopes Databricks Apps grants every App; they reach no data or compute.
DEFAULT_USER_SCOPES = {"IAM_ACCESS_CONTROL_READ", "IAM_CURRENT_USER_READ"}
# User mode needs sql (not sql:restricted-query, whose tokens cannot fetch results of
# statements that outlive the 50-second wait) and genie.
USER_MODE_SCOPES = {"SQL", "GENIE"}


@dataclass
class Check:
    name: str
    status: str
    detail: str
    remediation: str | None = None


class CliError(RuntimeError):
    """Databricks CLI invocation failed without exposing credentials."""


class DatabricksCli:
    def __init__(self, profile: str):
        self.profile = profile

    def json(self, arguments: list[str]) -> dict[str, Any]:
        command = ["databricks", *arguments, "--profile", self.profile, "--output", "json"]
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            message = result.stderr.strip() or result.stdout.strip() or "Databricks CLI command failed"
            raise CliError(message)
        try:
            value = json.loads(result.stdout or "{}")
        except json.JSONDecodeError as exc:
            raise CliError("Databricks CLI returned invalid JSON") from exc
        if not isinstance(value, dict):
            raise CliError("Databricks CLI returned an unexpected JSON value")
        return value

    def statement(self, warehouse_id: str, statement: str) -> dict[str, Any]:
        payload = {
            "statement": statement,
            "warehouse_id": warehouse_id,
            "format": "JSON_ARRAY",
            "wait_timeout": "30s",
        }
        response = self.json([
            "api", "post", "/api/2.0/sql/statements/", f"--json={json.dumps(payload)}"
        ])
        for _ in range(20):
            state = statement_state(response)
            if state not in {"PENDING", "RUNNING"}:
                break
            statement_id = response.get("statement_id")
            if not statement_id:
                raise CliError("Statement response omitted its statement ID")
            time.sleep(0.5)
            response = self.json(["api", "get", f"/api/2.0/sql/statements/{statement_id}"])
        state = statement_state(response)
        if state != "SUCCEEDED":
            error = response.get("status", {}).get("error", {})
            message = error.get("message") if isinstance(error, dict) else None
            raise CliError(message or f"SQL statement ended in state {state or 'UNKNOWN'}")
        return response


def statement_state(response: dict[str, Any]) -> str:
    status = response.get("status") or {}
    return normalize(status.get("state", ""))


def first_scalar(response: dict[str, Any]) -> Any:
    rows = (response.get("result") or {}).get("data_array") or []
    if not rows or not isinstance(rows[0], list) or not rows[0]:
        return None
    return rows[0][0]


def normalize(value: Any) -> str:
    return str(value or "").strip().upper().replace(" ", "_").replace("-", "_")


def quote_identifier(value: str) -> str:
    if not value or "\x00" in value:
        raise ValueError("Identifiers must be non-empty and cannot contain NUL")
    return "`" + value.replace("`", "``") + "`"


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def current_principals(identity: dict[str, Any]) -> set[str]:
    principals = {
        str(identity.get("user_name") or identity.get("userName") or ""),
    }
    for group in identity.get("groups") or []:
        if isinstance(group, dict):
            principals.add(str(group.get("display") or group.get("display_name") or ""))
    return {value for value in principals if value}


def extract_privileges(payload: dict[str, Any]) -> set[str]:
    privileges: set[str] = set()
    assignments = (
        payload.get("effective_privilege_assignments")
        or payload.get("privilege_assignments")
        or payload.get("privilegeAssignments")
        or []
    )
    for assignment in assignments:
        if not isinstance(assignment, dict):
            continue
        for item in assignment.get("privileges") or []:
            value = item
            if isinstance(item, dict):
                value = item.get("privilege") or item.get("permission_level")
            if value:
                privileges.add(normalize(value))
    return privileges


def effective_privileges(
    client: DatabricksCli,
    securable_type: str,
    full_name: str,
    principals: Iterable[str],
) -> tuple[set[str], list[str]]:
    privileges: set[str] = set()
    errors: list[str] = []
    for principal in sorted(set(principals)):
        try:
            response = client.json([
                "grants", "get-effective", securable_type, full_name, "--principal", principal
            ])
            privileges.update(extract_privileges(response))
        except CliError as exc:
            errors.append(f"{principal}: {exc}")
    return privileges, errors


def privilege_check(
    name: str,
    actual: set[str],
    required: set[str],
    errors: list[str],
    remediation: str,
) -> Check:
    if "ALL_PRIVILEGES" in actual:
        missing: set[str] = set()
    else:
        missing = required - actual
    if not missing:
        return Check(name, PASS, "Effective privileges include " + ", ".join(sorted(required)))
    error_note = f" Effective-permission errors: {'; '.join(errors)}" if errors else ""
    return Check(
        name,
        FAIL,
        "Missing effective privileges: " + ", ".join(sorted(missing)) + "." + error_note,
        remediation,
    )


def acl_levels(payload: dict[str, Any], principals: Iterable[str]) -> set[str]:
    expected = set(principals)
    levels: set[str] = set()
    for entry in payload.get("access_control_list") or []:
        if not isinstance(entry, dict):
            continue
        names = {
            str(entry.get("user_name") or ""),
            str(entry.get("group_name") or ""),
            str(entry.get("service_principal_name") or ""),
        }
        if not (expected & names):
            continue
        for item in entry.get("all_permissions") or []:
            if isinstance(item, dict) and item.get("permission_level"):
                levels.add(normalize(item["permission_level"]))
    return levels


def has_level(levels: set[str], required: str) -> bool:
    hierarchy = {
        "CAN_VIEW": 1,
        "CAN_USE": 2,
        "CAN_RUN": 2,
        "CAN_QUERY": 2,
        "CAN_EDIT": 3,
        "CAN_MANAGE_RUN": 3,
        "CAN_MANAGE": 4,
        "IS_OWNER": 5,
    }
    threshold = hierarchy.get(normalize(required), 999)
    return any(hierarchy.get(normalize(level), 0) >= threshold for level in levels)


def add_cli_check(
    checks: list[Check],
    name: str,
    operation,
    success_detail: str,
    remediation: str,
) -> dict[str, Any] | None:
    try:
        value = operation()
        checks.append(Check(name, PASS, success_detail))
        return value
    except CliError as exc:
        checks.append(Check(name, FAIL, str(exc), remediation))
        return None


def user_scopes(app: dict[str, Any]) -> set[str]:
    """Normalized user authorization scopes requested by the App."""
    return {
        normalize(scope).replace(":", "_").replace(".", "_")
        for scope in app.get("user_api_scopes") or []
    }


def viewer_privilege_check(
    name: str,
    actual: set[str],
    required: set[str],
    errors: list[str],
    remediation: str,
) -> Check:
    """Viewer grants that cannot be inspected need runtime confirmation, not a hard stop."""
    check = privilege_check(name, actual, required, errors, remediation)
    if check.status == FAIL and errors:
        return Check(
            name,
            WARN,
            "Could not confirm the viewer group's privileges; validate as a viewer after deployment. "
            + check.detail,
            remediation,
        )
    return check



def authorization_scope_check(app: dict[str, Any], mode: str) -> Check:
    scopes = user_scopes(app) - DEFAULT_USER_SCOPES
    if mode == "app":
        if scopes:
            return Check(
                "app.authorization_mode", FAIL,
                "App mode ignores viewer tokens, but the App requests user scopes: " + ", ".join(sorted(scopes)),
                "Remove the user authorization scopes, or deploy in user mode.",
            )
        return Check("app.authorization_mode", PASS, "SQL and Genie run as the App service principal")
    if scopes == USER_MODE_SCOPES:
        return Check("app.authorization_mode", PASS, "Signed-in viewers authorize SQL (sql) and Genie (genie)")
    if scopes == {"SQL", "DASHBOARDS_GENIE"}:
        return Check("app.authorization_mode", WARN, "The App uses the deprecated dashboards.genie scope name",
                     "Replace dashboards.genie with genie in the App's user authorization scopes.")
    problems = []
    if "SQL_RESTRICTED_QUERY" in scopes:
        problems.append("sql:restricted-query cannot fetch results of queries that run past the 50-second wait")
    missing = USER_MODE_SCOPES - scopes
    extra = scopes - USER_MODE_SCOPES - {"DASHBOARDS_GENIE"}
    if missing:
        problems.append("missing " + ", ".join(sorted(scope.lower() for scope in missing)))
    if extra:
        problems.append("unexpected " + ", ".join(sorted(extra)))
    return Check("app.authorization_mode", FAIL, "; ".join(problems),
                 "Set the App's user authorization scopes to exactly sql and genie, then rerun.")


def build_report(args: argparse.Namespace, client: DatabricksCli) -> dict[str, Any]:
    checks: list[Check] = []
    user_mode = args.authorization_mode == "user"
    identity = add_cli_check(
        checks, "caller.identity", lambda: client.json(["current-user", "me"]),
        "Authenticated caller resolved", "Authenticate with a named Databricks CLI profile and rerun.",
    )
    if not identity:
        return finish_report(args, checks, {})
    principals = current_principals(identity)

    # Warehouse used by discovery, Gold validation, the App, and Genie.
    warehouse = add_cli_check(
        checks, "warehouse.exists", lambda: client.json(["warehouses", "get", args.warehouse_id]),
        "SQL warehouse exists", "Provide the ID of an existing SQL warehouse.",
    )
    if warehouse:
        state = normalize(warehouse.get("state"))
        checks.append(Check(
            "warehouse.running", PASS if state == "RUNNING" else WARN,
            f"Warehouse state is {state or 'UNKNOWN'}",
            None if state == "RUNNING" else "Start the warehouse, or expect a cold start on the first query.",
        ))
        add_cli_check(
            checks, "warehouse.can_use",
            lambda: client.statement(args.warehouse_id, "SELECT 1 AS permission_probe"),
            "Caller executed a read-only SQL statement", "Grant the caller CAN USE on the SQL warehouse.",
        )

    # Source: a table/view with raw payloads, or a Volume directory of raw X12 files.
    if args.source_table:
        parts = args.source_table.split(".")
        if len(parts) != 3:
            checks.append(Check("source.identifier", FAIL, "Source table must be catalog.schema.table",
                                "Pass the confirmed three-part table name."))
        else:
            full_name = ".".join(quote_identifier(part) for part in parts)
            add_cli_check(
                checks, "source.table_select",
                lambda: client.statement(args.warehouse_id, f"SELECT 1 AS permission_probe FROM {full_name} LIMIT 1"),
                "Caller can read the source table", f"Grant USE CATALOG, USE SCHEMA, and SELECT on {args.source_table}.",
            )
    if args.source_volume_path:
        path = args.source_volume_path.rstrip("/")
        if not path.startswith("/Volumes/"):
            checks.append(Check("source.volume_path", FAIL, "Volume paths start with /Volumes/<catalog>/<schema>/<volume>",
                                "Pass the confirmed Volume directory."))
        else:
            add_cli_check(
                checks, "source.volume_read",
                lambda: client.statement(
                    args.warehouse_id,
                    f"SELECT 1 AS permission_probe FROM read_files({sql_literal(path)}, format => 'text', "
                    "wholeText => true, recursiveFileLookup => true) LIMIT 1",
                ),
                "Caller can read files in the source Volume",
                "Grant USE CATALOG, USE SCHEMA, and READ VOLUME on the source Volume.",
            )
    if args.stage == "deployment" and not (args.source_table or args.source_volume_path):
        checks.append(Check("deployment.source", FAIL, "No confirmed source was supplied",
                            "Rerun with --source-table or --source-volume-path from the deployment manifest."))

    # Target namespace for Bronze, Silver, and Gold.
    catalog_privileges, catalog_errors = effective_privileges(client, "CATALOG", args.target_catalog, principals)
    checks.append(privilege_check(
        "target_catalog.permissions", catalog_privileges, {"USE_CATALOG"}, catalog_errors,
        f"Grant USE CATALOG on {args.target_catalog}.",
    ))
    target_schema = f"{args.target_catalog}.{args.target_schema}"
    schema_exists = True
    try:
        client.json(["schemas", "get", target_schema])
    except CliError:
        schema_exists = False
    if schema_exists:
        schema_privileges, schema_errors = effective_privileges(client, "SCHEMA", target_schema, principals)
        checks.append(privilege_check(
            "target_schema.permissions", schema_privileges,
            {"USE_SCHEMA", "CREATE_TABLE", "MODIFY", "SELECT"}, schema_errors,
            f"Grant USE SCHEMA, CREATE TABLE, MODIFY, and SELECT on {target_schema}.",
        ))
    else:
        checks.append(privilege_check(
            "target_schema.can_create", catalog_privileges, {"CREATE_SCHEMA"}, catalog_errors,
            f"Have an administrator create {target_schema}, or grant CREATE SCHEMA on {args.target_catalog}.",
        ))

    # The parser job runs on a classic job cluster (its RDD calls need classic compute).
    entitlements = {normalize(item.get("value")) for item in identity.get("entitlements") or []}
    if "ALLOW_CLUSTER_CREATE" in entitlements:
        checks.append(Check("compute.job_cluster", PASS, "Caller may create the parser job cluster"))
    else:
        checks.append(Check(
            "compute.job_cluster", WARN,
            "Cluster-creation rights are not visible on the caller (they may come from a group)",
            "Confirm the caller can create a job cluster, or set a cluster policy the caller may use in the bundle.",
        ))

    # App identity and scopes.
    app = None
    try:
        app = client.json(["apps", "get", args.app_name])
    except CliError:
        checks.append(Check(
            "app.exists", WARN, f"App {args.app_name} does not exist yet",
            "deploy_app.py will create it with the scopes for the selected authorization mode.",
        ))
    if app:
        checks.append(Check("app.exists", PASS, f"Existing App {args.app_name} resolved"))
        checks.append(authorization_scope_check(app, args.authorization_mode))
        try:
            permissions = client.json(["apps", "get-permissions", args.app_name])
            can_manage = has_level(acl_levels(permissions, principals), "CAN_MANAGE")
            checks.append(Check(
                "app.caller_can_manage", PASS if can_manage else FAIL,
                "Caller has CAN MANAGE" if can_manage else "Caller lacks CAN MANAGE",
                None if can_manage else f"Grant the caller CAN MANAGE on {args.app_name}.",
            ))
        except CliError as exc:
            checks.append(Check("app.caller_can_manage", FAIL, str(exc), "Grant the caller CAN MANAGE on the App."))

    # Viewers read Gold and run Genie themselves in user mode.
    if user_mode and args.viewer_group:
        viewer_principals = {args.viewer_group, "account users"}
        privileges, errors = effective_privileges(client, "CATALOG", args.target_catalog, viewer_principals)
        checks.append(viewer_privilege_check(
            "viewer_group.catalog_permissions", privileges, {"USE_CATALOG"}, errors,
            f"Grant USE CATALOG on {args.target_catalog} to group {args.viewer_group}.",
        ))
        if schema_exists:
            privileges, errors = effective_privileges(client, "SCHEMA", target_schema, viewer_principals)
            checks.append(viewer_privilege_check(
                "viewer_group.gold_permissions", privileges, {"USE_SCHEMA", "SELECT"}, errors,
                f"Grant USE SCHEMA and SELECT on the Gold tables in {target_schema} to group {args.viewer_group}.",
            ))
        if warehouse:
            try:
                acl = client.json(["warehouses", "get-permissions", args.warehouse_id])
                can_use = has_level(acl_levels(acl, {args.viewer_group, "users"}), "CAN_USE")
                checks.append(Check(
                    "warehouse.viewer_group_can_use", PASS if can_use else FAIL,
                    f"{args.viewer_group} can use the warehouse" if can_use else f"{args.viewer_group} lacks CAN USE",
                    None if can_use else f"Grant CAN USE on the warehouse to group {args.viewer_group}.",
                ))
            except CliError as exc:
                checks.append(Check("warehouse.viewer_group_can_use", WARN, f"Could not read warehouse permissions: {exc}",
                                    f"Confirm group {args.viewer_group} has CAN USE on the warehouse."))
    elif user_mode and args.stage == "deployment":
        checks.append(Check("viewer_group.supplied", WARN, "No viewer group supplied; only the caller's access was checked",
                            "Rerun with --viewer-group for the group that will use the App."))

    for space_id in args.genie_space_id:
        try:
            acl = client.json(["api", "get", f"/api/2.0/permissions/genie/{space_id}"])
            who = {args.viewer_group, "users"} if user_mode and args.viewer_group else principals
            can_run = has_level(acl_levels(acl, who), "CAN_RUN")
            checks.append(Check(
                f"genie_space.{space_id}.can_run", PASS if can_run else FAIL,
                "Genie Space is runnable by " + ("the viewer group" if user_mode and args.viewer_group else "the caller"),
                None if can_run else "Grant CAN RUN on the Genie Space (deploy_genie.py --viewer-group does this).",
            ))
        except CliError as exc:
            checks.append(Check(f"genie_space.{space_id}.can_run", FAIL, str(exc), "Provide an existing, accessible Genie Space."))

    return finish_report(args, checks, identity)


def finish_report(args: argparse.Namespace, checks: list[Check], identity: dict[str, Any]) -> dict[str, Any]:
    blocking = [check for check in checks if check.status == FAIL]
    return {
        "version": 1,
        "stage": args.stage,
        "read_only": True,
        "authorization_mode": args.authorization_mode,
        "caller": identity.get("user_name") or identity.get("userName"),
        "requested": {
            "source_table": args.source_table,
            "source_volume_path": args.source_volume_path,
            "target": f"{args.target_catalog}.{args.target_schema}",
            "warehouse_id": args.warehouse_id,
            "app_name": args.app_name,
            "viewer_group": args.viewer_group,
            "genie_space_ids": sorted(set(args.genie_space_id)),
        },
        "ready": not blocking,
        "summary": {
            "passed": sum(check.status == PASS for check in checks),
            "warnings": sum(check.status == WARN for check in checks),
            "failed": len(blocking),
        },
        "checks": [asdict(check) for check in checks],
        "limitations": [
            "This preflight performs no CREATE, GRANT, deployment, job run, or Genie conversation, and reads no payloads.",
            "Grants made to a viewer's other groups are not visible here; validate as a viewer after deployment.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--stage", choices=("inventory", "deployment"), default="inventory")
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--source-table", help="Confirmed catalog.schema.table with raw X12 payloads")
    source.add_argument("--source-volume-path", help="Confirmed /Volumes/... directory of raw X12 files")
    parser.add_argument("--target-catalog", required=True)
    parser.add_argument("--target-schema", required=True)
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--authorization-mode", choices=("user", "app"), default="user")
    parser.add_argument("--viewer-group", help="Group that will use the App (user mode checks its access)")
    parser.add_argument("--genie-space-id", action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = build_report(args, DatabricksCli(args.profile))
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, sort_keys=True))
    if not report["ready"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
