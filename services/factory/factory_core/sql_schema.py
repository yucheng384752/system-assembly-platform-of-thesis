"""Tables and append-only guards for the factory records (docs/data-model.md). Works on PostgreSQL and SQLite.

Times are stored as the ISO text the caller supplied and JSON as canonical text, never as jsonb: a number or key order
that a database normalizes would change the bytes a content hash was computed over.
"""
from __future__ import annotations

from sqlalchemy import (Boolean, CheckConstraint, Column, ForeignKey, ForeignKeyConstraint, Integer, MetaData, PrimaryKeyConstraint,
                        String, Table, Text, UniqueConstraint, event)
from sqlalchemy.engine import Connection, Engine

metadata = MetaData()

plans = Table(
    'plans', metadata,
    Column('plan_id', String(64), primary_key=True),
    Column('document', Text, nullable=False),  # canonical JSON; planId is its hash and is re-checked on every first read
    CheckConstraint('length(plan_id) = 64', name='plans_id_is_sha256'),
)

forms = Table(
    'forms', metadata,
    Column('content_sha256', String(64), primary_key=True),  # sha256 of the canonical definition; the same hash is the same content
    Column('form_id', String(200), nullable=False),
    Column('definition', Text, nullable=False),  # canonical JSON; the hash is re-checked on read
    Column('uploaded_by', Text, nullable=False),
    Column('uploaded_at', String(40), nullable=False),
    CheckConstraint('length(content_sha256) = 64', name='forms_hash_is_sha256'),
)

parameter_sets = Table(
    'parameter_sets', metadata,
    Column('plan_id', String(64), ForeignKey('plans.plan_id'), nullable=False),
    Column('set_version', Integer, nullable=False),
    Column('content_sha256', String(64), nullable=False),
    Column('values_json', Text, nullable=False),
    Column('tables_json', Text, nullable=False),
    Column('alarm_intervals_json', Text, nullable=False),
    Column('source', String(16), nullable=False),
    Column('source_sha256', String(64)),
    Column('proposed_by', Text, nullable=False),
    Column('proposed_at', String(40), nullable=False),
    Column('reason', Text, nullable=False),
    PrimaryKeyConstraint('plan_id', 'set_version'),
    CheckConstraint('set_version >= 1', name='parameter_sets_version_positive'),
    CheckConstraint("source IN ('manual', 'upload')", name='parameter_sets_source'),
)

parameter_decisions = Table(
    'parameter_decisions', metadata,
    Column('plan_id', String(64), nullable=False),
    Column('set_version', Integer, nullable=False),
    Column('status', String(16), nullable=False),
    Column('decided_by', Text, nullable=False),
    Column('decided_at', String(40), nullable=False),
    Column('note', Text, nullable=False),
    PrimaryKeyConstraint('plan_id', 'set_version'),  # one decision per version, ever
    ForeignKeyConstraint(['plan_id', 'set_version'], ['parameter_sets.plan_id', 'parameter_sets.set_version']),
    CheckConstraint("status IN ('approved', 'rejected')", name='parameter_decisions_status'),
)

work_orders = Table(
    'work_orders', metadata,
    Column('order_id', String(200), primary_key=True),
    Column('plan_id', String(64), ForeignKey('plans.plan_id'), nullable=False),
    Column('created_by', Text, nullable=False),
    Column('created_at', String(40), nullable=False),
    Column('started_at', String(40)),
    Column('set_version', Integer),
    Column('using_defaults', Boolean, nullable=False, server_default='0'),
    ForeignKeyConstraint(['plan_id', 'set_version'], ['parameter_sets.plan_id', 'parameter_sets.set_version']),
    CheckConstraint('started_at IS NOT NULL OR (set_version IS NULL AND using_defaults = false)', name='work_orders_pin_only_when_started'),
)

alarms = Table(
    'alarms', metadata,
    Column('alarm_id', String(600), primary_key=True),
    Column('order_id', String(200), ForeignKey('work_orders.order_id'), nullable=False),
    Column('rule_id', String(200), nullable=False),
    Column('node_id', String(400), nullable=False),
    Column('episode', Integer, nullable=False),
    Column('raised_at', String(40), nullable=False),
    Column('detail', Text, nullable=False),
    UniqueConstraint('order_id', 'rule_id', 'episode', name='alarms_one_per_episode'),
    CheckConstraint('episode >= 1', name='alarms_episode_positive'),
)

alarm_acks = Table(
    'alarm_acks', metadata,
    Column('alarm_id', String(600), ForeignKey('alarms.alarm_id'), primary_key=True),  # one acknowledgement per alarm
    Column('acknowledged_by', Text, nullable=False),
    Column('role', String(16), nullable=False),
    Column('acknowledged_at', String(40), nullable=False),
    Column('note', Text, nullable=False),
    CheckConstraint("role IN ('manager', 'admin')", name='alarm_acks_role'),
)

alarm_notices = Table(
    'alarm_notices', metadata,
    Column('alarm_id', String(600), ForeignKey('alarms.alarm_id'), nullable=False),
    Column('seq', Integer, nullable=False),
    Column('sent_at', String(40), nullable=False),
    PrimaryKeyConstraint('alarm_id', 'seq'),
)

APPEND_ONLY = ('plans', 'parameter_sets', 'parameter_decisions', 'alarms', 'alarm_acks', 'alarm_notices', 'forms')
ORDER_FIXED = ('order_id', 'plan_id', 'created_by', 'created_at')


def guard_statements(dialect: str, *, tables: tuple[str, ...] = APPEND_ONLY, shared: bool = True) -> list[str]:
    """DDL that makes the database itself refuse edits and deletes, whatever the application does.

    A migration passes the tables it creates; `shared` (the trigger functions and the work order guard) is installed once, by the
    first revision.
    """
    out: list[str] = []
    if dialect == 'postgresql':
        if shared:
            out.extend(_postgres_shared())
        for table in tables:
            out.append(f'CREATE TRIGGER {table}_append_only BEFORE UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION factory_append_only()')
            out.append(f'CREATE TRIGGER {table}_no_truncate BEFORE TRUNCATE ON {table} FOR EACH STATEMENT EXECUTE FUNCTION factory_append_only()')
        if shared:
            out.append('CREATE TRIGGER work_orders_guard BEFORE UPDATE OR DELETE ON work_orders FOR EACH ROW EXECUTE FUNCTION factory_order_guard()')
            out.append('CREATE TRIGGER work_orders_no_truncate BEFORE TRUNCATE ON work_orders FOR EACH STATEMENT EXECUTE FUNCTION factory_append_only()')
    elif dialect == 'sqlite':
        for table in tables:
            for op in ('UPDATE', 'DELETE'):
                out.append(f"CREATE TRIGGER {table}_no_{op.lower()} BEFORE {op} ON {table} BEGIN SELECT RAISE(ABORT, 'factory records are append-only'); END")
        if shared:
            out.append("CREATE TRIGGER work_orders_no_delete BEFORE DELETE ON work_orders BEGIN SELECT RAISE(ABORT, 'work orders are never deleted'); END")
            fixed = ' OR '.join(f'NEW.{c} IS NOT OLD.{c}' for c in ORDER_FIXED)
            out.append("CREATE TRIGGER work_orders_pinned BEFORE UPDATE ON work_orders WHEN OLD.started_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'a started work order is pinned and cannot change'); END")
            out.append(f"CREATE TRIGGER work_orders_fixed BEFORE UPDATE ON work_orders WHEN {fixed} BEGIN SELECT RAISE(ABORT, 'only the start of a work order may be written'); END")
    else:
        raise ValueError(f'no append-only guards are defined for {dialect}; refusing to run unguarded')
    return out


def _postgres_shared() -> list[str]:
    fixed = ' OR '.join(f'NEW.{c} IS DISTINCT FROM OLD.{c}' for c in ORDER_FIXED)
    return [
        """CREATE OR REPLACE FUNCTION factory_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING MESSAGE = 'factory records are append-only: ' || TG_OP || ' on ' || TG_TABLE_NAME; END $$""",
        f"""CREATE OR REPLACE FUNCTION factory_order_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'work orders are never deleted'; END IF;
  IF OLD.started_at IS NOT NULL THEN RAISE EXCEPTION 'a started work order is pinned and cannot change'; END IF;
  IF {fixed} THEN RAISE EXCEPTION 'only the start of a work order may be written'; END IF;
  RETURN NEW;
END $$""",
    ]


def install_guards(connection: Connection, *, tables: tuple[str, ...] = APPEND_ONLY, shared: bool = True) -> None:
    for statement in guard_statements(connection.dialect.name, tables=tables, shared=shared):
        connection.exec_driver_sql(statement)


def create_all(engine: Engine) -> None:
    """Tables and guards in one step, for tests and fresh installs; deployments use the Alembic migration."""
    metadata.create_all(engine)
    with engine.begin() as connection:
        install_guards(connection)


@event.listens_for(Engine, 'connect')
def _sqlite_foreign_keys(dbapi_connection, _record):
    if type(dbapi_connection).__module__.startswith('sqlite3'):
        dbapi_connection.execute('PRAGMA foreign_keys = ON')
