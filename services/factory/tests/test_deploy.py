"""Deployment wiring: database URL conversion, the environment a package describes, and first-install schema creation."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from unittest import mock

from evaluator_support import NODE, fake, real_command
from fixtures import FORM_UPLOAD, NOW, PLAN_DIR, load, text
from sqlalchemy import create_engine, inspect

from factory_api.deploy import PackagedFormError, deployed_environment, evaluator_for, init_schema, load_packaged_forms, open_state, sync_database_url
from factory_core.evaluator import Evaluator
from factory_core.plan import PlanRejected
from factory_core.store import MemoryStore
from factory_core.workorder import FactoryState


class PackagedFormTests(unittest.TestCase):
    """Forms ride in the system package as `forms/<hash>.json`, each exactly an upload body, and are registered on start."""

    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.directory = Path(self.root.name) / 'forms'
        self.state = FactoryState(MemoryStore())
        self.form_hash = load('forms.json')['forms'][0]['contentSha256']

    def ship(self, name, body):
        self.directory.mkdir(exist_ok=True)
        (self.directory / name).write_text(body, encoding='utf-8')

    def test_a_package_without_forms_registers_nothing_and_is_not_an_error(self):
        self.assertEqual(load_packaged_forms(self.state, Path(self.root.name), NOW), [])
        self.assertEqual(set(self.state.store.form_hashes()), set())

    def test_a_shipped_form_is_registered_under_the_system_package_and_a_restart_changes_nothing(self):
        self.ship(f'{self.form_hash}.json', FORM_UPLOAD)
        self.assertEqual(load_packaged_forms(self.state, Path(self.root.name), NOW), [self.form_hash])
        record = self.state.store.get_form(self.form_hash)
        self.assertEqual((record.uploaded_by, record.uploaded_at), ('system-package', NOW))
        load_packaged_forms(self.state, Path(self.root.name), '2026-11-02T00:00:00Z')
        self.assertEqual(self.state.store.get_form(self.form_hash).uploaded_at, NOW)  # the first registration stands

    def test_a_form_that_does_not_prove_its_hash_is_never_registered_and_the_start_says_so(self):
        tampered = FORM_UPLOAD.replace('"fields"', '"fields"', 1).replace(self.form_hash, '0' * 64)
        self.ship(f'{"0" * 64}.json', tampered)
        with self.assertRaisesRegex(PackagedFormError, 'form-hash-mismatch'):
            load_packaged_forms(self.state, Path(self.root.name), NOW)
        self.assertEqual(set(self.state.store.form_hashes()), set())

    def test_a_file_named_for_another_hash_is_refused_so_the_package_listing_cannot_lie(self):
        self.ship(f'{"1" * 64}.json', FORM_UPLOAD)
        with self.assertRaisesRegex(PackagedFormError, 'file name must be the form hash'):
            load_packaged_forms(self.state, Path(self.root.name), NOW)

    def test_every_bad_file_is_reported_together_and_the_good_one_is_still_registered(self):
        self.ship(f'{self.form_hash}.json', FORM_UPLOAD)
        self.ship('broken.json', '{not json')
        self.ship('empty.json', '{}')
        with self.assertRaises(PackagedFormError) as raised:
            load_packaged_forms(self.state, Path(self.root.name), NOW)
        self.assertIn('broken.json', str(raised.exception))
        self.assertIn('empty.json', str(raised.exception))
        self.assertEqual(set(self.state.store.form_hashes()), {self.form_hash})


class DeployTests(unittest.TestCase):
    def test_the_async_backend_url_becomes_the_synchronous_psycopg_url_with_everything_else_kept(self):
        for given in ('postgresql+asyncpg://u:p@db:5432/x', 'postgresql://u:p@db:5432/x', 'postgresql+psycopg://u:p@db:5432/x'):
            self.assertEqual(sync_database_url(given), 'postgresql+psycopg://u:p@db:5432/x')

    def test_anything_that_is_not_postgresql_is_refused_rather_than_guessed(self):
        for given in ('sqlite:///x.db', 'mysql://u:p@db/x', '', 'postgres://u:p@db/x'):
            with self.subTest(given), self.assertRaises(ValueError):
                sync_database_url(given)

    def test_the_package_has_an_evaluator_only_with_both_node_and_its_bundle(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIsNone(evaluator_for(Path(root)))  # no bundle
            (Path(root) / 'evaluator').mkdir()
            (Path(root) / 'evaluator' / 'evaluator.cjs').write_text('', encoding='utf-8')
            with mock.patch('factory_api.deploy.shutil.which', return_value=None):
                self.assertIsNone(evaluator_for(Path(root)))  # no node
            with mock.patch('factory_api.deploy.shutil.which', return_value='/usr/local/bin/node'):
                self.assertIsInstance(evaluator_for(Path(root)), Evaluator)

    def test_the_environments_evaluator_commit_is_what_the_running_evaluator_reports_and_none_when_it_cannot(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertIsNone(deployed_environment(Path(root)).evaluator_commit)
            broken = Evaluator(['/no/such/evaluator'])
            self.assertIsNone(deployed_environment(Path(root), broken).evaluator_commit)  # reported, not raised, and not guessed
            hello = '\n'.join(['import json, sys', 'for line in sys.stdin:', '    r = json.loads(line)',
                               "    print(json.dumps({'id': r['id'], 'ok': True, 'commit': 'c0ffee', 'protocol': 1}), flush=True)"])
            fine = Evaluator(fake(hello))
            self.addCleanup(fine.close)
            self.assertEqual(deployed_environment(Path(root), fine).evaluator_commit, 'c0ffee')

    @unittest.skipUnless(NODE, 'node is not available: the real evaluator was not exercised')
    def test_the_real_bundle_gives_the_commit_plans_are_checked_against(self):
        from fixtures import EVALUATOR
        real = Evaluator(real_command())
        self.addCleanup(real.close)
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(deployed_environment(Path(root), real).evaluator_commit, EVALUATOR)

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

    def test_no_uploaded_form_and_no_evaluator_means_plans_that_need_them_cannot_make_work_orders(self):
        with tempfile.TemporaryDirectory() as root:
            for kit in ('inventory-kit', 'work-order-kit', 'quality-kit'):
                (Path(root) / 'kits' / kit).mkdir(parents=True)
                (Path(root) / 'kits' / kit / 'kit.contract.json').write_text('{}', encoding='utf-8')
            env = deployed_environment(Path(root))
        self.assertIsNone(env.evaluator_commit)
        directory = tempfile.mkdtemp(prefix='factory-deploy-')
        self.addCleanup(lambda: [p.unlink() for p in Path(directory).glob('*')] and Path(directory).rmdir())
        engine = create_engine(f"sqlite:///{Path(directory, 'f.db').as_posix()}")
        self.addCleanup(engine.dispose)
        init_schema(engine)
        state = open_state(engine)
        plan_id = state.store_plan(text(load('valid.json'))).plan_id
        with self.assertRaises(PlanRejected) as caught:
            state.create_order('wo-1', plan_id, created_by='u', now='2026-10-28T12:00:00Z', active_kits=set(env.active_kits),
                               evaluator_commit=env.evaluator_commit)
        self.assertEqual({e['code'] for e in caught.exception.errors}, {'form-unavailable', 'evaluator-mismatch'})

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
