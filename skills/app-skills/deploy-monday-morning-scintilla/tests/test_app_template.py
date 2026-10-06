import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest import mock


SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


contract = load("app_contract")
verify_template = load("verify_app_template")
render_app = load("render_app")
verify_deployment = load("verify_deployment")


def render_args(**overrides):
    values = {
        "warehouse_id": "warehouse-1",
        "catalog": "customer_catalog",
        "schema": "monday_morning",
        "genie_space_id": "space-1",
        "model_endpoint": "model-1",
        "outcome_maps_url": "",
    }
    values.update(overrides)
    return mock.Mock(**values)


class TemplateLockTest(unittest.TestCase):
    def test_lock_matches_template(self):
        lock = contract.verify_template()
        self.assertEqual(lock, contract.snapshot())

    def test_contract_holds(self):
        checks = verify_template.validate_contract()
        self.assertEqual([name for name, ok in checks.items() if not ok], [])

    def test_lock_covers_compiled_ui(self):
        files = contract.load_lock()["files"]
        self.assertIn("dist/index.html", files)
        self.assertTrue(contract.dist_assets(contract.load_lock()))
        self.assertIn("app.yaml", files)

    def test_drift_is_detected(self):
        with tempfile.TemporaryDirectory() as workdir:
            copy = Path(workdir) / "app"
            shutil.copytree(contract.TEMPLATE, copy, ignore=shutil.ignore_patterns(*contract.IGNORED_NAMES))
            (copy / "src" / "pages" / "SalesPage.jsx").write_text("export default () => null;\n")
            (copy / "src" / "pages" / "NewPage.jsx").write_text("export default () => null;\n")
            problems = contract.tree_drift(copy, contract.load_lock())
            self.assertIn("modified: src/pages/SalesPage.jsx", problems)
            self.assertIn("unexpected: src/pages/NewPage.jsx", problems)
            with self.assertRaisesRegex(RuntimeError, "Unapproved Golden App drift"):
                contract.verify_template(copy, contract.LOCK)

    def test_identifier_scan_flags_workspace_ids(self):
        with tempfile.TemporaryDirectory() as workdir:
            root = Path(workdir)
            (root / "app.yaml").write_text('value: "819c2dd664295c0b"\nhost: x.cloud.databricks.com\n')
            hits = verify_template.identifier_hits(root)
            self.assertIn("app.yaml: warehouse_id", hits)
            self.assertIn("app.yaml: workspace_host", hits)


class RenderTest(unittest.TestCase):
    def test_render_changes_only_app_yaml(self):
        with tempfile.TemporaryDirectory() as workdir:
            output = Path(workdir) / "app"
            with mock.patch.object(render_app, "inside_git_worktree", return_value=False):
                result = render_app.render(render_app.setting_values(render_args()), output)
            app_yaml = (output / "app.yaml").read_text()
            self.assertIn('value: "warehouse-1"', app_yaml)
            self.assertIn('value: "customer_catalog"', app_yaml)
            self.assertIn('- name: OUTCOME_MAPS_URL\n    value: ""', app_yaml)
            self.assertNotIn('"__', app_yaml)
            lock = contract.load_lock()
            self.assertEqual(contract.tree_drift(output, lock, rendered={"app.yaml"}), [])
            self.assertEqual(result["ui_shell_sha256"], lock["files"]["dist/index.html"])

    def test_render_rejects_missing_or_placeholder_values(self):
        with self.assertRaisesRegex(ValueError, "WAREHOUSE_ID is required"):
            render_app.setting_values(render_args(warehouse_id=" "))
        with self.assertRaisesRegex(ValueError, "GENIE_SPACE_ID"):
            render_app.setting_values(render_args(genie_space_id="<approved-space-id>"))

    def test_render_refuses_git_worktree_and_non_empty_output(self):
        with tempfile.TemporaryDirectory() as workdir:
            output = Path(workdir) / "app"
            with mock.patch.object(render_app, "inside_git_worktree", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "inside a Git worktree"):
                    render_app.render(render_app.setting_values(render_args()), output)
            output.mkdir()
            (output / "stale.txt").write_text("old")
            with self.assertRaisesRegex(RuntimeError, "must be empty"):
                render_app.render(render_app.setting_values(render_args()), output)


class FakeApp:
    """Serves the locked template the way server.js does, with optional tampering."""

    def __init__(self, *, tampered_asset=None, broken_route=None):
        self.dist = contract.TEMPLATE / "dist"
        self.tampered_asset = tampered_asset
        self.broken_route = broken_route

    def __call__(self, path):
        shell = (self.dist / "index.html").read_bytes()
        if path.startswith("/assets/"):
            body = (self.dist / path.lstrip("/")).read_bytes()
            if path == self.tampered_asset:
                body += b"/* restyled */"
            return verify_deployment.Response(200, "application/javascript", body)
        if path.startswith("/api/"):
            if path == self.broken_route:
                return verify_deployment.Response(200, "text/html", shell)
            return verify_deployment.Response(200, "application/json; charset=utf-8", b"{}")
        return verify_deployment.Response(200, "text/html", shell)


class DeploymentCheckTest(unittest.TestCase):
    def report(self, fetch):
        return verify_deployment.build_report(fetch, contract.load_lock(), app_name="monday-morning", url="https://app")

    def test_golden_deployment_is_ready(self):
        report = self.report(FakeApp())
        self.assertTrue(report["ready"], [c for c in report["checks"] if c["status"] == "FAIL"])
        names = {check["name"] for check in report["checks"]}
        self.assertIn("page /app/sales", names)
        self.assertIn("api /api/meta", names)

    def test_restyled_asset_blocks(self):
        asset = next(iter(contract.dist_assets(contract.load_lock())))
        report = self.report(FakeApp(tampered_asset=asset))
        self.assertFalse(report["ready"])
        failed = [check["name"] for check in report["checks"] if check["status"] == "FAIL"]
        self.assertEqual(failed, [f"asset {asset}"])

    def test_unmounted_route_is_reported_as_spa_fallback(self):
        report = self.report(FakeApp(broken_route="/api/forecast/overview"))
        failure = next(check for check in report["checks"] if check["status"] == "FAIL")
        self.assertEqual(failure["name"], "api /api/forecast/overview")
        self.assertIn("SPA fallback", failure["detail"])

    def test_rebuilt_shell_blocks(self):
        def fetch(path):
            response = FakeApp()(path)
            if not path.startswith(("/assets/", "/api/")):
                response = verify_deployment.Response(200, "text/html", response.body.replace(b"<title>", b"<title>x"))
            return response

        report = self.report(fetch)
        self.assertFalse(report["ready"])
        self.assertTrue(all(
            check["status"] == "FAIL" for check in report["checks"] if check["name"].startswith("page ")
        ))


if __name__ == "__main__":
    unittest.main()
