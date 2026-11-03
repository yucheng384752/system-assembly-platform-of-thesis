"""kits/factory-core-kit is generated from services/factory; a hand edit or a forgotten sync must fail here."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import sync_kit


class KitSyncTests(unittest.TestCase):
    def test_the_kit_copy_equals_what_the_sync_tool_would_write(self):
        self.assertEqual(sync_kit.differences(), [], 'run: python services/factory/tools/sync_kit.py')

    def test_the_rewrite_changes_only_the_import_roots(self):
        self.assertEqual(sync_kit.rewrite('from factory_core.plan import x\nimport factory_api\nfrom factory_api.support import y\n'),
                         'from app.factory_core.plan import x\nimport app.factory_api\nfrom app.factory_api.support import y\n')
        untouched = 'the factory_core package and factory_api module, "from factory_core" in a string stays'
        self.assertEqual(sync_kit.rewrite('x = 1  # ' + untouched), 'x = 1  # ' + untouched.replace('"from factory_core"', '"from app.factory_core"'))

    def test_the_routes_module_lands_where_the_assembler_looks_for_routes(self):
        self.assertIn(Path('src/backend/app/api/routes_factory.py'), sync_kit.wanted())
        self.assertNotIn(Path('src/backend/app/factory_api/routes_factory.py'), sync_kit.wanted())

    def test_a_stale_file_in_the_kit_is_reported(self):
        stray = sync_kit.BACKEND / 'factory_core' / 'stray_module.py'
        stray.write_text('x = 1\n', encoding='utf-8')
        try:
            self.assertIn('stale: src/backend/app/factory_core/stray_module.py', sync_kit.differences())
        finally:
            stray.unlink()


if __name__ == '__main__':
    unittest.main()
