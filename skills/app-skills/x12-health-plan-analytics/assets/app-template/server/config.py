from __future__ import annotations

from functools import lru_cache
import json
import os
from pathlib import Path
import re
from typing import Any

from databricks.sdk import WorkspaceClient
from fastapi import Request


ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / os.environ.get("X12_APP_CONFIG", "app-config.json")
TABLE_PATTERN = re.compile(r"[A-Za-z_][\w]*\.[A-Za-z_][\w]*\.[A-Za-z_][\w]*")
REQUIRED_TABLES = {
    "claims",
    "claim_lines",
    "members",
    "providers",
    "payments",
    "enrollments",
    "data_quality",
}


@lru_cache(maxsize=1)
def load_config() -> dict[str, Any]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    missing = REQUIRED_TABLES - set(config.get("tables", {}))
    if missing:
        raise RuntimeError(f"App configuration is missing table mappings: {', '.join(sorted(missing))}")
    if not config.get("warehouse_id"):
        raise RuntimeError("App configuration is missing warehouse_id")
    if not config.get("template_version"):
        raise RuntimeError("App configuration is missing template_version")
    return config


def quoted_table(name: str) -> str:
    value = str(load_config()["tables"].get(name, ""))
    if not TABLE_PATTERN.fullmatch(value):
        raise RuntimeError(f"Invalid configured table identifier for {name}")
    return ".".join(f"`{part}`" for part in value.split("."))


def source_name() -> str:
    config = load_config()
    return f"{config['catalog']}.{config['schema']}"


def threshold(name: str, default: float) -> float:
    return float(load_config().get("benchmark", {}).get(name, default))


AUTHORIZATION_MODES = ("user", "app")


def authorization_mode() -> str:
    """Data identity for SQL and Genie: "user" (the signed-in viewer) or "app"."""
    mode = str(load_config().get("authorization_mode", "user"))
    if mode not in AUTHORIZATION_MODES:
        raise RuntimeError(f"authorization_mode must be one of {', '.join(AUTHORIZATION_MODES)}")
    return mode


def app_workspace_client() -> WorkspaceClient:
    """The App service principal, used for SQL and Genie only in app mode."""
    profile = os.environ.get("DATABRICKS_PROFILE")
    return WorkspaceClient(profile=profile) if profile else WorkspaceClient()


def data_workspace_client(request: Request) -> WorkspaceClient:
    """Client for Gold SQL and Genie under the configured authorization mode.

    In user mode a request without a forwarded viewer token fails; it never
    falls back to the App service principal.
    """
    return viewer_workspace_client(request) if authorization_mode() == "user" else app_workspace_client()


def viewer_workspace_client(request: Request) -> WorkspaceClient:
    """The signed-in viewer, from the forwarded user-authorization token."""
    token = request.headers.get("x-forwarded-access-token")
    if not token:
        raise RuntimeError("Databricks did not forward a viewer access token")
    host = os.environ.get("DATABRICKS_HOST", "")
    if host and not host.startswith("http"):
        host = f"https://{host}"
    if not host:
        raise RuntimeError("DATABRICKS_HOST is not configured")
    return WorkspaceClient(host=host, token=token, auth_type="pat")
