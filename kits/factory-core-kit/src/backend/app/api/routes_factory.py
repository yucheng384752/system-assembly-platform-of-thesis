"""The factory routes (docs/executable-plan-contract.md, section 12).

Who may call which route is decided by the shared entry-permission middleware and permissions/entry_points.json, which is
assembled from kit.contract.json. These routes trust only the actor that middleware sets on the request and answer 401 without
it. In a system package this file is app/api/routes_factory.py; the database is the system's PostgreSQL (the async
DATABASE_URL, opened synchronously with psycopg) and the tables are created by the system init step, never at request time.
"""
import os
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.factory_api.deploy import deployed_environment, make_engine, open_state
from app.factory_api.support import (MAX_PLAN_BYTES, AcknowledgeBody, Actor, AlarmBody, DecisionBody, Environment, OrderBody, ProposeBody, _alarm,
                                 _decision, _order, _set, actor, guarded, utc_now)
from app.factory_core.alarms import AlarmService
from app.factory_core.workorder import FactoryState, WorkOrder


def build_router(get_state: Callable[[], FactoryState], *, environment: Callable[[], Environment], clock: Callable[[], str] = utc_now) -> APIRouter:
    """The 13 routes. `get_state` is called per request so a deployment can open its database lazily."""
    router = APIRouter()

    def plan_or_404(state: FactoryState, plan_id: str):
        received = state.store.get_plan(plan_id)
        if received is None:
            raise HTTPException(404, 'Unknown plan')
        return received

    def order_or_404(state: FactoryState, order_id: str) -> WorkOrder:
        order = state.store.get_order(order_id)
        if order is None:
            raise HTTPException(404, 'Unknown work order')
        return order

    @router.post('/api/factory/plans', status_code=201)
    @guarded
    async def receive_plan(request: Request, _: Actor = Depends(actor)):
        body = await request.body()
        if len(body) > MAX_PLAN_BYTES:
            return JSONResponse(status_code=413, content={'errors': [{'code': 'too-large', 'path': '/', 'message': f'a plan may be at most {MAX_PLAN_BYTES} bytes'}]})
        try:
            document = body.decode('utf-8')
        except UnicodeDecodeError:
            return JSONResponse(status_code=422, content={'errors': [{'code': 'broken-structure', 'path': '/', 'message': 'the plan must be UTF-8 text'}]})
        received = get_state().store_plan(document)
        return {'planId': received.plan_id, 'executable': received.executable, 'blockers': list(received.blockers)}

    @router.get('/api/factory/plans')
    @guarded
    def list_plans(_: Actor = Depends(actor)):
        return {'planIds': get_state().store.plan_ids()}

    @router.get('/api/factory/plans/{plan_id}')
    @guarded
    def get_plan(plan_id: str, _: Actor = Depends(actor)):
        received = plan_or_404(get_state(), plan_id)
        return {'planId': received.plan_id, 'executable': received.executable, 'blockers': list(received.blockers), 'plan': received.plan}

    @router.post('/api/factory/plans/{plan_id}/parameter-sets', status_code=201)
    @guarded
    def propose(plan_id: str, body: ProposeBody, who: Actor = Depends(actor)):
        record = get_state().params.propose(plan_id, values=body.values, tables=body.tables, alarm_intervals=body.alarmIntervals, source=body.source,
                                            source_sha256=body.sourceSha256, proposed_by=who.user_id, reason=body.reason, now=clock())
        return _set(record) | {'status': 'pending'}

    @router.get('/api/factory/plans/{plan_id}/parameter-sets')
    @guarded
    def list_sets(plan_id: str, _: Actor = Depends(actor)):
        state = get_state()
        plan_or_404(state, plan_id)
        items = []
        for record in state.params.history(plan_id):
            decision = state.params.decision(plan_id, record.set_version)
            items.append(_set(record) | {'status': decision.status if decision else 'pending', 'decision': _decision(decision) if decision else None})
        return {'parameterSets': items}

    @router.post('/api/factory/plans/{plan_id}/parameter-sets/{set_version}/decision')
    @guarded
    def decide(plan_id: str, set_version: int, body: DecisionBody, who: Actor = Depends(actor)):
        decision = get_state().params.decide(plan_id, set_version, approve=body.approve, by=who.user_id, role=who.role, now=clock(), note=body.note)
        return _decision(decision) | {'planId': plan_id, 'setVersion': set_version}

    @router.post('/api/factory/work-orders', status_code=201)
    @guarded
    def create_order(body: OrderBody, who: Actor = Depends(actor)):
        env = environment()
        order = get_state().create_order(body.orderId, body.planId, created_by=who.user_id, now=clock(), active_kits=set(env.active_kits),
                                         form_hashes=env.form_hashes, evaluator_commit=env.evaluator_commit)
        return _order(order)

    @router.post('/api/factory/work-orders/{order_id}/start')
    @guarded
    def start_order(order_id: str, _: Actor = Depends(actor)):
        state = get_state()
        order_or_404(state, order_id)
        return _order(state.start_order(order_id, now=clock()))

    @router.get('/api/factory/work-orders/{order_id}')
    @guarded
    def get_order(order_id: str, _: Actor = Depends(actor)):
        state = get_state()
        order = order_or_404(state, order_id)
        return _order(order) | {
            'effectiveParams': state.effective_params(order_id) if order.started else None,
            'heldNodes': sorted(AlarmService(state).held_nodes(order_id)),
        }

    @router.post('/api/factory/work-orders/{order_id}/alarms', status_code=201)
    @guarded
    def raise_alarm(order_id: str, body: AlarmBody, _: Actor = Depends(actor)):
        alarms = AlarmService(get_state())
        alarm = alarms.raise_alarm(order_id, body.ruleId, now=clock(), detail=body.detail)
        return _alarm(alarm, alarms.status(alarm.alarm_id))

    @router.get('/api/factory/alarms')
    @guarded
    def list_alarms(orderId: str | None = None, openOnly: bool = False, _: Actor = Depends(actor)):
        state = get_state()
        alarms = AlarmService(state)
        found = alarms.open_alarms(orderId) if openOnly else state.store.list_alarms(orderId)
        return {'alarms': [_alarm(a, alarms.status(a.alarm_id)) for a in found]}

    @router.post('/api/factory/alarms/{alarm_id}/acknowledge')
    @guarded
    def acknowledge(alarm_id: str, body: AcknowledgeBody, who: Actor = Depends(actor)):
        ack = AlarmService(get_state()).acknowledge(alarm_id, by=who.user_id, role=who.role, now=clock(), note=body.note)
        return {'alarmId': ack.alarm_id, 'acknowledgedBy': ack.acknowledged_by, 'acknowledgedAt': ack.acknowledged_at, 'status': 'acknowledged'}

    @router.post('/api/factory/alarms/reminders')
    @guarded
    def collect_reminders(_: Actor = Depends(actor)):
        return {'due': [_alarm(a, 'open') for a in AlarmService(get_state()).collect_due(clock())]}

    return router


# app/api/routes_factory.py -> /system (the package root that holds kits/ and permissions/)
PACKAGE_ROOT = Path(__file__).resolve().parents[3]


@lru_cache(maxsize=1)
def _state() -> FactoryState:
    return open_state(make_engine(os.environ["DATABASE_URL"]))


@lru_cache(maxsize=1)
def _environment() -> Environment:
    return deployed_environment(PACKAGE_ROOT)


router = build_router(_state, environment=_environment, clock=utc_now)
