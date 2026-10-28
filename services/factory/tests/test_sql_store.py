"""The SQL store must behave exactly like the memory store, and the database itself must enforce the append-only rules.

SQLite always runs. PostgreSQL runs when FACTORY_TEST_PG_URL is set (for example
postgresql+psycopg://factory:factory@127.0.0.1:5432/factory_test); it is wiped between tests, so use a scratch database.
"""
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_params
import test_workorder
from alarm_cases import AlarmCases, NODE, RULE, at
from fixtures import EVALUATOR, FORMS, KITS, NOW, load
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError, IntegrityError

from factory_core.alarms import AlarmService
from factory_core.canonical import content_sha256
from factory_core.sql_schema import create_all, metadata
from factory_core.sql_store import SqlStore, StoreCorrupt
from factory_core.store import AlreadyExists
from factory_core.workorder import FactoryState

PG_URL = os.environ.get('FACTORY_TEST_PG_URL')


class SqliteBackend:
    def new_engine(self):
        directory = tempfile.mkdtemp(prefix='factory-sql-')
        self.url = f"sqlite:///{Path(directory, 'factory.db').as_posix()}"
        self.addCleanup(lambda: [p.unlink() for p in Path(directory).glob('*')] and Path(directory).rmdir())
        engine = create_engine(self.url, connect_args={'timeout': 30})
        self.addCleanup(engine.dispose)
        create_all(engine)
        return engine

    def reopen(self):
        engine = create_engine(self.url, connect_args={'timeout': 30})
        self.addCleanup(engine.dispose)
        return engine

    def make_store(self):
        self.engine = self.new_engine()
        return SqlStore(self.engine)

    def disable_guards(self, table):
        with self.engine.begin() as conn:
            for (name,) in conn.execute(text("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = :t"), {'t': table}).all():
                conn.exec_driver_sql(f'DROP TRIGGER {name}')


class PostgresBackend:
    def new_engine(self):
        self.url = PG_URL
        engine = create_engine(PG_URL)
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.exec_driver_sql('DROP SCHEMA public CASCADE')
            conn.exec_driver_sql('CREATE SCHEMA public')
        create_all(engine)
        return engine

    def reopen(self):
        engine = create_engine(PG_URL)
        self.addCleanup(engine.dispose)
        return engine

    def make_store(self):
        self.engine = self.new_engine()
        return SqlStore(self.engine)

    def disable_guards(self, table):
        with self.engine.begin() as conn:
            conn.exec_driver_sql(f'ALTER TABLE {table} DISABLE TRIGGER USER')


class SpecificCases:
    def setUp(self):
        self.store = self.make_store()
        self.state = FactoryState(self.store)
        self.plan_id = self.state.store_plan(load('valid.json')).plan_id

    def order(self, order_id='wo-1', start=True):
        self.state.create_order(order_id, self.plan_id, created_by='alice', now=NOW, active_kits=KITS, form_hashes=FORMS, evaluator_commit=EVALUATOR)
        return self.state.start_order(order_id, now=at(0)) if start else self.store.get_order(order_id)

    def refused(self, sql, **params):
        with self.assertRaises((DBAPIError, IntegrityError)):
            with self.engine.begin() as conn:
                conn.execute(text(sql), params)

    def test_everything_survives_a_restart_and_reads_back_identically(self):
        record = self.state.params.propose(self.plan_id, values={'mix_minutes': 12}, tables={'dough_checks': [{'item': 'core', 'limit': 24}]},
                                           alarm_intervals={RULE: 15}, proposed_by='alice', reason='r', now=NOW)
        self.state.params.decide(self.plan_id, 1, approve=True, by='bob', role='manager', now=NOW)
        self.order()
        alarm = AlarmService(self.state).raise_alarm('wo-1', RULE, now=at(1), detail='31 C')
        restarted = FactoryState(SqlStore(self.reopen()))
        self.assertEqual(restarted.params.get(self.plan_id, 1), record)
        self.assertEqual(restarted.params.status(self.plan_id, 1), 'approved')
        self.assertEqual(restarted.orders['wo-1'], self.state.orders['wo-1'])
        self.assertEqual(restarted.effective_params('wo-1')['mix_minutes'], 12)
        self.assertTrue(AlarmService(restarted).is_held('wo-1', NODE))
        self.assertEqual(restarted.store.get_alarm(alarm.alarm_id), alarm)
        self.assertEqual(restarted.plans[self.plan_id].plan, self.state.plans[self.plan_id].plan)

    def test_numbers_round_trip_without_changing_the_content_hash(self):
        given = {'mix_minutes': 7.1 + 0.2}  # 7.300000000000001: a database that rounds would change the hash
        record = self.state.params.propose(self.plan_id, values=given, proposed_by='alice', reason='r', now=NOW)
        read = SqlStore(self.reopen()).get_set(self.plan_id, record.set_version)
        self.assertEqual(read.values, given)
        self.assertEqual(content_sha256({'values': read.values, 'tables': read.tables, 'alarmIntervals': read.alarm_intervals}), record.content_sha256)

    def test_the_database_refuses_edits_and_deletes_of_append_only_records(self):
        self.state.params.propose(self.plan_id, values={'mix_minutes': 12}, proposed_by='alice', reason='r', now=NOW)
        self.state.params.decide(self.plan_id, 1, approve=True, by='bob', role='manager', now=NOW)
        self.order()
        AlarmService(self.state).raise_alarm('wo-1', RULE, now=at(1))
        alarm_id = f'wo-1:{RULE}:1'
        AlarmService(self.state).acknowledge(alarm_id, by='bob', role='manager', now=at(2))
        for sql in ("UPDATE plans SET document = '{}'", 'DELETE FROM plans',
                    "UPDATE parameter_sets SET values_json = '{}'", 'DELETE FROM parameter_sets',
                    "UPDATE parameter_decisions SET status = 'rejected'", 'DELETE FROM parameter_decisions',
                    "UPDATE alarms SET detail = 'x'", 'DELETE FROM alarms',
                    "UPDATE alarm_acks SET note = 'x'", 'DELETE FROM alarm_acks',
                    "UPDATE alarm_notices SET sent_at = 'x'", 'DELETE FROM alarm_notices',
                    'DELETE FROM work_orders', "UPDATE work_orders SET created_by = 'mallory'"):
            with self.subTest(sql):
                self.refused(sql)
        self.assertEqual(self.store.get_set(self.plan_id, 1).values, {'mix_minutes': 12})

    def test_a_started_order_cannot_be_restarted_or_repinned_even_by_raw_sql(self):
        self.order('wo-pending', start=False)
        self.refused("UPDATE work_orders SET plan_id = :other WHERE order_id = 'wo-pending'", other='f' * 64)
        started = self.order('wo-1')
        self.refused("UPDATE work_orders SET set_version = 7 WHERE order_id = 'wo-1'")
        self.refused("UPDATE work_orders SET started_at = '2030-01-01T00:00:00Z' WHERE order_id = 'wo-1'")
        self.assertEqual(self.store.get_order('wo-1'), started)
        with self.assertRaises(AlreadyExists):
            self.store.start_order('wo-1', started_at=at(9), set_version=None, using_defaults=False)

    def test_a_pin_without_a_start_is_refused_by_a_check_constraint(self):
        self.order('wo-pending', start=False)
        self.state.params.propose(self.plan_id, values={}, proposed_by='alice', reason='r', now=NOW)
        self.refused("UPDATE work_orders SET set_version = 1 WHERE order_id = 'wo-pending'")

    def test_a_missing_parent_is_an_error_not_a_silent_duplicate(self):
        from factory_core.alarms import Alarm
        with self.assertRaises(IntegrityError):
            self.store.add_alarm(Alarm('x:y:1', 'no-such-order', 'y', 'n', 1, at(0), ''))

    def test_a_stored_plan_that_no_longer_hashes_to_its_id_is_never_used(self):
        self.disable_guards('plans')
        with self.engine.begin() as conn:
            conn.execute(text('UPDATE plans SET document = replace(document, :a, :b)'), {'a': 'Mix', 'b': 'Mex'})
        with self.assertRaises(StoreCorrupt):
            SqlStore(self.reopen()).get_plan(self.plan_id)

    def test_concurrent_proposals_get_distinct_consecutive_versions(self):
        versions, errors = [], []

        def propose(i):
            try:
                versions.append(self.state.params.propose(self.plan_id, values={'mix_minutes': 5 + i}, proposed_by=f'u{i}', reason='r', now=NOW).set_version)
            except Exception as error:  # noqa: BLE001 - collected and asserted below
                errors.append(error)
        threads = [threading.Thread(target=propose, args=(i,)) for i in range(8)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual((errors, sorted(versions)), ([], list(range(1, 9))))

    def test_concurrent_decisions_on_one_version_let_exactly_one_win(self):
        self.state.params.propose(self.plan_id, values={'mix_minutes': 12}, proposed_by='alice', reason='r', now=NOW)
        outcomes = []

        def decide(i):
            try:
                self.state.params.decide(self.plan_id, 1, approve=True, by=f'm{i}', role='manager', now=NOW)
                outcomes.append('won')
            except Exception as error:  # noqa: BLE001
                outcomes.append(type(error).__name__)
        threads = [threading.Thread(target=decide, args=(i,)) for i in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(outcomes.count('won'), 1)
        self.assertEqual(set(outcomes) - {'won'}, {'ParameterSetError'})

    def test_concurrent_raises_of_one_rule_leave_a_single_open_alarm(self):
        self.order()
        service = AlarmService(self.state)
        seen = []
        threads = [threading.Thread(target=lambda: seen.append(service.raise_alarm('wo-1', RULE, now=at(1)).alarm_id)) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual((len(set(seen)), len(service.open_alarms('wo-1'))), (1, 1))

    def test_concurrent_starts_pin_once(self):
        self.order('wo-1', start=False)
        results = []
        threads = [threading.Thread(target=lambda i=i: results.append(self.state.start_order('wo-1', now=at(i)).started_at)) for i in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(len(set(results)), 1)
        self.assertEqual(self.store.get_order('wo-1').started_at, results[0])


def backends():
    yield 'Sqlite', SqliteBackend
    if PG_URL:
        yield 'Postgres', PostgresBackend


for _name, _backend in backends():
    for _label, _cases in (('Alarms', (AlarmCases, unittest.TestCase)),
                           ('ParameterSets', (test_params.ParameterSetTests,)),
                           ('Approval', (test_params.ApprovalRuleTests,)),
                           ('WorkOrders', (test_workorder.WorkOrderTests,)),
                           ('Specific', (SpecificCases, unittest.TestCase))):
        globals()[f'{_name}{_label}Tests'] = type(f'{_name}{_label}Tests', (_backend, *_cases), {})


class MigrationCases:
    """The Alembic migration and the table definitions must describe the same database, guards included."""

    def test_the_migration_builds_exactly_what_the_metadata_describes(self):
        from alembic.autogenerate import compare_metadata
        from alembic.migration import MigrationContext
        from factory_core.migrate import upgrade
        engine = self.blank_engine()
        upgrade(engine)
        with engine.connect() as conn:
            self.assertEqual(compare_metadata(MigrationContext.configure(conn), metadata), [])
        with self.assertRaises((DBAPIError, IntegrityError)):  # the guards came with the migration, not only with create_all
            with engine.begin() as conn:
                conn.exec_driver_sql("INSERT INTO plans VALUES ('" + 'a' * 64 + "', '{}')")
                conn.exec_driver_sql("UPDATE plans SET document = 'x'")
        with engine.connect() as conn:
            self.assertEqual(conn.exec_driver_sql('SELECT count(*) FROM plans').scalar(), 0)


class SqliteMigrationTests(MigrationCases, unittest.TestCase):
    def blank_engine(self):
        directory = tempfile.mkdtemp(prefix='factory-mig-')
        self.addCleanup(lambda: [p.unlink() for p in Path(directory).glob('*')] and Path(directory).rmdir())
        engine = create_engine(f"sqlite:///{Path(directory, 'migrated.db').as_posix()}")
        self.addCleanup(engine.dispose)
        return engine


@unittest.skipUnless(PG_URL, 'FACTORY_TEST_PG_URL is not set')
class PostgresMigrationTests(MigrationCases, unittest.TestCase):
    def blank_engine(self):
        engine = create_engine(PG_URL)
        self.addCleanup(engine.dispose)
        with engine.begin() as conn:
            conn.exec_driver_sql('DROP SCHEMA public CASCADE')
            conn.exec_driver_sql('CREATE SCHEMA public')
        return engine


if __name__ == '__main__':
    unittest.main()
