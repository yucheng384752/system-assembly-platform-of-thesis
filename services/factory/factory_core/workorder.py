"""Work orders pin an immutable plan at creation and a parameter set at start (contract 4.9 rule 2, section 6).

A work order stores ids only (planId, setVersion); it never copies or rewrites plan content, so a plan published
later cannot change an order that already exists.
"""
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from .forms import FormRecord, plan_forms, receive_form
from .params import ParameterSetService
from .plan import PlanRejected, ReceivedPlan, receive_plan, work_order_blockers
from .store import AlreadyExists, MemoryStore, StoreView


@dataclass(frozen=True)
class WorkOrder:
    order_id: str
    plan_id: str
    created_by: str
    created_at: str
    started_at: str | None = None
    set_version: int | None = None  # the approved parameter set pinned at start
    using_defaults: bool = False    # started with the plan's own defaults because no set was approved

    @property
    def started(self) -> bool:
        return self.started_at is not None


class _PlanDocuments(Mapping):
    """planId -> verified plan dict, read through the store so a persistent store needs no second copy."""

    def __init__(self, store):
        self._store = store

    def __getitem__(self, plan_id: str) -> dict:
        received = self._store.get_plan(plan_id)
        if received is None:
            raise KeyError(plan_id)
        return received.plan

    def __iter__(self):
        return iter(self._store.plan_ids())

    def __len__(self) -> int:
        return len(self._store.plan_ids())


class FactoryState:
    """Plans keyed by planId, a parameter service over them, and work orders, all on one store."""

    def __init__(self, store=None) -> None:
        self.store = store or MemoryStore()
        self.plans = StoreView(self.store.get_plan, self.store.plan_ids)
        self.orders = StoreView(self.store.get_order, self.store.order_ids)
        self.params = ParameterSetService(plans=_PlanDocuments(self.store), store=self.store)

    def store_plan(self, document: str | dict) -> ReceivedPlan:
        received = receive_plan(document)  # raises PlanRejected; nothing is stored on failure
        self.store.save_plan(received)
        return received

    def store_form(self, document: str | dict, *, uploaded_by: str, now: str) -> FormRecord:
        record = receive_form(document, uploaded_by=uploaded_by, uploaded_at=now)  # raises PlanRejected; nothing is stored on failure
        self.store.save_form(record)
        return self.store.get_form(record.content_sha256)  # the first upload's record when this content was already registered

    def create_order(self, order_id: str, plan_id: str, *, created_by: str, now: str, active_kits: set[str],
                     evaluator_commit: str | None) -> WorkOrder:
        received = self.store.get_plan(plan_id)
        if received is None:
            raise PlanRejected([{'code': 'unknown-plan', 'path': '/planId', 'message': f'plan {plan_id} is not stored'}])
        if self.store.get_order(order_id) is not None:
            raise PlanRejected([{'code': 'duplicate-order', 'path': '/orderId', 'message': f'work order {order_id} already exists'}])
        registered = {(form_id, sha) for form_id, sha in plan_forms(received.plan) if self.store.has_form(form_id, sha)}
        errors = work_order_blockers(received, active_kits=active_kits, registered_forms=registered, evaluator_commit=evaluator_commit)
        if errors:
            raise PlanRejected(errors)
        order = WorkOrder(order_id, plan_id, created_by, now)
        try:
            self.store.add_order(order)
        except AlreadyExists as error:  # a concurrent creation won
            raise PlanRejected([{'code': 'duplicate-order', 'path': '/orderId', 'message': str(error)}]) from error
        return order

    def start_order(self, order_id: str, *, now: str) -> WorkOrder:
        order = self.store.get_order(order_id)
        if order is None:
            raise KeyError(order_id)
        if order.started:
            return order  # already pinned; later approvals never reach a started order
        received = self.store.get_plan(order.plan_id)
        approved = self.params.latest_approved(order.plan_id)
        has_tunable = any(p['tunable'] for p in received.plan['params'])
        try:
            return self.store.start_order(order_id, started_at=now, set_version=approved.set_version if approved else None,
                                          using_defaults=approved is None and has_tunable)
        except AlreadyExists:  # a concurrent start won; its pin stands
            return self.store.get_order(order_id)

    def effective_params(self, order_id: str) -> dict:
        """Parameter values a started order runs with: the plan's defaults overlaid by its pinned set."""
        order = self.store.get_order(order_id)
        plan = self.store.get_plan(order.plan_id).plan
        values = {p['id']: p['default'] for p in plan['params'] if 'default' in p}
        if order.set_version is not None:
            values.update(self.params.get(order.plan_id, order.set_version).values)
        return values
