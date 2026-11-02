"""Typed CSV cells (composer-refactor D152).

A form field declared as integer, decimal, boolean or date must not silently keep text such as "abc":
the value would sit next to real numbers and corrupt later sums and averages. The row is rejected
with a message that names the column and the bad value, so the operator can fix the file.
"""
from __future__ import annotations

import ast
import math
import types
import unittest
from datetime import datetime
from pathlib import Path
from typing import Any

SOURCE = Path(__file__).resolve().parents[1] / "src/backend/app/api/routes_generic_forms.py"


def load() -> types.SimpleNamespace:
    """Execute only the pure row-mapping helpers, so the test needs neither FastAPI nor a database."""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
    wanted = {"CoerceError", "_coerce", "_map_row"}
    body = [node for node in tree.body if getattr(node, "name", None) in wanted]
    assert {node.name for node in body} == wanted
    pd = types.SimpleNamespace(isna=lambda value: value != value)
    scope: dict[str, Any] = {"pd": pd, "math": math, "datetime": datetime, "Any": Any}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(SOURCE), "exec"), scope)
    return types.SimpleNamespace(**scope)


class RowTypes(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.m = load()

    def test_valid_values_are_converted(self) -> None:
        c = self.m._coerce
        self.assertEqual(c("10", "integer"), 10)
        self.assertEqual(c("10.0", "integer"), 10)
        self.assertEqual(c("2.5", "decimal"), 2.5)
        self.assertIs(c("yes", "boolean"), True)
        self.assertEqual(c("2026-10-30", "date"), "2026-10-30")
        self.assertEqual(c("anything", "string"), "anything")
        self.assertIsNone(c("  ", "integer"))

    def test_text_in_a_number_column_is_rejected_not_kept(self) -> None:
        for ftype, bad in [("integer", "abc"), ("integer", "1.5"), ("integer", "inf"), ("integer", "nan"),
                           ("decimal", "x"), ("decimal", "nan"), ("boolean", "maybe"), ("date", "30/10")]:
            with self.subTest(ftype=ftype, bad=bad), self.assertRaises(self.m.CoerceError):
                self.m._coerce(bad, ftype)

    def test_row_with_a_bad_cell_reports_column_and_value_and_keeps_no_data(self) -> None:
        fields = [{"name": "lot_no", "type": "string", "required": True},
                  {"name": "qty", "type": "integer", "sourceName": "Qty"}]
        data, errors = self.m._map_row({"lot_no": "L1", "Qty": "abc"}, fields)
        self.assertEqual(len(errors), 1)
        self.assertIn("Qty", errors[0])
        self.assertIn("abc", errors[0])
        self.assertNotIn("qty", data)

    def test_good_row_has_no_errors(self) -> None:
        fields = [{"name": "lot_no", "type": "string", "required": True}, {"name": "qty", "type": "integer"}]
        data, errors = self.m._map_row({"lot_no": "L1", "qty": "7"}, fields)
        self.assertEqual((data, errors), ({"lot_no": "L1", "qty": 7}, []))


if __name__ == "__main__":
    unittest.main()
