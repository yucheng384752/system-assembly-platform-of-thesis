"""Table names written into SQL text must pass safe_identifier (standard library only, like test_license.py).

A table name cannot be a bound parameter, so the Kits build those statements as text. The names come from the table
registry; if a name with a quote ever reached it, the statement would run whatever followed the quote. Two things are
checked: the rule itself, and that no Kit reads from an interpolated table name without applying it.
"""
import ast
import re
import unittest
from pathlib import Path

KITS = Path(__file__).resolve().parents[2]
SOURCE = KITS / "platform-core-kit/src/backend/app/core/db_capabilities.py"


class Refused(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code


def load():
    """Only the pure helper, so the test needs neither FastAPI nor a database."""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
    body = [node for node in tree.body if getattr(node, "name", None) == "safe_identifier"]
    assert len(body) == 1
    scope = {"HTTPException": Refused, "Any": object}
    exec(compile(ast.Module(body=body, type_ignores=[]), str(SOURCE), "exec"), scope)
    return scope["safe_identifier"]


class SafeIdentifierTests(unittest.TestCase):
    def test_registry_style_names_pass_unchanged(self):
        safe = load()
        for name in ("daihui_entry", "P1", "preview_entries", "t_2026"):
            self.assertEqual(safe(name), name)

    def test_anything_that_could_end_the_quoted_name_is_refused(self):
        safe = load()
        for name in ('x" ; DROP TABLE ep_users; --', 'a"b', "a b", "a-b", "a.b", "a;b", "", "_", None, 7, ["x"]):
            with self.subTest(name=name), self.assertRaises(Refused) as error:
                safe(name)
            self.assertEqual(error.exception.status_code, 422)


class CallSiteTests(unittest.TestCase):
    def test_every_read_from_an_interpolated_table_name_applies_the_rule(self):
        reads = re.compile(r'FROM "\{([^}]*)\}"')
        found, bare = 0, []
        for path in sorted(KITS.glob("*/src/backend/**/*.py")):
            for expression in reads.findall(path.read_text(encoding="utf-8-sig")):
                found += 1
                if not expression.startswith("safe_identifier("):
                    bare.append(f"{path.relative_to(KITS)}: {expression}")
        self.assertEqual(bare, [])
        # If the statements are rewritten so the pattern no longer finds them, this test must be rewritten too.
        self.assertGreaterEqual(found, 4)


if __name__ == "__main__":
    unittest.main()
