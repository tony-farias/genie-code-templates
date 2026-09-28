import importlib.util
from argparse import Namespace
from pathlib import Path
import sys
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts" / "check_scintilla_permissions.py"
SPEC = importlib.util.spec_from_file_location("check_scintilla_permissions", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeCli:
    def __init__(self, *, stale_warehouse=False):
        self.stale_warehouse = stale_warehouse

    def json(self, arguments):
        prefix = tuple(arguments[:2])
        if prefix == ("current-user", "me"):
            return {
                "userName": "analyst@example.com",
                "groups": [{"display": "scintilla-deployers"}],
            }
        if prefix == ("workspace", "get-status"):
            return {"object_id": 42, "object_type": "DIRECTORY"}
        if prefix == ("workspace", "get-permissions"):
            return self._acl([
                ("user_name", "analyst@example.com", "CAN_MANAGE"),
            ])
        if prefix == ("warehouses", "get"):
            return {"id": "warehouse-1", "state": "RUNNING", "enable_serverless_compute": True}
        if prefix == ("grants", "get-effective"):
            securable_type = arguments[2]
            principal = arguments[-1]
            if principal == "app-uuid":
                values = ["USE_CATALOG"] if securable_type == "CATALOG" else ["USE_SCHEMA", "SELECT"]
            elif securable_type == "CATALOG":
                values = ["USE_CATALOG"]
            else:
                values = ["USE_SCHEMA", "CREATE_TABLE", "MODIFY", "SELECT"]
            return {"privilege_assignments": [{"principal": principal, "privileges": values}]}
        if prefix == ("serving-endpoints", "get"):
            return {"name": "model-1", "state": {"ready": "READY"}}
        if prefix == ("apps", "get"):
            warehouse_resources = [
                {"sql_warehouse": {"id": "warehouse-1", "permission": "CAN_USE"}}
            ]
            if self.stale_warehouse:
                warehouse_resources.append(
                    {"sql_warehouse": {"id": "warehouse-old", "permission": "CAN_USE"}}
                )
            return {
                "name": "monday-morning",
                "service_principal_client_id": "app-uuid",
                "resources": [
                    *warehouse_resources,
                    {"serving_endpoint": {"name": "model-1", "permission": "CAN_QUERY"}},
                ],
            }
        if prefix == ("apps", "get-permissions"):
            return self._acl([
                ("user_name", "analyst@example.com", "CAN_MANAGE"),
                ("group_name", "scintilla-viewers", "CAN_USE"),
            ])
        raise AssertionError(f"Unexpected command: {arguments}")

    def statement(self, warehouse_id, statement):
        if warehouse_id != "warehouse-1":
            raise AssertionError(warehouse_id)
        return {"status": {"state": "SUCCEEDED"}, "result": {"data_array": [[1]]}}

    @staticmethod
    def _acl(entries):
        return {
            "access_control_list": [
                {key: principal, "all_permissions": [{"permission_level": level}]}
                for key, principal, level in entries
            ]
        }


def inventory_args():
    return Namespace(
        profile="test",
        stage="inventory",
        source_catalog="licensed",
        source_schema="scintilla",
        source_table=[],
        curated_catalog="retail",
        curated_schema="scintilla_curated",
        warehouse_id="warehouse-1",
        model_endpoint="model-1",
        app_name="monday-morning",
        viewer_group="scintilla-viewers",
        genie_space_id=[],
        output=Path("unused.json"),
    )


class PermissionsPreflightTests(unittest.TestCase):
    def test_current_principals_include_user_and_groups(self):
        principals = MODULE.current_principals({
            "userName": "analyst@example.com",
            "displayName": "Retail Analyst",
            "groups": [{"display": "scintilla-deployers"}, {"display": "account users"}],
        })
        self.assertEqual(
            principals,
            {"analyst@example.com", "scintilla-deployers", "account users"},
        )

    def test_effective_privileges_support_string_and_object_shapes(self):
        privileges = MODULE.extract_privileges({
            "effective_privilege_assignments": [{
                "principal": "scintilla-deployers",
                "privileges": ["USE SCHEMA", {"privilege": "CREATE_TABLE"}],
            }]
        })
        self.assertEqual(privileges, {"USE_SCHEMA", "CREATE_TABLE"})

    def test_acl_levels_include_group_permissions(self):
        levels = MODULE.acl_levels({
            "access_control_list": [{
                "group_name": "scintilla-deployers",
                "all_permissions": [{"permission_level": "CAN_MANAGE", "inherited": False}],
            }]
        }, {"analyst@example.com", "scintilla-deployers"})
        self.assertTrue(MODULE.has_level(levels, "CAN_MANAGE"))

    def test_app_bindings_extract_exact_resources(self):
        bindings = MODULE.app_bindings({
            "resources": [
                {"sql_warehouse": {"id": "warehouse-1", "permission": "CAN_USE"}},
                {"serving_endpoint": {"name": "model-1", "permission": "CAN_QUERY"}},
                {"genie_space": {"space_id": "space-1", "permission": "CAN_RUN"}},
            ]
        })
        self.assertEqual(bindings["warehouse"], [("warehouse-1", "CAN_USE")])
        self.assertEqual(bindings["serving_endpoint"], [("model-1", "CAN_QUERY")])
        self.assertEqual(bindings["genie_space"], [("space-1", "CAN_RUN")])
        self.assertEqual(bindings["other"], [])

    def test_binding_check_rejects_wrong_permission_family(self):
        result = MODULE.binding_check(
            "model",
            [("model-1", "CAN_USE")],
            {"model-1"},
            "CAN_QUERY",
            "fix it",
        )
        self.assertEqual(result.status, MODULE.FAIL)
        self.assertIn("insufficient permission", result.detail)

    def test_binding_check_rejects_stale_resource(self):
        result = MODULE.binding_check(
            "warehouse",
            [("warehouse-1", "CAN_USE"), ("warehouse-old", "CAN_USE")],
            {"warehouse-1"},
            "CAN_USE",
            "fix it",
        )
        self.assertEqual(result.status, MODULE.FAIL)
        self.assertIn("warehouse-old", result.detail)

    def test_app_bindings_surface_optional_resources(self):
        bindings = MODULE.app_bindings({
            "resources": [{
                "name": "chat-database",
                "database": {"instance_name": "optional-lakebase"},
            }]
        })
        self.assertEqual(bindings["other"], [("chat-database", "")])

    def test_service_principal_uses_application_id(self):
        self.assertEqual(
            MODULE.service_principal_id({"service_principal_client_id": "app-uuid"}),
            "app-uuid",
        )

    def test_inventory_report_is_ready_for_exact_simplified_footprint(self):
        report = MODULE.build_report(inventory_args(), FakeCli())
        self.assertTrue(report["ready"])
        self.assertTrue(report["read_only"])
        self.assertEqual(report["authorization_mode"], "shared_app_service_principal")
        self.assertEqual(report["summary"]["failed"], 0)

    def test_inventory_report_blocks_stale_app_binding(self):
        report = MODULE.build_report(inventory_args(), FakeCli(stale_warehouse=True))
        self.assertFalse(report["ready"])
        failures = {item["name"] for item in report["checks"] if item["status"] == MODULE.FAIL}
        self.assertIn("app.warehouse_binding", failures)

    def test_deployment_stage_requires_sources_and_genie_spaces(self):
        args = inventory_args()
        args.stage = "deployment"
        report = MODULE.build_report(args, FakeCli())
        self.assertFalse(report["ready"])
        failures = {item["name"] for item in report["checks"] if item["status"] == MODULE.FAIL}
        self.assertEqual(
            failures & {"deployment.selected_sources", "deployment.genie_spaces"},
            {"deployment.selected_sources", "deployment.genie_spaces"},
        )


if __name__ == "__main__":
    unittest.main()
