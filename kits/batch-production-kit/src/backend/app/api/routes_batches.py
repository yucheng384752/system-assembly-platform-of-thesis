"""批次生產核心：開單、派工、查詢、量測、用料、簽核、完成、刪除。

與其他 Kit 的接點只有三個（皆為機制，批次生產不認得對方）：
- 事件：量測寫入後發出 MeasurementRecorded，異動後發出 BatchChanged（app.core.events）。
- 閘門：寫入前、判斷進度、完成前詢問已註冊的閘門（app.core.gates）。
- 產品定義：只經由 product-process-kit 的查詢函式（app.core.model_lookup），不匯入其資料表。
"""

from datetime import date, datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_entry_point, require_password_changed, require_write_access
from app.core import extension_points
from app.core.batch_read import PRODUCT_LINE_SCOPE, get_visible_batch
from app.core.assignment import AssignmentError, validate_assignment
from app.core.batch_settings import get_settings
from app.core.completion import missing_before_completion
from app.core.database import get_db
from app.core.batch_entry_points import BATCH_DISPATCH, BATCH_MANAGE
from app.core.events import BatchChanged, MeasurementRecorded, bus
from app.core.gates import BatchContext, gates
from app.core.lot_number import counter_period, format_lot_no
from app.core.material_rules import MaterialRow, operator_may_write
from app.core.measurement_rules import MeasurementRuleError, check_filler_role, resolve_step
from app.core.model_lookup import StationInfo, find_model_id, get_model_snapshot, load_stations
from app.core.progress import MetricSpec, StationSpec, StepSpec, first_incomplete_station
from app.core.recipe import RecipeError, compute_theoretical
from app.core.roles import READ_ONLY_ROLES, Role
from app.core.user_scopes import scoped_keys
from app.models.batch import Batch
from app.models.batch_material import BatchMaterial
from app.models.lot_serial_counter import LotSerialCounter
from app.models.measurement import Measurement
from app.models.user import User
from app.schemas.batch import (
    BatchCreate, BatchDeleteRequest, BatchDetail, BatchHeaderUpdate, BatchRead, MaterialRead, MaterialWrite,
    MeasurementRead, MeasurementSubmit, SignRequest, SignResult,
)

router = APIRouter(prefix="/batches", tags=["batches"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _today() -> date:
    return datetime.now(ZoneInfo(get_settings().timezone)).date()


async def _changed(db: AsyncSession, batch_id: int, reason: str, actor_id: int | None = None) -> None:
    await bus.publish(db, BatchChanged(batch_id, reason, actor_id))


def _ctx(db: AsyncSession, batch: Batch) -> BatchContext:
    return BatchContext(db, batch.id, batch.product_line_code, batch.product_model_code, batch.equipment_ref, batch.status)


async def _get_active_batch(batch_id: int, db: AsyncSession, actor: User) -> Batch:
    return await get_visible_batch(db, batch_id, actor)


def _require_dispatched(batch: Batch) -> None:
    if batch.status == "not_started":
        raise HTTPException(status_code=409, detail="批號尚未派工，無法填寫")


def _specs(stations: list[StationInfo]) -> list[StationSpec]:
    return [StationSpec(s.code, s.name, s.sequence, tuple(MetricSpec(m.key, m.scope, m.required) for m in s.metrics),
                        tuple(StepSpec(st.seq, st.spec_text) for st in s.steps)) for s in stations]


async def _current_station(batch: Batch, db: AsyncSession, exclude: frozenset[str] = frozenset()) -> str | None:
    model_id = await _model_id_of(batch, db)
    stations = await load_stations(db, batch.product_line_code, model_id)
    rows = await db.execute(select(Measurement.station_code, Measurement.metric_key, Measurement.step_seq).where(Measurement.batch_id == batch.id))
    filled: dict[str, set[tuple[str, int]]] = {}
    for code, key, seq in rows:
        filled.setdefault(code, set()).add((key, seq))
    has_weight = await db.scalar(select(BatchMaterial.id).where(BatchMaterial.batch_id == batch.id, BatchMaterial.actual_qty.is_not(None))) is not None
    ctx = _ctx(db, batch)
    # 純函式 first_incomplete_station 收同步的 blocked 回呼：閘門是 async，先逐站問好再交給它。
    blocked_codes = {s.code for s in stations if await gates.station_blocked(ctx, s.code)}
    return first_incomplete_station(
        _specs(stations), {k: frozenset(v) for k, v in filled.items()}, exclude=exclude,
        material_station_codes=get_settings().material_station_codes, has_actual_weight=has_weight,
        blocked=lambda code: code in blocked_codes,
    )


async def _model_id_of(batch: Batch, db: AsyncSession) -> int | None:
    return await find_model_id(db, batch.product_line_code, batch.product_model_code)


async def _next_serial(db: AsyncSession, line_code: str, variant: str | None, period: str) -> int:
    key = dict(product_line_code=line_code, variant=variant or "", period=period)
    query = select(LotSerialCounter).filter_by(**key).with_for_update()
    counter = await db.scalar(query)
    if counter is None:
        db.add(LotSerialCounter(**key, current_serial=0))
        try:
            await db.flush()
        except IntegrityError:  # 同時第一次開單：另一個請求搶先建立，改鎖住它
            await db.rollback()
            counter = await db.scalar(query)
            if counter is None:
                raise
        else:
            counter = await db.scalar(query)
    counter.current_serial += 1
    return counter.current_serial


@router.post("", response_model=BatchRead, status_code=status.HTTP_201_CREATED)
async def open_batch(body: BatchCreate, actor: User = Depends(require_entry_point(BATCH_MANAGE)), db: AsyncSession = Depends(get_db)) -> Batch:
    cfg = get_settings()
    model = await get_model_snapshot(db, body.product_model_id)
    if model is None or not model.is_active:
        raise HTTPException(status_code=404, detail="型號不存在")
    allowed = await scoped_keys(actor, PRODUCT_LINE_SCOPE, db)
    if allowed is not None and model.product_line_code not in allowed:
        raise HTTPException(status_code=403, detail="不在可管理的產線範圍內")
    ids = (body.assigned_operator1_id, body.assigned_operator2_id, body.assigned_qc_id)
    if cfg.require_assignment or any(i is not None for i in ids):
        if any(i is None for i in ids):
            raise HTTPException(status_code=422, detail="需指派兩位操作員與一位品管")
        roles = {u.id: (u.role.value if hasattr(u.role, "value") else u.role) for u in await db.scalars(select(User).where(User.id.in_(set(ids))))}
        try:
            validate_assignment(roles, *ids)
        except AssignmentError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    today = _today()
    serial = await _next_serial(db, model.product_line_code, model.process_variant, counter_period(cfg.lot_format, today))
    lot_no = format_lot_no(cfg.lot_format, model.process_variant, today, serial)
    extra = dict(body.extra)
    for header_key, attr_key in cfg.header_prefill.items():
        if extra.get(header_key) is None and model.attributes.get(attr_key) is not None:
            extra[header_key] = model.attributes[attr_key]
    now = _now()
    batch = Batch(
        product_line_code=model.product_line_code, product_model_code=model.code, process_variant=model.process_variant,
        lot_no=lot_no, serial_no=serial, target_weight=body.target_weight, order_no=body.order_no, customer=body.customer,
        equipment_ref=body.equipment_ref, container_no=body.container_no, mfg_date=body.mfg_date,
        env_temp_c=body.env_temp_c, env_rh_pct=body.env_rh_pct,
        env_updated_at=now if body.env_temp_c is not None or body.env_rh_pct is not None else None,
        extra=extra, assigned_operator1_id=body.assigned_operator1_id, assigned_operator2_id=body.assigned_operator2_id,
        assigned_qc_id=body.assigned_qc_id, created_by=actor.id, started_at=now,
    )
    db.add(batch)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="批號產生衝突，請重試") from None
    if body.target_weight is not None:
        db.add(BatchMaterial(batch_id=batch.id, kind="total", theoretical_qty=body.target_weight))
        try:
            lines = compute_theoretical(list(model.recipe_lines), Decimal(str(body.target_weight)))
        except RecipeError as exc:
            raise HTTPException(status_code=422, detail=f"配方無法計算：{exc}") from exc
        for line in lines:
            db.add(BatchMaterial(batch_id=batch.id, kind=line.key, item_no=line.item_no, theoretical_qty=float(line.weight)))
    await _changed(db, batch.id, "created", actor.id)
    await db.commit()
    await db.refresh(batch)
    return batch


@router.post("/{batch_id}/dispatch", response_model=BatchRead)
async def dispatch_batch(batch_id: int, actor: User = Depends(require_entry_point(BATCH_DISPATCH)), db: AsyncSession = Depends(get_db)) -> Batch:
    batch = await _get_active_batch(batch_id, db, actor)
    if batch.status != "not_started":
        raise HTTPException(status_code=409, detail="批號不是未開工狀態")
    batch.status, batch.dispatched_by, batch.dispatched_at = "in_progress", actor.id, _now()
    await _changed(db, batch.id, "dispatched", actor.id)
    await db.commit()
    await db.refresh(batch)
    return batch


@router.get("", response_model=list[BatchRead])
async def list_batches(status_filter: str | None = None, limit: int = 200, actor: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[Batch]:
    query = select(Batch).where(Batch.deleted_at.is_(None)).order_by(Batch.id.desc()).limit(min(max(limit, 1), 500))
    if status_filter:
        query = query.where(Batch.status == status_filter)
    if actor.role in READ_ONLY_ROLES:
        query = query.where(Batch.status == "completed")
    allowed = await scoped_keys(actor, PRODUCT_LINE_SCOPE, db)
    if allowed is not None:
        query = query.where(Batch.product_line_code.in_(allowed))
    return list(await db.scalars(query))


@router.get("/{batch_id}", response_model=BatchDetail)
async def get_batch(batch_id: int, actor: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> BatchDetail:
    batch = await _get_active_batch(batch_id, db, actor)
    detail = BatchDetail.model_validate(batch)
    detail.current_station = await _current_station(batch, db)
    return detail


@router.patch("/{batch_id}", response_model=BatchRead)
async def update_header(batch_id: int, body: BatchHeaderUpdate, actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> Batch:
    """表頭欄位，不要求已派工（管理者可先備妥再派工）。已完成的批次不可修改。"""
    batch = await _get_active_batch(batch_id, db, actor)
    if batch.status == "completed":
        raise HTTPException(status_code=409, detail="已完成批次不可修改")
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(batch, field, value)
    if "env_temp_c" in data or "env_rh_pct" in data:
        batch.env_updated_at = _now()
    await _changed(db, batch.id, "header", actor.id)
    await db.commit()
    await db.refresh(batch)
    return batch


@router.delete("/{batch_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_batch(batch_id: int, body: BatchDeleteRequest, actor: User = Depends(require_entry_point(BATCH_MANAGE)), db: AsyncSession = Depends(get_db)) -> None:
    """軟刪除：從清單隱藏，量測與簽核紀錄保留。刪除原因交由訂閱 BatchChanged 的活動紀錄功能保存。"""
    batch = await _get_active_batch(batch_id, db, actor)
    batch.deleted_at = _now()
    await _changed(db, batch.id, f"deleted:{body.reason.strip()}", actor.id)
    await db.commit()


@router.post("/{batch_id}/measurements", response_model=MeasurementRead)
async def submit_measurement(batch_id: int, body: MeasurementSubmit, actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> Measurement:
    batch = await _get_active_batch(batch_id, db, actor)
    await db.scalar(select(Batch).where(Batch.id == batch_id).with_for_update())  # 同一批次的寫入排隊
    _require_dispatched(batch)
    if batch.status == "completed":
        raise HTTPException(status_code=409, detail="已完成批次不可修改")
    model_id = await _model_id_of(batch, db)
    stations = await load_stations(db, batch.product_line_code, model_id)
    station = next((s for s in stations if s.code == body.station_code), None)
    metric = next((m for m in station.metrics if m.key == body.metric_key), None) if station else None
    if station is None or metric is None:
        raise HTTPException(status_code=404, detail="欄位不存在")
    reason = await gates.write_blocker(_ctx(db, batch), station.code)
    if reason:
        raise HTTPException(status_code=409, detail=reason)
    reason = await gates.validate_value(_ctx(db, batch), station.code, metric.key, body.value_num, metric.spec_low, metric.spec_high)
    if reason:
        raise HTTPException(status_code=409, detail=reason)
    try:
        check_filler_role(metric.filler_role, actor.role.value if hasattr(actor.role, "value") else actor.role)
        step_seq = resolve_step(metric.scope, station.code, body.step_seq, {s.seq: station.code for s in station.steps})
    except MeasurementRuleError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    cell = dict(batch_id=batch_id, station_code=station.code, metric_key=metric.key, step_seq=step_seq)
    row = await db.scalar(select(Measurement).filter_by(**cell))
    if row is None:
        row = Measurement(**cell, operator_id=actor.id)
        db.add(row)
    row.operator_id, row.value_num, row.value_text = actor.id, body.value_num, body.value_text
    row.value_bool, row.is_done, row.recorded_at = body.value_bool, body.is_done, _now()
    await db.flush()
    await bus.publish(db, MeasurementRecorded(
        batch_id=batch_id, measurement_id=row.id, product_line_code=batch.product_line_code, product_model_code=batch.product_model_code,
        station_code=station.code, metric_key=metric.key, metric_label=metric.label, unit=metric.unit, step_seq=step_seq,
        value_num=None if body.value_num is None else Decimal(str(body.value_num)), value_text=body.value_text, value_bool=body.value_bool,
        spec_low=metric.spec_low, spec_high=metric.spec_high, operator_id=actor.id,
    ))
    await _changed(db, batch_id, "measurement", actor.id)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/{batch_id}/measurements", response_model=list[MeasurementRead])
async def list_measurements(batch_id: int, actor: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[Measurement]:
    await _get_active_batch(batch_id, db, actor)
    return list(await db.scalars(select(Measurement).where(Measurement.batch_id == batch_id).order_by(Measurement.id)))


@router.get("/{batch_id}/materials", response_model=list[MaterialRead])
async def list_materials(batch_id: int, actor: User = Depends(require_password_changed), db: AsyncSession = Depends(get_db)) -> list[BatchMaterial]:
    await _get_active_batch(batch_id, db, actor)
    return list(await db.scalars(select(BatchMaterial).where(BatchMaterial.batch_id == batch_id).order_by(BatchMaterial.id)))


@router.put("/{batch_id}/materials", response_model=list[MaterialRead])
async def replace_materials(batch_id: int, body: list[MaterialWrite], actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> list[BatchMaterial]:
    """整組取代。不要求已派工（管理者可在派工前備好理論用量與料號），但已完成的批次不可改。"""
    batch = await _get_active_batch(batch_id, db, actor)
    if batch.status == "completed":
        raise HTTPException(status_code=409, detail="已完成批次不可修改")
    reason = await gates.write_blocker(_ctx(db, batch), next(iter(get_settings().material_station_codes), ""))
    if reason:
        raise HTTPException(status_code=409, detail=reason)
    existing = list(await db.scalars(select(BatchMaterial).where(BatchMaterial.batch_id == batch_id).order_by(BatchMaterial.id)))
    if actor.role == Role.operator:
        old = [MaterialRow(r.kind, r.item_no, r.lot_no, r.supplier, None if r.theoretical_qty is None else Decimal(str(r.theoretical_qty))) for r in existing]
        new = [MaterialRow(r.kind, r.item_no, r.lot_no, r.supplier, None if r.theoretical_qty is None else Decimal(str(r.theoretical_qty))) for r in body]
        if not operator_may_write(old, new):
            raise HTTPException(status_code=403, detail="此欄位僅 manager 可填寫")
    await db.execute(delete(BatchMaterial).where(BatchMaterial.batch_id == batch_id))
    now = _now()
    db.add_all([BatchMaterial(batch_id=batch_id, updated_by=actor.id, updated_at=now, **m.model_dump()) for m in body])
    await _changed(db, batch_id, "materials", actor.id)
    await db.commit()
    return list(await db.scalars(select(BatchMaterial).where(BatchMaterial.batch_id == batch_id).order_by(BatchMaterial.id)))


@router.post("/{batch_id}/sign", response_model=SignResult)
async def sign_batch(batch_id: int, body: SignRequest, actor: User = Depends(require_write_access), db: AsyncSession = Depends(get_db)) -> SignResult:
    """一次性簽核，簽了不能取消。檢驗員欄位操作員不可簽；403 優先於 409。"""
    batch = await _get_active_batch(batch_id, db, actor)
    _require_dispatched(batch)
    if body.role == "inspector" and actor.role == Role.operator:
        raise HTTPException(status_code=403, detail="僅 manager/admin 可簽核檢驗員欄")
    if await _current_station(batch, db, get_settings().sign_exclude_stations) is not None:
        raise HTTPException(status_code=409, detail="尚未完成前一步驟製程，請確認填寫完畢")
    by_field, at_field, now = f"{body.role}_signed_by", f"{body.role}_signed_at", _now()
    result = await db.execute(update(Batch).where(Batch.id == batch_id, getattr(Batch, by_field).is_(None)).values(**{by_field: actor.id, at_field: now}))
    if result.rowcount == 0:
        await db.rollback()
        raise HTTPException(status_code=409, detail="此欄已簽核")
    await _changed(db, batch_id, f"signed:{body.role}", actor.id)
    await db.commit()
    return SignResult(role=body.role, signed_by=actor.id, signed_by_name=actor.display_name, signed_at=now)


async def completion_blockers(batch: Batch, db: AsyncSession) -> list[str]:
    """簽核與完成共用，兩個端點對「還缺什麼」不會說法不一。"""
    cfg = get_settings()
    extra = [reason for check in extension_points.completion_checks for reason in await check(db, batch.id)]
    return extra + missing_before_completion(
        operator_signed=batch.operator_signed_by is not None, inspector_signed=batch.inspector_signed_by is not None,
        incomplete_station=await _current_station(batch, db), gate_blockers=await gates.completion_blockers(_ctx(db, batch)),
        required_attachments=cfg.required_attachments, uploaded_attachment_keys=await extension_points.uploaded_attachment_keys(db, batch.id),
        require_warehouse_entry=extension_points.require_warehouse_entry, has_warehouse_entry=await extension_points.has_warehouse_entry(db, batch.id),
    )


@router.post("/{batch_id}/complete", response_model=BatchRead)
async def complete_batch(batch_id: int, actor: User = Depends(require_entry_point(BATCH_MANAGE)), db: AsyncSession = Depends(get_db)) -> Batch:
    batch = await _get_active_batch(batch_id, db, actor)
    if batch.status == "completed":
        raise HTTPException(status_code=409, detail="批號已完成")
    missing = await completion_blockers(batch, db)
    if missing:
        raise HTTPException(status_code=409, detail=f"尚未符合完成條件：{'、'.join(missing)}")
    batch.status, batch.finished_at, batch.completed_by = "completed", _now(), actor.id
    await _changed(db, batch.id, "completed", actor.id)
    await db.commit()
    await db.refresh(batch)
    return batch
