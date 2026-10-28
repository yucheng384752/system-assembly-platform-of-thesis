"""Shared pieces of the factory HTTP routes: actor, environment, request bodies, serializers, error mapping.

Who may call which route is decided before a request reaches this module, by the shared entry-permission middleware
and the directory assembled from kit.contract.json. This module therefore trusts only what that middleware sets on
the request (actor_user_id, actor_role) and fails closed with 401 when it is absent, so a deployment that forgot the
middleware exposes nothing. Identity and time never come from the request body: the actor is the authenticated user and
the clock is the server's. Plan content is read as raw text so its numbers keep the exact JavaScript reading that
planId was computed over.
"""
from __future__ import annotations

from functools import wraps
import inspect
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.factory_core.alarms import Alarm, AlarmError
from app.factory_core.canonical import CanonicalError
from app.factory_core.params import Decision, ParameterSet, ParameterSetError
from app.factory_core.plan import PlanRejected
from app.factory_core.workorder import WorkOrder

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


def respond_to_domain_error(error: Exception) -> JSONResponse | None:
    """The response for an error the domain raises on purpose; None for anything else, which must stay a visible failure."""
    if isinstance(error, (PlanRejected, ParameterSetError, AlarmError)):
        return JSONResponse(status_code=_status_for(error.errors), content={'errors': error.errors})
    if isinstance(error, CanonicalError):
        return JSONResponse(status_code=422, content={'errors': [{'code': 'not-canonical', 'path': '/', 'message': str(error)}]})
    return None


DOMAIN_ERRORS = (PlanRejected, ParameterSetError, AlarmError, CanonicalError)


def guarded(handler):
    """Turn the domain's deliberate refusals into responses. An APIRouter cannot own exception handlers, and a router
    included in a larger application must not depend on that application registering them."""
    if inspect.iscoroutinefunction(handler):
        @wraps(handler)
        async def wrapper(*args, **kwargs):
            try:
                return await handler(*args, **kwargs)
            except DOMAIN_ERRORS as error:
                return respond_to_domain_error(error)
    else:
        @wraps(handler)
        def wrapper(*args, **kwargs):
            try:
                return handler(*args, **kwargs)
            except DOMAIN_ERRORS as error:
                return respond_to_domain_error(error)
    return wrapper


def actor(request: Request) -> Actor:
    user_id = getattr(request.state, 'actor_user_id', None)
    role = getattr(request.state, 'actor_role', None)
    if not user_id or not isinstance(role, str) or not role:
        raise HTTPException(401, 'Unauthorized')  # the entry-permission middleware did not run: refuse rather than guess
    return Actor(str(user_id), role)
