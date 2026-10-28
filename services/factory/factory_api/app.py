"""HTTP API of the factory core.

Who may call which route is decided before a request reaches this module, by the shared entry-permission middleware
and the directory assembled from kit.contract.json. This module therefore trusts only what that middleware sets on
the request (actor_user_id, actor_role) and fails closed with 401 when it is absent, so a deployment that forgot the
middleware exposes nothing. Identity and time never come from the request body: the actor is the authenticated user and
the clock is the server's. Plan content is read as raw text so its numbers keep the exact JavaScript reading that
planId was computed over.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from factory_core.alarms import Alarm, AlarmError, AlarmService
from factory_core.canonical import CanonicalError
from factory_core.params import Decision, ParameterSet, ParameterSetError
from factory_core.plan import PlanRejected
from factory_core.workorder import FactoryState, WorkOrder

PREFIX = '/api/factory'
MAX_PLAN_BYTES = 8 * 1024 * 1024
NOT_FOUND = ('unknown-plan', 'unknown-order', 'unknown-set', 'unknown-alarm', 'unknown-rule')
FORBIDDEN = ('same-person', 'role')
CONFLICT = ('already-decided', 'already-acknowledged', 'duplicate-order', 'not-started', 'not-executable', 'kit-not-active',
            'form-mismatch', 'evaluator-mismatch')


@dataclass(frozen=True)
class Actor:
    user_id: str
    role: str


@dataclass(frozen=True)
class Environment:
    """What this factory deployment actually has. Never taken from a request: a client must not assert its own kits."""
    active_kits: frozenset[str]
    form_hashes: dict[str, str]
    evaluator_commit: str | None


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class ProposeBody(Strict):
    values: dict[str, Any] = Field(default_factory=dict)
    tables: dict[str, Any] = Field(default_factory=dict)
    alarmIntervals: dict[str, Any] = Field(default_factory=dict)
    source: str = 'manual'
    sourceSha256: str | None = None
    reason: str


class DecisionBody(Strict):
    approve: bool
    note: str = ''


class OrderBody(Strict):
    orderId: str = Field(min_length=1, max_length=200)
    planId: str = Field(min_length=64, max_length=64)


class AlarmBody(Strict):
    ruleId: str = Field(min_length=1, max_length=200)
    detail: str = Field(default='', max_length=2000)


class AcknowledgeBody(Strict):
    note: str = Field(default='', max_length=2000)


def _set(r: ParameterSet) -> dict:
    return {'planId': r.plan_id, 'setVersion': r.set_version, 'contentSha256': r.content_sha256, 'values': r.values, 'tables': r.tables,
            'alarmIntervals': r.alarm_intervals, 'source': r.source, 'sourceSha256': r.source_sha256, 'proposedBy': r.proposed_by,
            'proposedAt': r.proposed_at, 'reason': r.reason}


def _decision(d: Decision) -> dict:
    return {'status': d.status, 'decidedBy': d.decided_by, 'decidedAt': d.decided_at, 'note': d.note}


def _order(o: WorkOrder) -> dict:
    return {'orderId': o.order_id, 'planId': o.plan_id, 'createdBy': o.created_by, 'createdAt': o.created_at, 'startedAt': o.started_at,
            'setVersion': o.set_version, 'usingDefaults': o.using_defaults}


def _alarm(a: Alarm, status: str) -> dict:
    return {'alarmId': a.alarm_id, 'orderId': a.order_id, 'ruleId': a.rule_id, 'nodeId': a.node_id, 'episode': a.episode,
            'raisedAt': a.raised_at, 'detail': a.detail, 'status': status}


def _status_for(errors: list[dict]) -> int:
    codes = {e['code'] for e in errors}
    if codes & set(NOT_FOUND):
        return 404
    if codes & set(FORBIDDEN):
        return 403
    if codes & set(CONFLICT):
        return 409
    return 422


def create_app(state: FactoryState, *, environment: Callable[[], Environment], clock: Callable[[], str] = utc_now) -> FastAPI:
    app = FastAPI(title='Factory core', docs_url=None, redoc_url=None, openapi_url=None)  # no public schema browser on a factory floor
    alarms = AlarmService(state)

    def actor(request: Request) -> Actor:
        user_id = getattr(request.state, 'actor_user_id', None)
        role = getattr(request.state, 'actor_role', None)
        if not user_id or not isinstance(role, str) or not role:
            raise HTTPException(401, 'Unauthorized')  # the entry-permission middleware did not run: refuse rather than guess
        return Actor(str(user_id), role)

    @app.exception_handler(PlanRejected)
    @app.exception_handler(ParameterSetError)
    @app.exception_handler(AlarmError)
    async def domain_error(_request: Request, error: Exception) -> JSONResponse:
        errors = error.errors  # type: ignore[attr-defined]
        return JSONResponse(status_code=_status_for(errors), content={'errors': errors})

    @app.exception_handler(CanonicalError)
    async def not_canonical(_request: Request, error: CanonicalError) -> JSONResponse:
        return JSONResponse(status_code=422, content={'errors': [{'code': 'not-canonical', 'path': '/', 'message': str(error)}]})

    def plan_or_404(plan_id: str):
        received = state.store.get_plan(plan_id)
        if received is None:
            raise HTTPException(404, 'Unknown plan')
        return received

    def order_or_404(order_id: str) -> WorkOrder:
        order = state.store.get_order(order_id)
        if order is None:
            raise HTTPException(404, 'Unknown work order')
        return order

    @app.post(PREFIX + '/plans', status_code=201)
    async def receive_plan(request: Request, _: Actor = Depends(actor)):
        body = await request.body()
        if len(body) > MAX_PLAN_BYTES:
            return JSONResponse(status_code=413, content={'errors': [{'code': 'too-large', 'path': '/', 'message': f'a plan may be at most {MAX_PLAN_BYTES} bytes'}]})
        try:
            document = body.decode('utf-8')
        except UnicodeDecodeError:
            return JSONResponse(status_code=422, content={'errors': [{'code': 'broken-structure', 'path': '/', 'message': 'the plan must be UTF-8 text'}]})
        received = state.store_plan(document)
        return {'planId': received.plan_id, 'executable': received.executable, 'blockers': list(received.blockers)}

    @app.get(PREFIX + '/plans')
    def list_plans(_: Actor = Depends(actor)):
        return {'planIds': state.store.plan_ids()}

    @app.get(PREFIX + '/plans/{plan_id}')
    def get_plan(plan_id: str, _: Actor = Depends(actor)):
        received = plan_or_404(plan_id)
        return {'planId': received.plan_id, 'executable': received.executable, 'blockers': list(received.blockers), 'plan': received.plan}

    @app.post(PREFIX + '/plans/{plan_id}/parameter-sets', status_code=201)
    def propose(plan_id: str, body: ProposeBody, who: Actor = Depends(actor)):
        record = state.params.propose(plan_id, values=body.values, tables=body.tables, alarm_intervals=body.alarmIntervals, source=body.source,
                                      source_sha256=body.sourceSha256, proposed_by=who.user_id, reason=body.reason, now=clock())
        return _set(record) | {'status': 'pending'}

    @app.get(PREFIX + '/plans/{plan_id}/parameter-sets')
    def list_sets(plan_id: str, _: Actor = Depends(actor)):
        plan_or_404(plan_id)
        items = []
        for record in state.params.history(plan_id):
            decision = state.params.decision(plan_id, record.set_version)
            items.append(_set(record) | {'status': decision.status if decision else 'pending', 'decision': _decision(decision) if decision else None})
        return {'parameterSets': items}

    @app.post(PREFIX + '/plans/{plan_id}/parameter-sets/{set_version}/decision')
    def decide(plan_id: str, set_version: int, body: DecisionBody, who: Actor = Depends(actor)):
        decision = state.params.decide(plan_id, set_version, approve=body.approve, by=who.user_id, role=who.role, now=clock(), note=body.note)
        return _decision(decision) | {'planId': plan_id, 'setVersion': set_version}

    @app.post(PREFIX + '/work-orders', status_code=201)
    def create_order(body: OrderBody, who: Actor = Depends(actor)):
        env = environment()
        order = state.create_order(body.orderId, body.planId, created_by=who.user_id, now=clock(), active_kits=set(env.active_kits),
                                   form_hashes=env.form_hashes, evaluator_commit=env.evaluator_commit)
        return _order(order)

    @app.post(PREFIX + '/work-orders/{order_id}/start')
    def start_order(order_id: str, _: Actor = Depends(actor)):
        order_or_404(order_id)
        return _order(state.start_order(order_id, now=clock()))

    @app.get(PREFIX + '/work-orders/{order_id}')
    def get_order(order_id: str, _: Actor = Depends(actor)):
        order = order_or_404(order_id)
        return _order(order) | {
            'effectiveParams': state.effective_params(order_id) if order.started else None,
            'heldNodes': sorted(alarms.held_nodes(order_id)),
        }

    @app.post(PREFIX + '/work-orders/{order_id}/alarms', status_code=201)
    def raise_alarm(order_id: str, body: AlarmBody, _: Actor = Depends(actor)):
        alarm = alarms.raise_alarm(order_id, body.ruleId, now=clock(), detail=body.detail)
        return _alarm(alarm, alarms.status(alarm.alarm_id))

    @app.get(PREFIX + '/alarms')
    def list_alarms(orderId: str | None = None, openOnly: bool = False, _: Actor = Depends(actor)):
        found = alarms.open_alarms(orderId) if openOnly else state.store.list_alarms(orderId)
        return {'alarms': [_alarm(a, alarms.status(a.alarm_id)) for a in found]}

    @app.post(PREFIX + '/alarms/{alarm_id}/acknowledge')
    def acknowledge(alarm_id: str, body: AcknowledgeBody, who: Actor = Depends(actor)):
        ack = alarms.acknowledge(alarm_id, by=who.user_id, role=who.role, now=clock(), note=body.note)
        return {'alarmId': ack.alarm_id, 'acknowledgedBy': ack.acknowledged_by, 'acknowledgedAt': ack.acknowledged_at, 'status': 'acknowledged'}

    @app.post(PREFIX + '/alarms/reminders')
    def collect_reminders(_: Actor = Depends(actor)):
        return {'due': [_alarm(a, 'open') for a in alarms.collect_due(clock())]}

    return app
