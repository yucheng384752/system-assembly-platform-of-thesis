"""Storage boundary for the factory records (docs/data-model.md).

Every record type is append-only except the one start of a work order, so the interface offers no update or delete.
`MemoryStore` is the reference behavior; `SqlStore` (sql_store.py) must behave identically and runs the same tests.
"""
from __future__ import annotations

from collections.abc import Callable, Iterator, Mapping
from dataclasses import replace
from typing import Any


class AlreadyExists(Exception):
    """A record with this key is already stored; records are never replaced."""


class StoreView(Mapping):
    """Read-only mapping over a store lookup, so callers can index plans and orders like dictionaries."""

    def __init__(self, get: Callable[[str], Any], keys: Callable[[], list[str]]):
        self._get, self._keys = get, keys

    def __getitem__(self, key: str) -> Any:
        value = self._get(key)
        if value is None:
            raise KeyError(key)
        return value

    def __iter__(self) -> Iterator[str]:
        return iter(self._keys())

    def __len__(self) -> int:
        return len(self._keys())


class MemoryStore:
    def __init__(self) -> None:
        self._plans: dict[str, Any] = {}
        self._forms: dict[str, Any] = {}
        self._sets: dict[str, list[Any]] = {}
        self._decisions: dict[tuple[str, int], Any] = {}
        self._orders: dict[str, Any] = {}
        self._alarms: dict[str, Any] = {}
        self._acks: dict[str, Any] = {}
        self._notices: dict[str, list[str]] = {}

    # plans (content addressed: the same id always means the same content)
    def save_plan(self, received: Any) -> None:
        self._plans.setdefault(received.plan_id, received)

    def get_plan(self, plan_id: str) -> Any | None:
        return self._plans.get(plan_id)

    def plan_ids(self) -> list[str]:
        return list(self._plans)

    # forms (content addressed like plans: the first upload of a content is the record)
    def save_form(self, record: Any) -> None:
        self._forms.setdefault(record.content_sha256, record)

    def get_form(self, content_sha256: str) -> Any | None:
        return self._forms.get(content_sha256)

    def has_form(self, form_id: str, content_sha256: str) -> bool:
        record = self._forms.get(content_sha256)
        return record is not None and record.form_id == form_id

    def form_hashes(self) -> list[str]:
        return list(self._forms)

    # parameter sets and their decisions
    def append_set(self, plan_id: str, make: Callable[[int], Any]) -> Any:
        history = self._sets.setdefault(plan_id, [])
        record = make(len(history) + 1)
        history.append(record)
        return record

    def get_set(self, plan_id: str, version: int) -> Any | None:
        history = self._sets.get(plan_id, [])
        return history[version - 1] if 1 <= version <= len(history) else None

    def list_sets(self, plan_id: str) -> list[Any]:
        return list(self._sets.get(plan_id, ()))

    def add_decision(self, decision: Any) -> None:
        key = (decision.plan_id, decision.set_version)
        if key in self._decisions:
            raise AlreadyExists(f'version {decision.set_version} is already decided')
        self._decisions[key] = decision

    def get_decision(self, plan_id: str, version: int) -> Any | None:
        return self._decisions.get((plan_id, version))

    # work orders
    def add_order(self, order: Any) -> None:
        if order.order_id in self._orders:
            raise AlreadyExists(f'work order {order.order_id} already exists')
        self._orders[order.order_id] = order

    def get_order(self, order_id: str) -> Any | None:
        return self._orders.get(order_id)

    def order_ids(self) -> list[str]:
        return list(self._orders)

    def start_order(self, order_id: str, *, started_at: str, set_version: int | None, using_defaults: bool) -> Any:
        """The only change an order ever receives, and only once."""
        order = self._orders[order_id]
        if order.started_at is not None:
            raise AlreadyExists(f'work order {order_id} is already started')
        self._orders[order_id] = replace(order, started_at=started_at, set_version=set_version, using_defaults=using_defaults)
        return self._orders[order_id]

    # alarms
    def last_alarm(self, order_id: str, rule_id: str) -> Any | None:
        found = [a for a in self._alarms.values() if a.order_id == order_id and a.rule_id == rule_id]
        return max(found, key=lambda a: a.episode, default=None)

    def add_alarm(self, alarm: Any) -> None:
        if alarm.alarm_id in self._alarms:
            raise AlreadyExists(f'alarm {alarm.alarm_id} already exists')
        self._alarms[alarm.alarm_id] = alarm
        self._notices[alarm.alarm_id] = []

    def get_alarm(self, alarm_id: str) -> Any | None:
        return self._alarms.get(alarm_id)

    def list_alarms(self, order_id: str | None = None) -> list[Any]:
        return [a for a in self._alarms.values() if order_id is None or a.order_id == order_id]

    def add_ack(self, ack: Any) -> None:
        if ack.alarm_id in self._acks:
            raise AlreadyExists(f'alarm {ack.alarm_id} is already acknowledged')
        self._acks[ack.alarm_id] = ack

    def get_ack(self, alarm_id: str) -> Any | None:
        return self._acks.get(alarm_id)

    def add_notice(self, alarm_id: str, sent_at: str) -> int:
        notices = self._notices[alarm_id]
        notices.append(sent_at)
        return len(notices)

    def notices(self, alarm_id: str) -> list[str]:
        return list(self._notices.get(alarm_id, ()))
