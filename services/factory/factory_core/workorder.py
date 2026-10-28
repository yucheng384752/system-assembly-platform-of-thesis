"""Work orders pin an immutable plan at creation and a parameter set at start (contract 4.9 rule 2, section 6).

A work order stores ids only (planId, setVersion); it never copies or rewrites plan content, so a plan published
later cannot change an order that already exists.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace

from .params import ParameterSetService
from .plan import PlanRejected, ReceivedPlan, receive_plan, work_order_blockers


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


@dataclass
class FactoryState:
    """In-memory reference store: plans keyed by planId, a parameter service over them, and work orders."""
    plans: dict[str, ReceivedPlan] = field(default_factory=dict)
    orders: dict[str, WorkOrder] = field(default_factory=dict)
    params: ParameterSetService = field(init=False)

    def __post_init__(self) -> None:
        self.params = ParameterSetService(plans={})

    def store_plan(self, document: str | dict) -> ReceivedPlan:
        received = receive_plan(document)  # raises PlanRejected; nothing is stored on failure
        self.plans[received.plan_id] = received
        self.params.plans[received.plan_id] = received.plan
        return received

    def create_order(self, order_id: str, plan_id: str, *, created_by: str, now: str, active_kits: set[str],
                     form_hashes: dict[str, str], evaluator_commit: str | None) -> WorkOrder:
        received = self.plans.get(plan_id)
        if received is None:
            raise PlanRejected([{'code': 'unknown-plan', 'path': '/planId', 'message': f'plan {plan_id} is not stored'}])
        if order_id in self.orders:
            raise PlanRejected([{'code': 'duplicate-order', 'path': '/orderId', 'message': f'work order {order_id} already exists'}])
        errors = work_order_blockers(received, active_kits=active_kits, form_hashes=form_hashes, evaluator_commit=evaluator_commit)
        if errors:
            raise PlanRejected(errors)
        order = WorkOrder(order_id, plan_id, created_by, now)
        self.orders[order_id] = order
        return order

    def start_order(self, order_id: str, *, now: str) -> WorkOrder:
        order = self.orders[order_id]
        if order.started:
            return order  # already pinned; later approvals never reach a started order
        received = self.plans[order.plan_id]
        approved = self.params.latest_approved(order.plan_id)
        has_tunable = any(p['tunable'] for p in received.plan['params'])
        started = replace(order, started_at=now, set_version=approved.set_version if approved else None,
                          using_defaults=approved is None and has_tunable)
        self.orders[order_id] = started
        return started

    def effective_params(self, order_id: str) -> dict:
        """Parameter values a started order runs with: the plan's defaults overlaid by its pinned set."""
        order = self.orders[order_id]
        plan = self.plans[order.plan_id].plan
        values = {p['id']: p['default'] for p in plan['params'] if 'default' in p}
        if order.set_version is not None:
            values.update(self.params.get(order.plan_id, order.set_version).values)
        return values
