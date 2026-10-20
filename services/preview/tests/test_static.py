"""Run with Python standard library only: python -B -m unittest discover -s services/preview/tests."""
import ast
import asyncio
import hashlib
import importlib.util
import json
import tempfile
import unittest
import copy
import os
import subprocess
import sys
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_tree", ROOT / "check_tree.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)
spec = importlib.util.spec_from_file_location("preview_gate", ROOT / "app/preview_gate.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


class GateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=ROOT)
        cls.assembled = Path(cls.temp.name) / "assembled"
        subprocess.run(["node", str(ROOT / "assemble.mjs"), str(cls.assembled)], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        cls.catalog = json.loads((cls.assembled / "app/preview_policy.json").read_text(encoding="utf-8"))
        cls.schema = json.loads((cls.assembled / "app/recipe.schema.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory(dir=ROOT)
        self.addCleanup(self.tempdir.cleanup)
        self.state = Path(self.tempdir.name) / "recipe.json"
        self.gate = policy.Gate(self.catalog, self.schema, self.state)
        self.recipe = {"recipeVersion": "0.2.0", "name": "synthetic-preview",
                       "sourceManifest": "synthetic", "database": {"engine": "postgresql"},
                       "enabledKits": list(self.catalog["kits"])}

    def test_real_assembly_import_closure(self):
        self.assertGreater(checker.check(self.assembled), 70)

    def test_default_subfeatures_parameters_slashes_and_literal_priority(self):
        self.gate.replace(self.recipe)
        self.assertIsNone(self.gate.request("GET", "/api/analytics/trend/"))
        self.assertIsNone(self.gate.request("GET", "/api/v2/import/jobs/synthetic"))
        self.recipe["selectedSubfeatures"] = {"analytics-kit": []}
        self.gate.replace(self.recipe)
        self.assertEqual(self.gate.request("GET", "/api/analytics/trend")["detail"], "子功能未開放")
        self.assertTrue(policy.matches("/api/jobs/{id}", "/api/jobs/a/"))
        self.assertFalse(policy.matches("/api/jobs/{id}", "/api/jobs/a/b"))
        self.gate.catalog = copy.deepcopy(self.catalog)
        self.gate.catalog["capabilities"]["test.dynamic"] = {
            "kit": "analytics-kit", "method": "GET", "path": "/api/v2/import/jobs/{id}", "subfeatures": []}
        self.gate.catalog["capabilities"]["test.literal"] = {
            "kit": "station-admin-kit", "method": "GET", "path": "/api/v2/import/jobs/fixed", "subfeatures": []}
        self.assertEqual(self.gate.request("GET", "/api/v2/import/jobs/fixed")["detail"], "預覽無來源")

    def test_d109_typical_recipe_unavailable_and_missing_executable_dependency(self):
        self.gate.replace(self.recipe)
        snapshot = self.gate.snapshot()
        self.assertEqual(len(snapshot["unavailable"]), 3)
        self.assertTrue(any("依賴未滿足" in w for w in snapshot["warnings"]))
        self.assertEqual(self.gate.request("GET", "/api/stations")["detail"], "預覽無來源")
        self.assertEqual(self.gate.deny("entry-permission-kit")["detail"], "預覽無來源")
        self.assertEqual(self.gate.deny("station-data-link-kit")["detail"], "預覽無來源")
        self.recipe["enabledKits"].remove("entry-permission-kit")
        self.recipe["enabledKits"].remove("station-data-link-kit")
        self.gate.replace(self.recipe)  # Missing unavailable dependencies warn, never block.
        self.recipe["enabledKits"].remove("upload-validation-kit")
        with self.assertRaisesRegex(ValueError, "analytics-kit 缺少依賴 upload-validation-kit"):
            self.gate.replace(self.recipe)

    def test_unknown_fallback_broker_and_disabled_kit(self):
        self.gate.routes = [{"kit": "analytics-kit", "methods": ["GET"], "path": "/api/extra/{id}"}]
        self.assertIsNone(self.gate.request("GET", "/api/extra/one"))
        self.assertIsNotNone(self.gate.request("GET", "/api/extra/one/more"))
        self.assertIsNotNone(self.gate.request("DELETE", "/api/extra/one"))
        self.assertIsNotNone(self.gate.request("GET", "/unknown"))
        self.assertIsNone(self.gate.request("GET", "/healthz"))
        self.assertIsNone(self.gate.request("PUT", "/_preview/recipe"))
        self.recipe["enabledKits"].remove("analytics-kit")
        self.gate.replace(self.recipe)
        for route in ("/api/extra/one", "/api/analytics/trend", "/api/kit/call/analytics.trend"):
            self.assertEqual(self.gate.request("GET", route)["kit"], "analytics-kit")
        self.assertIsNotNone(self.gate.request("POST", "/api/kit/call/unknown"))
        self.recipe["selectedSubfeatures"] = {"audit-edit-kit": []}
        self.gate.replace(self.recipe)
        self.assertEqual(self.gate.capability("db.edit-reasons.validate")["detail"], "子功能未開放")

    def test_atomic_validation_persistence_reload_and_reset(self):
        self.gate.replace(self.recipe)
        before = self.state.read_bytes()
        invalid = [
            {}, {"enabledKits": []}, {**self.recipe, "enabledKits": ["unknown"]},
            {**self.recipe, "selectedSubfeatures": {"analytics-kit": ["unknown"]}},
            {**self.recipe, "enabledKits": ["tenant-auth-kit"]},
            {**self.recipe, "database": {"engine": "invalid"}},
        ]
        for candidate in invalid:
            with self.assertRaises(ValueError):
                self.gate.replace(candidate)
            self.assertEqual(self.state.read_bytes(), before)
            self.assertEqual(self.gate.recipe, self.recipe)
        with patch.object(policy.os, "replace", side_effect=OSError("synthetic disk failure")):
            with self.assertRaises(OSError):
                self.gate.replace(None)
        self.assertEqual(self.state.read_bytes(), before)
        self.assertEqual(self.gate.recipe, self.recipe)
        reloaded = policy.Gate(self.catalog, self.schema, self.state)
        self.assertEqual(reloaded.snapshot(), self.gate.snapshot())
        self.gate.replace(None)
        self.assertEqual(policy.Gate(self.catalog, self.schema, self.state, self.recipe).snapshot()["mode"], "all")
        self.state.write_text("{}")
        with self.assertRaises(ValueError):
            policy.Gate(self.catalog, self.schema, self.state)

    def test_image_cannot_enable_omitted_executable_kit(self):
        catalog = copy.deepcopy(self.catalog)
        catalog["kits"]["analytics-kit"]["assembled"] = False
        gate = policy.Gate(catalog, self.schema, self.state)
        gate.replace(self.recipe)
        self.assertTrue(any("analytics-kit：未納入此映像" in w for w in gate.warnings))
        self.assertIn({"kit": "analytics-kit", "reason": "未納入此映像"}, gate.snapshot()["unavailable"])
        self.assertEqual(gate.capability("analytics.trend")["detail"], "未納入此映像")

    def test_asgi_denies_before_handler_and_keeps_json_contract(self):
        events, called = [], []

        async def app(scope, receive, send):
            called.append(scope["path"])

        async def send(event):
            events.append(event)

        async def receive():
            raise AssertionError("gate must not consume request body")

        middleware = policy.GateMiddleware(app, self.gate)
        asyncio.run(middleware({"type": "http", "method": "GET", "path": "/unknown"}, receive, send))
        self.assertFalse(called)
        self.assertEqual(events[0]["status"], 403)
        self.assertEqual(set(json.loads(events[1]["body"])), {"detail", "capability", "kit"})
        asyncio.run(middleware({"type": "http", "method": "GET", "path": "/healthz"}, receive, send))
        self.assertEqual(called, ["/healthz"])

    def test_recipe_assembly_runs_real_validator_and_reports_import_gap(self):
        source = Path(self.tempdir.name) / "input.json"
        self.recipe["enabledKits"] = ["platform-core-kit"]
        source.write_text(json.dumps(self.recipe))
        output = Path(self.tempdir.name) / "output"
        result = subprocess.run(["node", str(ROOT / "assemble.mjs"), str(output), "--recipe", str(source)],
                                env={**os.environ, "PREVIEW_PYTHON": sys.executable},
                                capture_output=True, text=True, encoding="utf-8")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing app.models.station", result.stderr)
        self.assertTrue((output / "assembly-report.json").exists())

    def test_management_endpoints_admin_and_invalid_payload(self):
        # Exercise the real endpoint functions without importing SQLAlchemy or opening a port.
        tree = ast.parse((ROOT / "app/main.py").read_text(encoding="utf-8"))
        nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                 and n.name in {"require_admin", "put_recipe", "delete_recipe"}]
        for node in nodes:
            node.decorator_list = []

        class HTTPException(Exception):
            def __init__(self, status_code, detail):
                self.status_code, self.detail = status_code, detail

        class Request:
            def __init__(self, admin, body):
                self.state = type("State", (), {"is_admin": admin})()
                self.body = body

            async def json(self):
                return self.body

        namespace = {"HTTPException": HTTPException, "Request": Request, "gate": self.gate}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), "endpoints", "exec"), namespace)
        for name in ("put_recipe", "delete_recipe"):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(namespace[name](Request(False, self.recipe)))
            self.assertEqual(error.exception.status_code, 403)
        for invalid in ({}, None):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(namespace["put_recipe"](Request(True, invalid)))
            self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(asyncio.run(namespace["put_recipe"](Request(True, self.recipe)))["mode"], "recipe")
        self.assertEqual(asyncio.run(namespace["delete_recipe"](Request(True, None)))["mode"], "all")


class StaticTests(unittest.TestCase):
    def test_missing_relative_and_absolute_imports_and_syntax(self):
        with tempfile.TemporaryDirectory(dir=ROOT) as temp:
            app = Path(temp) / "app"
            app.mkdir()
            (app / "__init__.py").write_text("")
            source = app / "main.py"
            for code in ("from app.missing import Value", "from .missing import Value", "from app import missing"):
                source.write_text(code)
                with self.assertRaisesRegex(ValueError, "missing"):
                    checker.check(temp)
            source.write_text("if:")
            with self.assertRaises(SyntaxError):
                checker.check(temp)
            source.write_text("from app import main")
            self.assertEqual(checker.check(temp), 2)

    def test_preview_environment_guard(self):
        tree = ast.parse((ROOT / "app/preview_support.py").read_text(encoding="utf-8"))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
        import types
        env = {
            "COMPOSER_PREVIEW": "1",
            "DATABASE_URL": "postgresql+asyncpg://preview:preview-local-only@postgres:5432/preview",
            "MOD_API_BASE_URL": "http://127.0.0.1:8000/_preview/mod",
        }
        namespace = {"os": types.SimpleNamespace(environ=env)}
        exec(compile(ast.Module(body=functions, type_ignores=[]), "guard", "exec"), namespace)
        guard = namespace["require_preview"]
        guard()
        for key in (*env, "PDF_SERVER_URL", "MONITOR_SERVER_URL"):
            old = env.get(key)
            env[key] = "invalid"
            with self.assertRaises(RuntimeError):
                guard()
            if old is None:
                del env[key]
            else:
                env[key] = old

    def test_model_fields_match_actual_callers(self):
        source = ROOT.parents[1] / "kits/import-pipeline-kit/src/backend/app/services/import_v2.py"
        service = ast.parse(source.read_text(encoding="utf-8"))
        models = {"P1Record": "p1_record", "P2Record": "p2_record",
                  "P3Record": "p3_record", "P2ItemV2": "p2_item_v2", "P3ItemV2": "p3_item_v2"}
        for name, module in models.items():
            tree = ast.parse((ROOT / "app/models" / (module + ".py")).read_text(encoding="utf-8"))
            compile(tree, module, "exec")
            cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
            fields = {n.targets[0].id for n in cls.body if isinstance(n, ast.Assign)} - {"__tablename__"}
            used = {kw.arg for n in ast.walk(service) if isinstance(n, ast.Call)
                    and isinstance(n.func, ast.Name) and n.func.id == name for kw in n.keywords}
            if name.endswith("Record"):
                used.add("updated_at")
            if name == "P2ItemV2":
                used.update(["slitting_result", "sheet_width", "appearance", "rough_edge"])
                used.update("thickness" + str(i) for i in range(1, 8))
            self.assertEqual(fields, used, name)

    def test_seed_is_idempotent_and_rejects_schema_drift(self):
        # Execute the actual seed against an in-memory query seam; no DB/third-party imports.
        class Field:
            def __init__(self, name):
                self.name = name

            def __eq__(self, value):
                return lambda row: getattr(row, self.name, None) == value

        class Row:
            def __init__(self, **values):
                self.__dict__.update(values)

        names = ("TableRegistry", "SchemaVersion", "Station", "StationSchema")
        models = {name: type(name, (Row,), {key: Field(key) for key in
                  ("id", "table_code", "table_id", "tenant_id", "code", "station_id")})
                  for name in names}

        class Query:
            def __init__(self, model):
                self.model = model

            def where(self, *filters):
                self.filters = filters
                return self

        class Session:
            def __init__(self):
                self.rows = []

            def add(self, row):
                row.id = len(self.rows) + 1
                self.rows.append(row)

            async def flush(self):
                pass

            async def execute(self, query):
                rows = [row for row in self.rows if isinstance(row, query.model)
                        and all(predicate(row) for predicate in query.filters)]
                if len(rows) > 1:
                    raise ValueError("multiple rows")
                return type("Result", (), {"scalar_one_or_none": lambda _: rows[0] if rows else None})()

        tree = ast.parse((ROOT / "app/preview_seed.py").read_text(encoding="utf-8"))
        functions = [n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "seed_tables"]
        namespace = {**models, "select": Query, "hashlib": hashlib, "json": json}
        exec(compile(ast.Module(body=functions, type_ignores=[]), "seed", "exec"), namespace)
        session = Session()
        seed = namespace["seed_tables"]
        asyncio.run(seed(session, "synthetic-tenant"))
        self.assertEqual(len(session.rows), 7)
        asyncio.run(seed(session, "synthetic-tenant"))
        self.assertEqual(len(session.rows), 7)
        version = next(row for row in session.rows if isinstance(row, models["SchemaVersion"]))
        self.assertEqual(version.header_fingerprint, hashlib.sha256(b"entry_key|value").hexdigest())
        version.schema_json = {"fields": []}
        with self.assertRaisesRegex(ValueError, "differs"):
            asyncio.run(seed(session, "synthetic-tenant"))


if __name__ == "__main__":
    unittest.main()
