#!/usr/bin/env python3
"""Read-only permission and resource preflight for Monday Morning deployments."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, Iterable


PASS = "PASS"
WARN = "WARN"
FAIL = "FAIL"


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


def binding_has_permission(actual: str, required: str) -> bool:
    return normalize(actual) in {normalize(required), "CAN_MANAGE", "IS_OWNER"}


def service_principal_id(app: dict[str, Any]) -> str:
    nested = app.get("service_principal") or {}
    return str(
        app.get("service_principal_client_id")
        or app.get("application_id")
        or nested.get("client_id")
        or nested.get("application_id")
        or ""
    )


def app_bindings(app: dict[str, Any]) -> dict[str, list[tuple[str, str]]]:
    bindings: dict[str, list[tuple[str, str]]] = {
        "warehouse": [],
        "serving_endpoint": [],
        "genie_space": [],
        "other": [],
    }
    for resource in app.get("resources") or []:
        if not isinstance(resource, dict):
            continue
        recognized = False
        warehouse = resource.get("sql_warehouse") or resource.get("sqlWarehouse")
        if isinstance(warehouse, dict):
            recognized = True
            bindings["warehouse"].append((
                str(warehouse.get("id") or warehouse.get("warehouse_id") or ""),
                normalize(warehouse.get("permission")),
            ))
        endpoint = resource.get("serving_endpoint") or resource.get("servingEndpoint")
        if isinstance(endpoint, dict):
            recognized = True
            bindings["serving_endpoint"].append((
                str(endpoint.get("name") or endpoint.get("endpoint_name") or ""),
                normalize(endpoint.get("permission")),
            ))
        genie = resource.get("genie_space") or resource.get("genieSpace")
        if isinstance(genie, dict):
            recognized = True
            bindings["genie_space"].append((
                str(genie.get("id") or genie.get("space_id") or ""),
                normalize(genie.get("permission")),
            ))
        if not recognized:
            kinds = sorted(key for key in resource if key not in {"name", "description"})
            label = str(resource.get("name") or ",".join(kinds) or "unknown")
            bindings["other"].append((label, ""))
    return bindings


def binding_check(
    name: str,
    actual: list[tuple[str, str]],
    expected_ids: set[str],
    required_permission: str,
    remediation: str,
) -> Check:
    actual_ids = {resource_id for resource_id, _ in actual if resource_id}
    missing = expected_ids - actual_ids
    stale = actual_ids - expected_ids
    weak = {
        resource_id
        for resource_id, permission in actual
        if resource_id in expected_ids and not binding_has_permission(permission, required_permission)
    }
    if not missing and not stale and not weak:
        return Check(name, PASS, f"Exact binding present with {normalize(required_permission)}")
    problems = []
    if missing:
        problems.append("missing " + ", ".join(sorted(missing)))
    if stale:
        problems.append("unexpected " + ", ".join(sorted(stale)))
    if weak:
        problems.append("insufficient permission for " + ", ".join(sorted(weak)))
    return Check(name, FAIL, "; ".join(problems), remediation)


def endpoint_is_ready(endpoint: dict[str, Any]) -> bool:
    state = endpoint.get("state") or {}
    if isinstance(state, dict):
        return normalize(state.get("ready")) == "READY"
    return normalize(state) == "READY"


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


def build_report(args: argparse.Namespace, client: DatabricksCli) -> dict[str, Any]:
    checks: list[Check] = []
    identity = add_cli_check(
        checks,
        "caller.identity",
        lambda: client.json(["current-user", "me"]),
        "Authenticated caller resolved",
        "Authenticate with a named Databricks CLI profile and rerun the preflight.",
    )
    if not identity:
        return finish_report(args, checks, {}, "")
    principals = current_principals(identity)
    caller = str(identity.get("user_name") or identity.get("userName") or "")

    if caller:
        home = add_cli_check(
            checks,
            "workspace_home.exists",
            lambda: client.json(["workspace", "get-status", f"/Users/{caller}"]),
            "Caller workspace home exists",
            "Create or restore the caller's Workspace Files home directory.",
        )
        if home and home.get("object_id") is not None:
            home_permissions = add_cli_check(
                checks,
                "workspace_home.permissions_visible",
                lambda: client.json([
                    "workspace", "get-permissions", "directories", str(home["object_id"])
                ]),
                "Workspace home permissions are visible",
                "Have a workspace administrator verify write access to the caller's home directory.",
            )
            if home_permissions:
                home_levels = acl_levels(home_permissions, principals)
                can_write = has_level(home_levels, "CAN_EDIT")
                checks.append(Check(
                    "workspace_home.can_write",
                    PASS if can_write else FAIL,
                    "Caller can stage App files" if can_write else "Caller lacks CAN EDIT on the staging parent",
                    None if can_write else "Grant CAN EDIT on the caller's Workspace Files home directory.",
                ))

    warehouse = add_cli_check(
        checks,
        "warehouse.exists",
        lambda: client.json(["warehouses", "get", args.warehouse_id]),
        "SQL warehouse exists",
        "Provide the ID of the approved existing serverless SQL warehouse.",
    )
    if warehouse:
        state = normalize(warehouse.get("state"))
        checks.append(Check(
            "warehouse.running",
            PASS if state == "RUNNING" else FAIL,
            f"Warehouse state is {state or 'UNKNOWN'}",
            None if state == "RUNNING" else "Start the warehouse before continuing.",
        ))
        serverless = warehouse.get("enable_serverless_compute") is True
        checks.append(Check(
            "warehouse.serverless",
            PASS if serverless else FAIL,
            "Serverless SQL is enabled" if serverless else "Warehouse is not reported as serverless",
            None if serverless else "Select an existing serverless SQL warehouse.",
        ))
        add_cli_check(
            checks,
            "warehouse.can_use",
            lambda: client.statement(args.warehouse_id, "SELECT 1 AS permission_probe"),
            "Caller successfully executed a read-only SQL statement",
            "Grant the caller CAN USE on the selected SQL warehouse.",
        )

    source_catalog_privileges, source_catalog_errors = effective_privileges(
        client, "CATALOG", args.source_catalog, principals
    )
    checks.append(privilege_check(
        "source_catalog.permissions",
        source_catalog_privileges,
        {"USE_CATALOG"},
        source_catalog_errors,
        "Grant USE CATALOG on the licensed source catalog to the deployment identity or one of its groups.",
    ))
    source_schema_name = f"{args.source_catalog}.{args.source_schema}"
    source_schema_privileges, source_schema_errors = effective_privileges(
        client, "SCHEMA", source_schema_name, principals
    )
    checks.append(privilege_check(
        "source_schema.permissions",
        source_schema_privileges,
        {"USE_SCHEMA"},
        source_schema_errors,
        "Grant USE SCHEMA on the licensed Scintilla schema.",
    ))
    source_count_sql = (
        f"SELECT count(*) FROM {quote_identifier(args.source_catalog)}.information_schema.tables "
        f"WHERE table_schema = {sql_literal(args.source_schema)}"
    )
    try:
        source_metadata = client.statement(args.warehouse_id, source_count_sql)
        visible_tables = int(first_scalar(source_metadata) or 0)
        checks.append(Check(
            "source_schema.metadata",
            PASS if visible_tables else FAIL,
            f"Caller can see {visible_tables} source tables without reading payload values",
            None if visible_tables else "Grant source metadata visibility and SELECT on candidate feeds, then rerun.",
        ))
    except (CliError, TypeError, ValueError) as exc:
        checks.append(Check(
            "source_schema.metadata",
            FAIL,
            str(exc),
            "Grant metadata visibility and the source USE privileges, then rerun.",
        ))
    for table in args.source_table:
        full_name = ".".join([
            quote_identifier(args.source_catalog),
            quote_identifier(args.source_schema),
            quote_identifier(table),
        ])
        add_cli_check(
            checks,
            f"source_table.{table}.select",
            lambda full_name=full_name: client.statement(
                args.warehouse_id, f"SELECT 1 AS permission_probe FROM {full_name} LIMIT 1"
            ),
            "Caller can read the selected source table",
            f"Grant SELECT on {args.source_catalog}.{args.source_schema}.{table}.",
        )

    curated_catalog_privileges, curated_catalog_errors = effective_privileges(
        client, "CATALOG", args.curated_catalog, principals
    )
    checks.append(privilege_check(
        "curated_catalog.permissions",
        curated_catalog_privileges,
        {"USE_CATALOG"},
        curated_catalog_errors,
        "Have an administrator pre-create the curated namespace and grant USE CATALOG.",
    ))
    curated_schema_name = f"{args.curated_catalog}.{args.curated_schema}"
    curated_schema_privileges, curated_schema_errors = effective_privileges(
        client, "SCHEMA", curated_schema_name, principals
    )
    checks.append(privilege_check(
        "curated_schema.permissions",
        curated_schema_privileges,
        {"USE_SCHEMA", "CREATE_TABLE", "MODIFY", "SELECT"},
        curated_schema_errors,
        "Grant USE SCHEMA, CREATE TABLE, MODIFY, and SELECT on the pre-created curated schema.",
    ))

    endpoint = add_cli_check(
        checks,
        "model_endpoint.exists",
        lambda: client.json(["serving-endpoints", "get", args.model_endpoint]),
        "Foundation Model endpoint exists",
        "Provide an existing Foundation Model endpoint available in this workspace and region.",
    )
    if endpoint:
        ready = endpoint_is_ready(endpoint)
        checks.append(Check(
            "model_endpoint.ready",
            PASS if ready else FAIL,
            "Endpoint is ready" if ready else "Endpoint is not ready",
            None if ready else "Wait for the endpoint to become ready or select another endpoint.",
        ))

    app = add_cli_check(
        checks,
        "app.exists",
        lambda: client.json(["apps", "get", args.app_name]),
        "Existing App resolved",
        "Have an administrator create the empty App, or provide the existing App name to reuse.",
    )
    app_permissions = add_cli_check(
        checks,
        "app.permissions_visible",
        lambda: client.json(["apps", "get-permissions", args.app_name]),
        "App permissions are visible",
        "Ask an App manager to grant the caller CAN MANAGE on the existing App.",
    )
    if app_permissions:
        caller_levels = acl_levels(app_permissions, principals)
        checks.append(Check(
            "app.caller_can_manage",
            PASS if has_level(caller_levels, "CAN_MANAGE") else FAIL,
            "Caller has CAN MANAGE" if has_level(caller_levels, "CAN_MANAGE") else "Caller lacks CAN MANAGE",
            None if has_level(caller_levels, "CAN_MANAGE") else "Grant CAN MANAGE on the existing App.",
        ))
        viewer_levels = acl_levels(app_permissions, {args.viewer_group})
        checks.append(Check(
            "app.viewer_group_can_use",
            PASS if has_level(viewer_levels, "CAN_USE") else FAIL,
            f"{args.viewer_group} can use the App" if has_level(viewer_levels, "CAN_USE") else f"{args.viewer_group} lacks CAN USE",
            None if has_level(viewer_levels, "CAN_USE") else f"Grant CAN USE on the App to group {args.viewer_group}.",
        ))

    app_principal = service_principal_id(app or {})
    if app:
        checks.append(Check(
            "app.service_principal",
            PASS if app_principal else FAIL,
            f"Managed service principal: {app_principal}" if app_principal else "App did not return a managed service principal",
            None if app_principal else "Recreate or repair the App before deployment.",
        ))
        bindings = app_bindings(app)
        checks.append(binding_check(
            "app.warehouse_binding",
            bindings["warehouse"],
            {args.warehouse_id},
            "CAN_USE",
            "Bind only the selected warehouse to the App with CAN USE.",
        ))
        checks.append(binding_check(
            "app.model_endpoint_binding",
            bindings["serving_endpoint"],
            {args.model_endpoint},
            "CAN_QUERY",
            "Bind only the selected Foundation Model endpoint to the App with CAN QUERY.",
        ))
        checks.append(Check(
            "app.unsupported_bindings",
            FAIL if bindings["other"] else PASS,
            "Unexpected bindings: " + ", ".join(sorted(value for value, _ in bindings["other"]))
            if bindings["other"] else "No optional resource bindings are present",
            "Remove Lakebase, Vector Search, job, volume, secret, and other optional bindings from the core App."
            if bindings["other"] else None,
        ))
        delegated = {
            normalize(scope)
            for scope in app.get("user_api_scopes") or []
            if "SQL" in normalize(scope) or "GENIE" in normalize(scope)
        }
        checks.append(Check(
            "app.shared_authorization_mode",
            WARN if delegated else PASS,
            "Delegated SQL/Genie scopes are configured: " + ", ".join(sorted(delegated))
            if delegated else "No delegated SQL or Genie scopes are required for shared App authorization",
            "Remove delegated SQL/Genie scopes unless per-user data authorization is an explicit requirement."
            if delegated else None,
        ))

    if app_principal:
        app_catalog_privileges, app_catalog_errors = effective_privileges(
            client, "CATALOG", args.curated_catalog, {app_principal}
        )
        checks.append(privilege_check(
            "app_service_principal.catalog_permissions",
            app_catalog_privileges,
            {"USE_CATALOG"},
            app_catalog_errors,
            "Have the namespace owner grant USE CATALOG to the App application_id UUID.",
        ))
        app_schema_privileges, app_schema_errors = effective_privileges(
            client, "SCHEMA", curated_schema_name, {app_principal}
        )
        checks.append(privilege_check(
            "app_service_principal.schema_permissions",
            app_schema_privileges,
            {"USE_SCHEMA", "SELECT"},
            app_schema_errors,
            "Have the namespace owner grant USE SCHEMA and SELECT on the dedicated curated schema to the App application_id UUID.",
        ))

    if app:
        bindings = app_bindings(app)
        expected_spaces = set(args.genie_space_id)
        if expected_spaces:
            for space_id in sorted(expected_spaces):
                add_cli_check(
                    checks,
                    f"genie_space.{space_id}.accessible",
                    lambda space_id=space_id: client.json(["genie", "get-space", space_id]),
                    "Caller can access the Genie Space",
                    "Provide an existing approved Genie Space and grant the caller management access.",
                )
            checks.append(binding_check(
                "app.genie_bindings",
                bindings["genie_space"],
                expected_spaces,
                "CAN_RUN",
                "Bind exactly the approved Genie Spaces to the App with CAN RUN.",
            ))
        elif bindings["genie_space"]:
            checks.append(Check(
                "app.genie_bindings",
                WARN,
                "The App has Genie bindings that were not supplied to this preflight",
                "Rerun the deployment-stage preflight with every approved --genie-space-id.",
            ))

    if args.stage == "deployment":
        if not args.source_table:
            checks.append(Check(
                "deployment.selected_sources",
                FAIL,
                "No confirmed source tables were supplied",
                "Rerun with --source-table for every approved feed used by the deployment.",
            ))
        if not args.genie_space_id:
            checks.append(Check(
                "deployment.genie_spaces",
                FAIL,
                "No approved Genie Spaces were supplied",
                "Create or select the supported core Genie Spaces, bind them to the App, and rerun.",
            ))

    return finish_report(args, checks, identity, app_principal)


def finish_report(
    args: argparse.Namespace,
    checks: list[Check],
    identity: dict[str, Any],
    app_principal: str,
) -> dict[str, Any]:
    blocking = [check for check in checks if check.status == FAIL]
    warnings = [check for check in checks if check.status == WARN]
    return {
        "version": 1,
        "stage": args.stage,
        "read_only": True,
        "authorization_mode": "shared_app_service_principal",
        "caller": identity.get("user_name") or identity.get("userName"),
        "app_name": args.app_name,
        "app_service_principal": app_principal or None,
        "requested": {
            "source": {
                "catalog": args.source_catalog,
                "schema": args.source_schema,
                "tables": sorted(set(args.source_table)),
            },
            "curated": {"catalog": args.curated_catalog, "schema": args.curated_schema},
            "warehouse_id": args.warehouse_id,
            "model_endpoint": args.model_endpoint,
            "viewer_group": args.viewer_group,
            "genie_space_ids": sorted(set(args.genie_space_id)),
        },
        "ready": not blocking,
        "summary": {
            "passed": sum(check.status == PASS for check in checks),
            "warnings": len(warnings),
            "failed": len(blocking),
        },
        "checks": [asdict(check) for check in checks],
        "limitations": [
            "This preflight performs no CREATE, GRANT, UPDATE, deployment, model query, or Genie conversation.",
            "It validates requested bindings and effective privileges, but cannot prove that the App code uses only those resources.",
            "Reusing an App can retain unrelated historical grants outside the requested securables; an administrator must review and revoke stale grants.",
        ],
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--stage", choices=("inventory", "deployment"), default="inventory")
    parser.add_argument("--source-catalog", required=True)
    parser.add_argument("--source-schema", required=True)
    parser.add_argument("--source-table", action="append", default=[])
    parser.add_argument("--curated-catalog", required=True)
    parser.add_argument("--curated-schema", required=True)
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--model-endpoint", required=True)
    parser.add_argument("--app-name", required=True)
    parser.add_argument("--viewer-group", required=True)
    parser.add_argument("--genie-space-id", action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        report = build_report(args, DatabricksCli(args.profile))
    except (CliError, ValueError) as exc:
        report = {
            "version": 1,
            "stage": args.stage,
            "read_only": True,
            "ready": False,
            "summary": {"passed": 0, "warnings": 0, "failed": 1},
            "checks": [asdict(Check("preflight.internal", FAIL, str(exc)))],
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "stage": report.get("stage"),
        "ready": report.get("ready"),
        "summary": report.get("summary"),
    }, indent=2))
    raise SystemExit(0 if report.get("ready") else 2)


if __name__ == "__main__":
    main()
