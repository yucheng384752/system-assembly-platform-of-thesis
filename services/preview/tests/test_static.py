"""Run with Python standard library only: python -B -m unittest discover -s services/preview/tests."""
import ast
import importlib.util
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

    def test_real_guard_without_third_party_imports(self):
        # Compile actual guard functions, supplying only the exception and query seam.
        tree = ast.parse((ROOT / "app/preview_support.py").read_text(encoding="utf-8"))
        functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name == "reject_table_code"]

        class HTTPException(Exception):
            def __init__(self, status_code, detail):
                self.status_code, self.detail = status_code, detail

        namespace = {"HTTPException": HTTPException}
        exec(compile(ast.Module(body=functions, type_ignores=[]), "guard", "exec"), namespace)
        guard = namespace["reject_table_code"]
        for code in ("P1", "P2", "P3", " p1 "):
            with self.assertRaises(HTTPException) as caught:
                guard(code)
            self.assertEqual(caught.exception.status_code, 501)
            self.assertIn("T1", caught.exception.detail)
        for code in (None, "", "synthetic-form"):
            guard(code)


if __name__ == "__main__":
    unittest.main()
