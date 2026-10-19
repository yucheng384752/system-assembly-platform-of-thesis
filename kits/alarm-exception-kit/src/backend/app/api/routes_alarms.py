"""報警查詢／確認，與關鍵量測異常簽核。

事件與閘門的註冊在 `register()`（見 core），本檔只有 HTTP 端點。
批次可見性（產線範圍、唯讀角色）一律走 batch_read.get_visible_batch。
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_entry_point, require_password_changed, require_write_access
from app.core.alarm_service import UNRESOLVED
from app.core.alarm_settings import get_settings
from app.core.batch_read import batch_labels, current_measurement, get_visible_batch, visible_batch_ids
from app.core.database import get_db
from app.core.entry_points_registration import ALARM_MANAGE, EXCEPTION_DECIDE
from app.core.events import BatchChanged, bus
from app.core.exception_gate import DecisionError, validate_decision
from app.core.exception_service import gating_spec, latest_request
from app.core.gates import BatchContext
from app.core.rules import evaluate_spec_range
from app.models.alarm import Alarm
from app.models.exception_request import ExceptionRequest
from app.models.user import User
from app.schemas.alarm import AlarmRead, ExceptionCreate, ExceptionDecision, ExceptionRead

router = APIRouter(tags=["alarms"])


def _ctx(db: Session, batch) -> BatchContext:
    return BatchContext(db, batch.id, batch.product_line_code, batch.product_model_code, batch.equipment_ref, batch.status)


@router.get("/alarms", response_model=list[AlarmRead])
def list_alarms(status_filter: str | None = None, batch_id: int | None = None, limit: int = 200,
                actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[AlarmRead]:
    q = select(Alarm).order_by(Alarm.id.desc()).limit(min(max(limit, 1), 500))
    if status_filter == "unresolved":
        q = q.where(Alarm.status.in_(UNRESOLVED))
    elif status_filter:
        q = q.where(Alarm.status == status_filter)
    if batch_id is not None:
        get_visible_batch(db, batch_id, actor)
        q = q.where(Alarm.batch_id == batch_id)
    rows = list(db.scalars(q))
    labels = batch_labels(db, {a.batch_id for a in rows})
    out = []
    for a in rows:
        item = AlarmRead.model_validate(a)
        item.batch_label = labels.get(a.batch_id)
        out.append(item)
    return _filter_visible(db, actor, out)


def _filter_visible(db: Session, actor: User, items: list[AlarmRead]) -> list[AlarmRead]:
    """逐批次套用可見性（產線範圍、唯讀角色），避免清單洩漏看不到的批次。"""
    ok = visible_batch_ids(db, actor, {i.batch_id for i in items})
    return [i for i in items if i.batch_id in ok]


@router.post("/alarms/{alarm_id}/acknowledge", response_model=AlarmRead)
def acknowledge(alarm_id: int, actor: User = Depends(require_entry_point(ALARM_MANAGE)), db: Session = Depends(get_db)) -> AlarmRead:
    alarm = db.get(Alarm, alarm_id)
    if alarm is None:
        raise HTTPException(404, "報警不存在")
    get_visible_batch(db, alarm.batch_id, actor)
    if alarm.status != "active":
        raise HTTPException(409, "報警已確認或已解除")
    alarm.status, alarm.acknowledged_by, alarm.acknowledged_at = "acknowledged", actor.id, datetime.now(timezone.utc)
    bus.publish(db, BatchChanged(alarm.batch_id, "alarm_acknowledged", actor.id))
    db.commit()
    return AlarmRead.model_validate(alarm)


@router.get("/batches/{batch_id}/exception-requests", response_model=list[ExceptionRead])
def list_requests(batch_id: int, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[ExceptionRequest]:
    get_visible_batch(db, batch_id, actor)
    return list(db.scalars(select(ExceptionRequest).where(ExceptionRequest.batch_id == batch_id).order_by(ExceptionRequest.id)))


@router.post("/batches/{batch_id}/exception-requests", response_model=ExceptionRead, status_code=201)
def create_request(batch_id: int, body: ExceptionCreate, actor: User = Depends(require_write_access), db: Session = Depends(get_db)) -> ExceptionRequest:
    g = get_settings().gating
    if g is None:
        raise HTTPException(404, "未啟用異常簽核")
    batch = get_visible_batch(db, batch_id, actor)
    if batch.status == "completed":
        raise HTTPException(409, "已完成批次不可申請")
    cur = current_measurement(db, batch.id, g.station_code, g.metric_key)
    if cur is None:
        raise HTTPException(409, "尚無關鍵量測值")
    low, high = gating_spec(db, _ctx(db, batch), g)
    if evaluate_spec_range("", None, cur[1], low, high).state != "violated":
        raise HTTPException(409, "關鍵量測未超出規格，不需申請")
    last = latest_request(db, batch.id, g)
    if last is not None and last.status == "pending":
        raise HTTPException(409, "已有待簽核的申請")
    req = ExceptionRequest(batch_id=batch.id, station_code=g.station_code, metric_key=g.metric_key,
                           measured_value=None if cur[1] is None else float(cur[1]), reason=body.reason, requested_by=actor.id)
    db.add(req)
    db.flush()
    bus.publish(db, BatchChanged(batch.id, "exception_requested", actor.id))
    db.commit()
    return req


@router.post("/exception-requests/{request_id}/decision", response_model=ExceptionRead)
def decide(request_id: int, body: ExceptionDecision, actor: User = Depends(require_entry_point(EXCEPTION_DECIDE)), db: Session = Depends(get_db)) -> ExceptionRequest:
    req = db.get(ExceptionRequest, request_id)
    if req is None:
        raise HTTPException(404, "申請不存在")
    get_visible_batch(db, req.batch_id, actor)
    if req.status != "pending":
        raise HTTPException(409, "此申請已簽核")
    try:
        validate_decision(body.status, body.verification_passed)
    except DecisionError as e:
        raise HTTPException(422, str(e)) from e
    req.status, req.decided_by, req.decided_at = body.status, actor.id, datetime.now(timezone.utc)
    req.verification_passed, req.decision_comment = body.verification_passed, body.comment
    bus.publish(db, BatchChanged(req.batch_id, "exception_decided", actor.id))
    db.commit()
    return req
