"""SQL implementation of the store (PostgreSQL in service, SQLite in tests). Same behavior as MemoryStore.

Reads never trust the database blindly: a plan is re-verified (schema, structure, planId) the first time it is read.
A plan whose stored bytes no longer hash to its id raises StoreCorrupt instead of being used.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy import func, insert, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError

from .alarms import Acknowledgement, Alarm
from .canonical import canonical_json, content_sha256, parse_json
from .forms import FormRecord
from .params import Decision, ParameterSet
from .plan import PlanRejected, ReceivedPlan, receive_plan
from .sql_schema import alarm_acks, alarm_notices, alarms, forms, parameter_decisions, parameter_sets, plans, work_orders
from .store import AlreadyExists
from .workorder import WorkOrder

RETRIES = 5


class StoreCorrupt(Exception):
    """What the database holds contradicts itself; nothing derived from it may be used."""


class SqlStore:
    def __init__(self, engine: Engine):
        self.engine = engine
        self._verified: dict[str, ReceivedPlan] = {}  # content addressed, so a verified plan never goes stale

    # plans
    def save_plan(self, received: ReceivedPlan) -> None:
        with self.engine.begin() as conn:
            if conn.execute(select(plans.c.plan_id).where(plans.c.plan_id == received.plan_id)).first() is None:
                conn.execute(insert(plans).values(plan_id=received.plan_id, document=canonical_json(received.plan)))
        self._verified[received.plan_id] = received

    def get_plan(self, plan_id: str) -> ReceivedPlan | None:
        if plan_id in self._verified:
            return self._verified[plan_id]
        with self.engine.connect() as conn:
            row = conn.execute(select(plans.c.document).where(plans.c.plan_id == plan_id)).first()
        if row is None:
            return None
        try:
            received = receive_plan(row[0])
        except PlanRejected as error:
            raise StoreCorrupt(f'stored plan {plan_id} no longer verifies: {error}') from error
        if received.plan_id != plan_id:
            raise StoreCorrupt(f'stored plan {plan_id} hashes to {received.plan_id}')
        self._verified[plan_id] = received
        return received

    def plan_ids(self) -> list[str]:
        with self.engine.connect() as conn:
            return [r[0] for r in conn.execute(select(plans.c.plan_id).order_by(plans.c.plan_id))]

    # forms
    def save_form(self, record: FormRecord) -> None:
        try:
            with self.engine.begin() as conn:
                if not self._exists(conn, forms, content_sha256=record.content_sha256):
                    conn.execute(insert(forms).values(content_sha256=record.content_sha256, form_id=record.form_id, definition=canonical_json(record.definition),
                                                      uploaded_by=record.uploaded_by, uploaded_at=record.uploaded_at))
        except IntegrityError:
            if self.get_form(record.content_sha256) is None:  # not a concurrent upload of the same content: a real failure
                raise

    def get_form(self, content_sha256_: str) -> FormRecord | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(forms).where(forms.c.content_sha256 == content_sha256_)).first()
        if row is None:
            return None
        definition = parse_json(row.definition)
        if content_sha256(definition) != row.content_sha256 or definition.get('id') != row.form_id:
            raise StoreCorrupt(f'stored form {row.content_sha256} no longer hashes to its key')
        return FormRecord(row.content_sha256, row.form_id, definition, row.uploaded_by, row.uploaded_at)

    def has_form(self, form_id: str, content_sha256_: str) -> bool:
        record = self.get_form(content_sha256_)
        return record is not None and record.form_id == form_id

    def form_hashes(self) -> list[str]:
        with self.engine.connect() as conn:
            return [r[0] for r in conn.execute(select(forms.c.content_sha256).order_by(forms.c.content_sha256))]

    # parameter sets
    @staticmethod
    def _set(row: Any) -> ParameterSet:
        return ParameterSet(row.plan_id, row.set_version, row.content_sha256, parse_json(row.values_json), parse_json(row.tables_json),
                            parse_json(row.alarm_intervals_json), row.source, row.source_sha256, row.proposed_by, row.proposed_at, row.reason)

    def append_set(self, plan_id: str, make: Callable[[int], ParameterSet]) -> ParameterSet:
        for _ in range(RETRIES):
            try:
                with self.engine.begin() as conn:
                    # Lock the plan row so concurrent proposers queue instead of colliding (a no-op on SQLite, which serializes writers).
                    conn.execute(select(plans.c.plan_id).where(plans.c.plan_id == plan_id).with_for_update()).first()
                    latest = conn.execute(select(func.max(parameter_sets.c.set_version)).where(parameter_sets.c.plan_id == plan_id)).scalar()
                    record = make((latest or 0) + 1)
                    conn.execute(insert(parameter_sets).values(
                        plan_id=record.plan_id, set_version=record.set_version, content_sha256=record.content_sha256,
                        values_json=canonical_json(record.values), tables_json=canonical_json(record.tables),
                        alarm_intervals_json=canonical_json(record.alarm_intervals), source=record.source,
                        source_sha256=record.source_sha256, proposed_by=record.proposed_by, proposed_at=record.proposed_at, reason=record.reason))
                return record
            except IntegrityError:
                if self.get_plan(plan_id) is None:
                    raise
        raise RuntimeError('could not assign a parameter set version after repeated conflicts')

    def get_set(self, plan_id: str, version: int) -> ParameterSet | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(parameter_sets).where(parameter_sets.c.plan_id == plan_id, parameter_sets.c.set_version == version)).first()
        return self._set(row) if row else None

    def list_sets(self, plan_id: str) -> list[ParameterSet]:
        with self.engine.connect() as conn:
            rows = conn.execute(select(parameter_sets).where(parameter_sets.c.plan_id == plan_id).order_by(parameter_sets.c.set_version))
            return [self._set(r) for r in rows]

    def add_decision(self, decision: Decision) -> None:
        self._insert(parameter_decisions, dict(plan_id=decision.plan_id, set_version=decision.set_version, status=decision.status,
                                                decided_by=decision.decided_by, decided_at=decision.decided_at, note=decision.note),
                     lambda conn: self._exists(conn, parameter_decisions, plan_id=decision.plan_id, set_version=decision.set_version),
                     f'version {decision.set_version} is already decided')

    def get_decision(self, plan_id: str, version: int) -> Decision | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(parameter_decisions).where(parameter_decisions.c.plan_id == plan_id, parameter_decisions.c.set_version == version)).first()
        return Decision(row.plan_id, row.set_version, row.status, row.decided_by, row.decided_at, row.note) if row else None

    # work orders
    @staticmethod
    def _order(row: Any) -> WorkOrder:
        return WorkOrder(row.order_id, row.plan_id, row.created_by, row.created_at, row.started_at, row.set_version, bool(row.using_defaults))

    def add_order(self, order: WorkOrder) -> None:
        self._insert(work_orders, dict(order_id=order.order_id, plan_id=order.plan_id, created_by=order.created_by, created_at=order.created_at,
                                       started_at=order.started_at, set_version=order.set_version, using_defaults=order.using_defaults),
                     lambda conn: self._exists(conn, work_orders, order_id=order.order_id), f'work order {order.order_id} already exists')

    def get_order(self, order_id: str) -> WorkOrder | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(work_orders).where(work_orders.c.order_id == order_id)).first()
        return self._order(row) if row else None

    def order_ids(self) -> list[str]:
        with self.engine.connect() as conn:
            return [r[0] for r in conn.execute(select(work_orders.c.order_id).order_by(work_orders.c.order_id))]

    def start_order(self, order_id: str, *, started_at: str, set_version: int | None, using_defaults: bool) -> WorkOrder:
        with self.engine.begin() as conn:
            done = conn.execute(update(work_orders).where(work_orders.c.order_id == order_id, work_orders.c.started_at.is_(None))
                                .values(started_at=started_at, set_version=set_version, using_defaults=using_defaults))
            if done.rowcount != 1:
                raise AlreadyExists(f'work order {order_id} is already started')
        return self.get_order(order_id)

    # alarms
    @staticmethod
    def _alarm(row: Any) -> Alarm:
        return Alarm(row.alarm_id, row.order_id, row.rule_id, row.node_id, row.episode, row.raised_at, row.detail)

    def last_alarm(self, order_id: str, rule_id: str) -> Alarm | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(alarms).where(alarms.c.order_id == order_id, alarms.c.rule_id == rule_id).order_by(alarms.c.episode.desc())).first()
        return self._alarm(row) if row else None

    def add_alarm(self, alarm: Alarm) -> None:
        self._insert(alarms, dict(alarm_id=alarm.alarm_id, order_id=alarm.order_id, rule_id=alarm.rule_id, node_id=alarm.node_id,
                                  episode=alarm.episode, raised_at=alarm.raised_at, detail=alarm.detail),
                     lambda conn: self._exists(conn, alarms, order_id=alarm.order_id, rule_id=alarm.rule_id, episode=alarm.episode),
                     f'alarm {alarm.alarm_id} already exists')

    def get_alarm(self, alarm_id: str) -> Alarm | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(alarms).where(alarms.c.alarm_id == alarm_id)).first()
        return self._alarm(row) if row else None

    def list_alarms(self, order_id: str | None = None) -> list[Alarm]:
        query = select(alarms).order_by(alarms.c.raised_at, alarms.c.alarm_id)
        if order_id is not None:
            query = query.where(alarms.c.order_id == order_id)
        with self.engine.connect() as conn:
            return [self._alarm(r) for r in conn.execute(query)]

    def add_ack(self, ack: Acknowledgement) -> None:
        self._insert(alarm_acks, dict(alarm_id=ack.alarm_id, acknowledged_by=ack.acknowledged_by, role=ack.role,
                                      acknowledged_at=ack.acknowledged_at, note=ack.note),
                     lambda conn: self._exists(conn, alarm_acks, alarm_id=ack.alarm_id), f'alarm {ack.alarm_id} is already acknowledged')

    def get_ack(self, alarm_id: str) -> Acknowledgement | None:
        with self.engine.connect() as conn:
            row = conn.execute(select(alarm_acks).where(alarm_acks.c.alarm_id == alarm_id)).first()
        return Acknowledgement(row.alarm_id, row.acknowledged_by, row.role, row.acknowledged_at, row.note) if row else None

    def add_notice(self, alarm_id: str, sent_at: str) -> int:
        for _ in range(RETRIES):
            try:
                with self.engine.begin() as conn:
                    conn.execute(select(alarms.c.alarm_id).where(alarms.c.alarm_id == alarm_id).with_for_update()).first()
                    seq = (conn.execute(select(func.max(alarm_notices.c.seq)).where(alarm_notices.c.alarm_id == alarm_id)).scalar() or 0) + 1
                    conn.execute(insert(alarm_notices).values(alarm_id=alarm_id, seq=seq, sent_at=sent_at))
                return seq
            except IntegrityError:
                if self.get_alarm(alarm_id) is None:
                    raise
        raise RuntimeError('could not number the notice after repeated conflicts')

    def notices(self, alarm_id: str) -> list[str]:
        with self.engine.connect() as conn:
            return [r[0] for r in conn.execute(select(alarm_notices.c.sent_at).where(alarm_notices.c.alarm_id == alarm_id).order_by(alarm_notices.c.seq))]

    # helpers
    @staticmethod
    def _exists(conn: Any, table: Any, **key: Any) -> bool:
        return conn.execute(select(1).select_from(table).where(*[table.c[k] == v for k, v in key.items()])).first() is not None

    def _insert(self, table: Any, row: dict, exists: Callable[[Any], bool], message: str) -> None:
        """Insert; a duplicate key becomes AlreadyExists, any other integrity failure (a missing parent, a CHECK) stays an error."""
        try:
            with self.engine.begin() as conn:
                conn.execute(insert(table).values(**row))
        except IntegrityError:
            with self.engine.connect() as conn:
                if exists(conn):
                    raise AlreadyExists(message) from None
            raise
