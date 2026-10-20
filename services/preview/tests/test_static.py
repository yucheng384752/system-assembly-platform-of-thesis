"""Run with Python standard library only: python -B -m unittest discover -s services/preview/tests."""
import ast
import asyncio
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("check_tree", ROOT / "check_tree.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


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
