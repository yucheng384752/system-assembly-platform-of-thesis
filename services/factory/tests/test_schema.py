"""Full schema validation: the same schema file the TypeScript side uses, with located errors, never skipped."""
import copy
import os
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures import load
from factory_core import schema_check


class SchemaCheckTests(unittest.TestCase):
    def test_the_fixtures_the_typescript_builder_produced_conform(self):
        for name in ('valid.json', 'timing-missing.json', 'not-executable.json'):
            with self.subTest(name):
                self.assertEqual(schema_check.schema_errors(load(name)), [])

    def test_errors_are_located_by_path(self):
        plan = load('valid.json')
        plan['nodes'][1]['unexpected'] = 1
        del plan['flows'][0]['from']
        paths = {e['path'] for e in schema_check.schema_errors(plan)}
        self.assertIn('/nodes/1', paths)
        self.assertIn('/flows/0', paths)

    def test_a_wrong_type_deep_in_the_plan_is_found(self):
        plan = copy.deepcopy(load('valid.json'))
        plan['params'][0]['tunable'] = 'yes'
        self.assertTrue(any(e['path'].startswith('/params/0') for e in schema_check.schema_errors(plan)))

    def test_a_missing_schema_file_fails_loudly_instead_of_skipping_validation(self):
        schema_check._validator.cache_clear()
        os.environ['FACTORY_PLAN_SCHEMA'] = str(Path(__file__).parent / 'no-such-schema.json')
        try:
            with self.assertRaises(FileNotFoundError):
                schema_check.schema_errors(load('valid.json'))
        finally:
            del os.environ['FACTORY_PLAN_SCHEMA']
            schema_check._validator.cache_clear()


if __name__ == '__main__':
    unittest.main()
