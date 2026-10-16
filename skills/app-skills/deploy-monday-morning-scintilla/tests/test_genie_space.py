import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest import mock


SKILL = Path(__file__).parents[1]
SCRIPTS = SKILL / "scripts"
APP = SKILL / "assets" / "app-template"
sys.path.insert(0, str(SCRIPTS))


def load(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


contract = load("app_contract")
build = load("build_genie_space")
deploy = load("deploy_genie_space")


def app_questions():
    """Every fixed question the App source sends to Genie; questions built from live values are skipped."""
    sales = (APP / "src/pages/SalesPage.jsx").read_text(encoding="utf-8")
    popup = (APP / "src/components/GeniePopup.jsx").read_text(encoding="utf-8")
    routes = (APP / "api/routes.scintilla.js").read_text(encoding="utf-8")
    found = re.findall(r'\b(?:question|ask)="([^"]+)"', sales)
    found += re.findall(r"const ask = up\s*\?\s*'([^']+)'\s*:\s*'([^']+)'", sales)[0]
    found += re.findall(r"text: '([^']+)'", popup)
    for source, name in ((sales, "GENIE_STARTERS"), (routes, "GENIE_SUGGESTIONS")):
        block = re.search(rf"{name} = \[(.*?)\];", source, re.S).group(1)
        found += re.findall(r"'([^']+)'", block)
    return found


class GenieSpaceTests(unittest.TestCase):
    def test_app_questions_match_the_app_source(self):
        self.assertEqual(set(build.APP_QUESTIONS), set(app_questions()))
        self.assertEqual(len(build.APP_QUESTIONS), len(set(build.APP_QUESTIONS)))

    def test_app_guidance_matches_the_app(self):
        routes = (APP / "api/routes.scintilla.js").read_text(encoding="utf-8")
        self.assertIn(f"const GENIE_GUIDANCE = '{build.APP_GUIDANCE}';", routes)

    def test_sample_questions_are_the_ask_genie_prompts(self):
        popup = (APP / "src/components/GeniePopup.jsx").read_text(encoding="utf-8")
        space = build.build("main", "scintilla", {})
        samples = {item["question"][0] for item in space["config"]["sample_questions"]}
        self.assertEqual(samples, set(re.findall(r"text: '([^']+)'", popup)))

    def test_space_is_deterministic_and_sorted(self):
        space = build.build("main", "scintilla", {})
        self.assertEqual(space, build.build("main", "scintilla", {}))
        self.assertEqual(space["version"], 2)
        identifiers = [item["identifier"] for item in space["data_sources"]["tables"]]
        self.assertEqual(identifiers, sorted(identifiers))
        for items in (space["config"]["sample_questions"], space["instructions"]["example_question_sqls"],
                      space["instructions"]["join_specs"], space["benchmarks"]["questions"]):
            ids = [item["id"] for item in items]
            self.assertEqual(ids, sorted(ids))
            self.assertEqual(len(ids), len(set(ids)))

    def test_space_tables_are_app_tables(self):
        self.assertLessEqual(set(build.TABLES), set(contract.REQUIRED_TABLES))

    def test_examples_and_joins_use_only_space_tables(self):
        space = build.build("main", "scintilla", {})
        tables = {item["identifier"] for item in space["data_sources"]["tables"]}
        for example in space["instructions"]["example_question_sqls"]:
            self.assertLessEqual(set(re.findall(r"\bmain\.scintilla\.\w+", example["sql"][0])), tables)
        for join in space["instructions"]["join_specs"]:
            self.assertIn(join["left"]["identifier"], tables)
            self.assertIn(join["right"]["identifier"], tables)

    def test_ranking_examples_are_bounded(self):
        for question, sql, _ in build.examples(build.physical_tables("main", "scintilla", {})):
            if re.search(r"\b(lowest|highest|top|worst|best)\b", question, re.I) and "categor" not in question:
                self.assertRegex(sql, r"LIMIT \d+$", question)

    def test_table_map_renames_tables(self):
        space = build.build("main", "scintilla", {"store_sales": "fact_store_item_sales"})
        identifiers = {item["identifier"] for item in space["data_sources"]["tables"]}
        self.assertIn("main.scintilla.fact_store_item_sales", identifiers)
        self.assertNotIn("main.scintilla.store_sales", identifiers)
        sql = " ".join(item["sql"][0] for item in space["instructions"]["example_question_sqls"])
        self.assertNotIn("main.scintilla.store_sales ", sql)

    def test_select_mapped_table_is_rejected(self):
        with self.assertRaises(SystemExit):
            build.build("main", "scintilla", {"store_sales": {"select": "SELECT * FROM fact_sales"}})
        with self.assertRaises(SystemExit):
            build.build("main", "scintilla", {"store_sales": "bad name; DROP"})


class DeployGenieSpaceTests(unittest.TestCase):
    def run_deploy(self, *extra):
        calls = []

        def fake_api(profile, method, path, body=None):
            calls.append((method, path, body))
            if path.endswith("/Me"):
                return {"userName": "analyst@example.com"}
            if method == "post":
                return {"space_id": "01fnew"}
            if method == "get":
                return {"space_id": "01fold", "serialized_space": "{}"}
            return {}

        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "space.json"
            config.write_text(json.dumps(build.build("main", "scintilla", {})), encoding="utf-8")
            output = Path(tmp) / "state.json"
            argv = ["deploy_genie_space.py", "--profile", "p", "--config", str(config), "--warehouse-id", "w",
                    "--output", str(output), *extra]
            failed_describe = mock.Mock(returncode=1, stdout="")
            with mock.patch.object(deploy, "api", fake_api), mock.patch.object(sys, "argv", argv), \
                    mock.patch.object(deploy.subprocess, "run", return_value=failed_describe), \
                    mock.patch("builtins.print"):
                deploy.main()
            state = json.loads(output.read_text(encoding="utf-8"))
            backups = sorted(path.name for path in Path(tmp).glob("state.previous-*.json"))
        return calls, state, backups

    def test_default_always_creates_a_new_space(self):
        calls, state, backups = self.run_deploy()
        self.assertEqual(state["action"], "created")
        self.assertEqual(state["space_id"], "01fnew")
        self.assertEqual(backups, [])
        self.assertFalse([call for call in calls if call[0] == "patch"])
        self.assertFalse([call for call in calls if call[0] == "get" and "/genie/spaces" in call[1]])

    def test_update_backs_up_the_named_space_first(self):
        calls, state, backups = self.run_deploy("--space-id", "01fold")
        self.assertEqual(state["action"], "updated")
        self.assertEqual(len(backups), 1)
        self.assertRegex(backups[0], r"^state\.previous-01fold-\d{8}T\d{6}Z\.json$")
        methods = [(method, path.split("?")[0]) for method, path, _ in calls]
        self.assertLess(methods.index(("get", "/api/2.0/genie/spaces/01fold")),
                        methods.index(("patch", "/api/2.0/genie/spaces/01fold")))
        patch = next(body for method, path, body in calls if method == "patch")
        self.assertNotIn("parent_path", patch)

    def test_viewer_group_gets_can_run(self):
        calls, state, _ = self.run_deploy("--viewer-group", "monday-morning-viewers")
        grant = next(body for method, path, body in calls if path.startswith("/api/2.0/permissions/genie/"))
        self.assertEqual(grant["access_control_list"],
                         [{"group_name": "monday-morning-viewers", "permission_level": "CAN_RUN"}])
        self.assertEqual(state["viewer_group_can_run"], "monday-morning-viewers")


if __name__ == "__main__":
    unittest.main()
