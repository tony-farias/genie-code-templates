"""Golden Monday Morning App contract shared by the template, render, and deployment checks."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "assets" / "app-template"
LOCK = TEMPLATE / "template-lock.json"

# Bump with every approved template change, then run verify_app_template.py --update-lock.
TEMPLATE_VERSION = "1.1.1"

# app.yaml env values that render_app.py replaces. Every other file ships byte-for-byte.
REQUIRED_SETTINGS = ("WAREHOUSE_ID", "CATALOG", "SCHEMA", "AUTHORIZATION_MODE", "GENIE_SPACE_ID", "LLM_MODEL")
# Data identity for SQL and Genie; "user" needs the App user scopes below.
AUTHORIZATION_MODES = ("user", "app")
USER_AUTHORIZATION_SCOPES = ("sql", "genie")
OPTIONAL_SETTINGS = ("OUTCOME_MAPS_URL",)
RENDERED_FILES = {"app.yaml"}

# Client routes and their sidebar labels. Every route serves the same dist/index.html shell.
PAGES = {
    "/": "Home",
    "/app/sales": "Sales",
    "/app/forecast": "Forecast",
    "/app/inventory": "Inventory",
    "/app/hourly": "Hourly Stats",
    "/app/category": "Category",
    "/app/ecom": "E-com",
    "/app/agents": "Agents",
    "/app/commerce": "Commerce Exchange",
    "/app/personalized": "Personalized",
    "/architecture": "Architecture",
}
LEGACY_PAGES = {"/app/sku/:skuId", "/app/summary"}

# API routes the UI calls. Parameterless GETs are exercised against a deployed App;
# POST and path-parameter routes are checked only for being mounted.
UI_GET_ROUTES = (
    "/api/health",
    "/api/whoami",
    "/api/meta",
    "/api/vendors",
    "/api/personas",
    "/api/categories",
    "/api/stores",
    "/api/stores/map",
    "/api/home/insights",
    "/api/dashboard/kpis",
    "/api/dashboard/channel-mix",
    "/api/dashboard/monthly-trend",
    "/api/dashboard/sales-by-category",
    "/api/dashboard/top-movers",
    "/api/dashboard/underperformers",
    "/api/breakdown/hierarchy",
    "/api/breakdown/insight",
    "/api/returns/summary",
    "/api/reviews/summary",
    "/api/inventory/flow",
    "/api/inventory/days-of-supply",
    "/api/supply/otif",
    "/api/forecast/overview",
    "/api/hourly/heatmap",
    "/api/category/competitive",
    "/api/category/brand-velocity",
    "/api/category/penetration",
    "/api/ecom/overview",
    "/api/ecom/action-items",
    "/api/inv-intel/entities",
    "/api/inv-intel/store-search",
    "/api/agents/roster",
    "/api/report/debrief",
    "/api/actions",
    "/api/architecture/stats",
    "/api/architecture/ontology",
)
UI_POST_ROUTES = ("/api/actions", "/api/genie/ask", "/api/home/brief")
UI_PARAM_ROUTES = (
    "/api/agents/run/:id",
    "/api/inv-intel/dc/:dcNbr",
    "/api/inv-intel/store/:storeNbr",
    "/api/inv-intel/heatmap/:storeNbr",
    "/api/item/affinity/:skuId",
)
# Called by the UI but never mounted; already broken in the recorded build.
KNOWN_UNMOUNTED = {
    "/api/sku/:skuId": "Legacy SkuDetailPage (/app/sku/:skuId) requests a route the backend does not mount.",
}

# Every table the mounted routes query. All must exist in the curated schema.
REQUIRED_TABLES = (
    "store_sales", "upc_sales", "store_returns", "ecom_returns",
    "store_invt", "hourly_store_invt", "store_fulfillment", "hourly_store_fulfillment",
    "dc_alignment", "dc_dim", "purchase_order",
    "dly_dmnd_fcst", "store_demand_forecast",
    "item_dim", "omni_item_dim", "store_dim", "upc_attr",
    "digital_transactability", "ecom_prod_cntnt_score", "omni_otif", "oos_root_cause", "item_affinity",
)

IGNORED_NAMES = {"node_modules", "__pycache__", ".DS_Store", ".databricks"}

# Workspace-specific identifiers that must never be committed to the template.
IDENTIFIER_PATTERNS = {
    "warehouse_id": re.compile(r"\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{16}\b"),
    "genie_space_id": re.compile(r"\b01f[0-9a-f]{29}\b"),
    "workspace_host": re.compile(
        r"[a-z0-9-]+\.(?:cloud\.databricks\.com|azuredatabricks\.net|gcp\.databricks\.com|databricksapps\.com)"
    ),
    "databricks_email": re.compile(r"[A-Za-z0-9._%+-]+@databricks\.com"),
    "fe_catalog": re.compile(r"cpg_bricks_catalog"),
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def template_files(root: Path = TEMPLATE) -> list[Path]:
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.name != LOCK.name
        and not IGNORED_NAMES.intersection(path.relative_to(root).parts)
    )


def snapshot(root: Path = TEMPLATE) -> dict[str, object]:
    return {
        "template_version": TEMPLATE_VERSION,
        "files": {path.relative_to(root).as_posix(): digest(path) for path in template_files(root)},
    }


def load_lock(lock: Path = LOCK) -> dict[str, object]:
    if not lock.is_file():
        raise RuntimeError("Golden App source lock is missing")
    return json.loads(lock.read_text(encoding="utf-8"))


def tree_drift(root: Path, lock: dict[str, object], *, rendered: set[str] = frozenset()) -> list[str]:
    """Return every difference between a tree and the lock, ignoring rendered files."""
    expected: dict[str, str] = dict(lock.get("files", {}))
    actual = {path.relative_to(root).as_posix(): digest(path) for path in template_files(root)}
    problems = [f"missing: {name}" for name in sorted(set(expected) - set(actual))]
    problems += [f"unexpected: {name}" for name in sorted(set(actual) - set(expected))]
    problems += [
        f"modified: {name}"
        for name in sorted(set(expected) & set(actual))
        if name not in rendered and expected[name] != actual[name]
    ]
    return problems


def verify_template(root: Path = TEMPLATE, lock_path: Path = LOCK) -> dict[str, object]:
    lock = load_lock(lock_path)
    if lock.get("template_version") != TEMPLATE_VERSION:
        raise RuntimeError(
            f"Lock records template {lock.get('template_version')}, contract expects {TEMPLATE_VERSION}"
        )
    problems = tree_drift(root, lock)
    if problems:
        raise RuntimeError(
            "Unapproved Golden App drift (" + "; ".join(problems[:5]) + "); "
            "bump TEMPLATE_VERSION and approve a new lock with verify_app_template.py --update-lock"
        )
    return lock


def dist_assets(lock: dict[str, object]) -> dict[str, str]:
    """Map each served /assets/ URL path to its locked SHA-256."""
    return {
        "/" + name.removeprefix("dist/"): sha
        for name, sha in dict(lock.get("files", {})).items()
        if name.startswith("dist/assets/")
    }


def normalize_route(route: str) -> str:
    return re.sub(r":[A-Za-z]+", ":param", route.rstrip("/"))
