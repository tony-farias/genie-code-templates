from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys
import unittest


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "assets" / "app-template"
sys.path.insert(0, str(ROOT / "scripts"))

from deploy_app import USER_API_SCOPES, app_spec


class AppContractTests(unittest.TestCase):
    def test_template_versions_match(self) -> None:
        config = json.loads((TEMPLATE / "app-config.json").read_text(encoding="utf-8"))
        package = json.loads((TEMPLATE / "frontend" / "package.json").read_text(encoding="utf-8"))
        manifest_builder = (ROOT / "scripts" / "build_deployment_manifest.py").read_text(encoding="utf-8")
        self.assertEqual("1.1.0", config["template_version"])
        self.assertEqual(config["template_version"], package["version"])
        self.assertIn(f'"template_version": "{config["template_version"]}"', manifest_builder)

    def test_config_schema_covers_exact_gold_tables(self) -> None:
        expected = {"claims", "claim_lines", "members", "providers", "payments", "enrollments", "data_quality"}
        config = json.loads((TEMPLATE / "app-config.json").read_text(encoding="utf-8"))
        schema = json.loads((TEMPLATE / "app-config.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(expected, set(config["tables"]))
        self.assertEqual(expected, set(schema["properties"]["tables"]["required"]))

    def test_stable_routes_and_navigation_exist(self) -> None:
        backend = (TEMPLATE / "app.py").read_text(encoding="utf-8")
        shell = (TEMPLATE / "frontend" / "src" / "Shell.tsx").read_text(encoding="utf-8")
        for route in (
            "/api/dashboard",
            "/api/siu/providers",
            "/api/siu/provider/{provider}/claims",
            "/api/siu/provider/{provider}/member-list",
            "/api/siu/provider/{provider}/analysis",
            "/api/siu/provider/{provider}/letter",
            "/api/siu/provider/{provider}/genie",
            "/api/genie/ask",
        ):
            self.assertIn(f'"{route}"', backend)
        positions = [shell.index(label) for label in ("Dashboard", "SIU Workbench", "Ask Genie")]
        self.assertEqual(sorted(positions), positions)

    def test_design_document_has_parseable_section_order(self) -> None:
        design = (ROOT / "DESIGN.md").read_text(encoding="utf-8")
        headers = ["## Overview", "## Colors", "## Typography", "## Elevation", "## Components", "## Do's and Don'ts"]
        positions = [design.index(header) for header in headers]
        self.assertEqual(sorted(positions), positions)
        self.assertIn("per-run visual regeneration", design)

    def test_source_lock_matches_template(self) -> None:
        lock = json.loads((TEMPLATE / "template-lock.json").read_text(encoding="utf-8"))
        for relative, expected in lock["files"].items():
            path = TEMPLATE / relative
            self.assertTrue(path.is_file(), relative)
            self.assertEqual(expected, hashlib.sha256(path.read_bytes()).hexdigest(), relative)

    def test_approved_visual_baselines_exist(self) -> None:
        baseline_dir = ROOT / "tests" / "visual-baselines"
        for name in ("dashboard-desktop", "siu-desktop", "genie-desktop", "dashboard-mobile"):
            image = baseline_dir / f"{name}.png"
            self.assertTrue(image.is_file(), name)
            self.assertGreater(image.stat().st_size, 10_000, name)

    def test_user_mode_requests_sql_and_genie_scopes(self) -> None:
        definition = app_spec("warehouse-id", "user")
        self.assertEqual(("sql", "genie"), USER_API_SCOPES)
        self.assertEqual(["sql", "genie"], definition["user_api_scopes"])
        self.assertEqual("warehouse-id", definition["resources"][0]["sql_warehouse"]["id"])
        self.assertEqual([], app_spec("warehouse-id", "app")["user_api_scopes"])

    def test_every_data_call_uses_the_configured_identity(self) -> None:
        backend = (TEMPLATE / "app.py").read_text(encoding="utf-8")
        config = (TEMPLATE / "server" / "config.py").read_text(encoding="utf-8")
        self.assertIn("def data_workspace_client(request: Request)", config)
        self.assertNotIn("app_workspace_client()", backend)
        self.assertNotIn("viewer_workspace_client(", backend)
        self.assertEqual(9, backend.count("data_workspace_client(request)"))
        template_config = json.loads((TEMPLATE / "app-config.json").read_text(encoding="utf-8"))
        self.assertEqual("user", template_config["authorization_mode"])

if __name__ == "__main__":
    unittest.main()
