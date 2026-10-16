from __future__ import annotations

import importlib.util
from argparse import Namespace
from pathlib import Path
import sys
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts" / "check_x12_permissions.py"
SPEC = importlib.util.spec_from_file_location("check_x12_permissions", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeCli:
    def __init__(self, *, scopes=("sql", "genie"), schema_exists=True, app_exists=True, viewer_select=True):
        self.scopes = list(scopes)
        self.schema_exists = schema_exists
        self.app_exists = app_exists
        self.viewer_select = viewer_select
        self.statements = []

    def json(self, arguments):
        prefix = tuple(arguments[:2])
        if prefix == ("current-user", "me"):
            return {"userName": "analyst@example.com", "groups": [{"display": "x12-deployers"}],
                    "entitlements": [{"value": "allow-cluster-create"}]}
        if prefix == ("warehouses", "get"):
            return {"id": "warehouse-1", "state": "RUNNING"}
        if prefix == ("warehouses", "get-permissions"):
            return self._acl([("group_name", "x12-viewers", "CAN_USE")])
        if prefix == ("schemas", "get"):
            if not self.schema_exists:
                raise MODULE.CliError("SCHEMA_DOES_NOT_EXIST")
            return {"full_name": arguments[2]}
        if prefix == ("grants", "get-effective"):
            securable, principal = arguments[2], arguments[-1]
            if principal == "x12-viewers":
                values = (["USE_CATALOG"] if securable == "CATALOG" else ["USE_SCHEMA", "SELECT"]) if self.viewer_select else []
            elif principal == "account users":
                values = []
            else:
                values = (["USE_CATALOG", "CREATE_SCHEMA"] if securable == "CATALOG"
                          else ["USE_SCHEMA", "CREATE_TABLE", "MODIFY", "SELECT"])
            return {"privilege_assignments": [{"principal": principal, "privileges": values}]}
        if prefix == ("apps", "get"):
            if not self.app_exists:
                raise MODULE.CliError("App does not exist")
            return {"name": arguments[2], "user_api_scopes": self.scopes}
        if prefix == ("apps", "get-permissions"):
            return self._acl([("user_name", "analyst@example.com", "CAN_MANAGE")])
        if prefix == ("api", "get"):
            return self._acl([("group_name", "x12-viewers", "CAN_RUN")])
        raise AssertionError(f"Unexpected command: {arguments}")

    def statement(self, warehouse_id, statement):
        self.statements.append(statement)
        return {"status": {"state": "SUCCEEDED"}, "result": {"data_array": [[1]]}}

    @staticmethod
    def _acl(entries):
        return {"access_control_list": [
            {key: name, "all_permissions": [{"permission_level": level}]} for key, name, level in entries
        ]}


def args(**overrides):
    values = dict(profile="test", stage="deployment", source_table=None,
                  source_volume_path="/Volumes/payer/x12/landing/inbound",
                  target_catalog="payer", target_schema="x12_analytics", warehouse_id="warehouse-1",
                  app_name="x12-health-plan-analytics", authorization_mode="user", viewer_group="x12-viewers",
                  genie_space_id=["space-1"], output=Path("unused.json"))
    values.update(overrides)
    return Namespace(**values)


class X12PreflightTests(unittest.TestCase):
    def test_user_mode_volume_source_is_ready(self):
        cli = FakeCli()
        report = MODULE.build_report(args(), cli)
        self.assertTrue(report["ready"], [c for c in report["checks"] if c["status"] == "FAIL"])
        checks = {item["name"]: item for item in report["checks"]}
        self.assertEqual(checks["source.volume_read"]["status"], MODULE.PASS)
        self.assertTrue(any("read_files(" in statement for statement in cli.statements))
        self.assertEqual(checks["viewer_group.gold_permissions"]["status"], MODULE.PASS)

    def test_scopes_must_be_sql_and_genie_in_user_mode(self):
        for scopes in ([], ["sql:restricted-query", "genie"], ["sql"], ["sql", "genie", "files"]):
            with self.subTest(scopes=scopes):
                report = MODULE.build_report(args(), FakeCli(scopes=scopes))
                checks = {item["name"]: item for item in report["checks"]}
                self.assertEqual(checks["app.authorization_mode"]["status"], MODULE.FAIL)

    def test_app_mode_rejects_user_scopes(self):
        report = MODULE.build_report(args(authorization_mode="app"), FakeCli())
        checks = {item["name"]: item for item in report["checks"]}
        self.assertEqual(checks["app.authorization_mode"]["status"], MODULE.FAIL)

    def test_missing_schema_needs_create_schema(self):
        report = MODULE.build_report(args(), FakeCli(schema_exists=False))
        checks = {item["name"]: item for item in report["checks"]}
        self.assertEqual(checks["target_schema.can_create"]["status"], MODULE.PASS)

    def test_viewer_without_gold_access_blocks(self):
        report = MODULE.build_report(args(), FakeCli(viewer_select=False))
        self.assertFalse(report["ready"])
        failures = {item["name"] for item in report["checks"] if item["status"] == MODULE.FAIL}
        self.assertIn("viewer_group.gold_permissions", failures)

    def test_new_app_is_a_warning_not_a_blocker(self):
        report = MODULE.build_report(args(), FakeCli(app_exists=False))
        self.assertTrue(report["ready"])

    def test_deployment_requires_a_source(self):
        report = MODULE.build_report(args(source_volume_path=None), FakeCli())
        failures = {item["name"] for item in report["checks"] if item["status"] == MODULE.FAIL}
        self.assertIn("deployment.source", failures)


if __name__ == "__main__":
    unittest.main()
