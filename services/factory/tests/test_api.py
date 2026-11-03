"""HTTP API on the memory store and on SQL stores (SQLite always, PostgreSQL when FACTORY_TEST_PG_URL is set)."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_sql_store
from api_cases import ApiCases
from factory_core.store import MemoryStore


class MemoryBackend:
    def make_store(self):
        return MemoryStore()


for _name, _backend in (('Memory', MemoryBackend), *test_sql_store.backends()):
    globals()[f'{_name}ApiTests'] = type(f'{_name}ApiTests', (_backend, ApiCases, unittest.TestCase), {})


if __name__ == '__main__':
    unittest.main()
