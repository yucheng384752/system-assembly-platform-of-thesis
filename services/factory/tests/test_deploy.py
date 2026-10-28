"""Deployment wiring: database URL conversion, the environment a package describes, and first-install schema creation."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures import PLAN_DIR, load, text
from sqlalchemy import create_engine, inspect

from factory_api.deploy import deployed_environment, init_schema, open_state, sync_database_url
from factory_core.plan import PlanRejected


class DeployTests(unittest.TestCase):
    def test_the_async_backend_url_becomes_the_synchronous_psycopg_url_with_everything_else_kept(self):
        for given in ('postgresql+asyncpg://u:p@db:5432/x', 'postgresql://u:p@db:5432/x', 'postgresql+psycopg://u:p@db:5432/x'):
            self.assertEqual(sync_database_url(given), 'postgresql+psycopg://u:p@db:5432/x')

    def test_anything_that_is_not_postgresql_is_refused_rather_than_guessed(self):
        for given in ('sqlite:///x.db', 'mysql://u:p@db/x', '', 'postgres://u:p@db/x'):
            with self.subTest(given), self.assertRaises(ValueError):
                sync_database_url(given)

    def test_active_kits_are_the_kits_shipped_in_the_package(self):
        with tempfile.TemporaryDirectory() as root:
            for kit in ('work-order-kit', 'quality-kit'):
                (Path(root) / 'kits' / kit).mkdir(parents=True)
                (Path(root) / 'kits' / kit / 'kit.contract.json').write_text('{}', encoding='utf-8')
            (Path(root) / 'kits' / 'stray-dir').mkdir()  # no contract: not a kit
            env = deployed_environment(Path(root))
        self.assertEqual(env.active_kits, frozenset({'work-order-kit', 'quality-kit'}))

    def test_a_package_without_kits_has_no_active_kits(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(deployed_environment(Path(root)).active_kits, frozenset())

    def test_no_forms_and_no_evaluator_means_plans_that_need_them_cannot_make_work_orders(self):
        with tempfile.TemporaryDirectory() as root:
            for kit in ('inventory-kit', 'work-order-kit', 'quality-kit'):
                (Path(root) / 'kits' / kit).mkdir(parents=True)
                (Path(root) / 'kits' / kit / 'kit.contract.json').write_text('{}', encoding='utf-8')
            env = deployed_environment(Path(root))
        self.assertEqual((env.form_hashes, env.evaluator_commit), ({}, None))
        directory = tempfile.mkdtemp(prefix='factory-deploy-')
        self.addCleanup(lambda: [p.unlink() for p in Path(directory).glob('*')] and Path(directory).rmdir())
        engine = create_engine(f"sqlite:///{Path(directory, 'f.db').as_posix()}")
        self.addCleanup(engine.dispose)
        init_schema(engine)
        state = open_state(engine)
        plan_id = state.store_plan(text(load('valid.json'))).plan_id
        with self.assertRaises(PlanRejected) as caught:
            state.create_order('wo-1', plan_id, created_by='u', now='2026-10-28T12:00:00Z', active_kits=set(env.active_kits),
                               form_hashes=env.form_hashes, evaluator_commit=env.evaluator_commit)
        self.assertEqual({e['code'] for e in caught.exception.errors}, {'form-mismatch', 'evaluator-mismatch'})

    def test_init_schema_creates_the_tables_and_is_safe_to_run_twice(self):
        directory = tempfile.mkdtemp(prefix='factory-deploy-')
        self.addCleanup(lambda: [p.unlink() for p in Path(directory).glob('*')] and Path(directory).rmdir())
        engine = create_engine(f"sqlite:///{Path(directory, 'f.db').as_posix()}")
        self.addCleanup(engine.dispose)
        init_schema(engine)
        init_schema(engine)
        tables = set(inspect(engine).get_table_names())
        self.assertTrue({'plans', 'parameter_sets', 'work_orders', 'alarms', 'alembic_version'} <= tables)


if __name__ == '__main__':
    unittest.main()
