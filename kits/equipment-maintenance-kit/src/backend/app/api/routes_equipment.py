"""設備、點檢表、點檢紀錄、複核、維修與月度匯出。

可見性：設備若綁定產線，帳號的產線範圍外一律視為不存在（404）；共用設備（無產線）人人可見。
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_entry_point, require_password_changed, require_write_access
from app.core.check_rules import CheckError, can_resubmit, evaluate, validate_review
from app.core.database import get_db
from app.core.entry_points_registration import EQUIPMENT_MANAGE, EQUIPMENT_REVIEW, REPAIR_CLOSE
from app.core.equipment_service import PRODUCT_LINE_SCOPE, facts_for, find_equipment, item_defs, today
from app.core.equipment_settings import get_settings
from app.core.export_csv import to_csv
from app.core.gate_rules import blocker
from app.core.periods import FREQUENCIES, period_key, valid_month
from app.core.user_scopes import scoped_keys
from app.models.equipment import CheckRecord, ChecklistItem, Equipment, Repair
from app.models.user import User
from app.schemas.equipment import (
    CheckRead, CheckSubmit, ChecklistItemRead, ChecklistItemWrite, EquipmentRead, EquipmentStatus, EquipmentUpdate,
    EquipmentWrite, RepairClose, RepairCreate, RepairRead,
)

router = APIRouter(prefix="/equipment", tags=["equipment"])
repairs_router = APIRouter(tags=["equipment"])
checks_router = APIRouter(tags=["equipment"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _visible(db: Session, actor: User, eq: Equipment | None) -> Equipment:
    if eq is None:
        raise HTTPException(404, "設備不存在")
    if eq.product_line_code is not None:
        allowed = scoped_keys(actor, PRODUCT_LINE_SCOPE, db)
        if allowed is not None and eq.product_line_code not in allowed:
            raise HTTPException(404, "設備不存在")
    return eq


def _get(db: Session, actor: User, code: str) -> Equipment:
    return _visible(db, actor, find_equipment(db, code))


def _status(db: Session, eq: Equipment) -> EquipmentStatus:
    s = get_settings()
    facts = facts_for(db, eq)
    return EquipmentStatus(**EquipmentRead.model_validate(eq).model_dump(), open_repair=facts.open_repair,
                           checks={f: facts.checks[f].status if f in facts.checks else "missing" for f in FREQUENCIES},
                           abnormal=[f for f, c in facts.checks.items() if c.abnormal],
                           blocker=blocker(facts, s.required_frequencies, s.require_review, s.block_on_abnormal))


@router.get("", response_model=list[EquipmentStatus])
def list_equipment(include_inactive: bool = False, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[EquipmentStatus]:
    q = select(Equipment).order_by(Equipment.code)
    if not include_inactive:
        q = q.where(Equipment.active.is_(True))
    out = []
    for eq in db.scalars(q):
        try:
            out.append(_status(db, _visible(db, actor, eq)))
        except HTTPException:
            continue
    return out


@router.post("", response_model=EquipmentRead, status_code=201)
def create_equipment(body: EquipmentWrite, actor: User = Depends(require_entry_point(EQUIPMENT_MANAGE)), db: Session = Depends(get_db)) -> Equipment:
    eq = Equipment(**body.model_dump())
    db.add(eq)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "設備代碼已存在") from exc
    db.commit()
    return eq


# 固定路徑要放在 /{code} 之前，避免被當成設備代碼。
@router.get("/export")
def export_month(month: str, actor: User = Depends(require_entry_point(EQUIPMENT_MANAGE)), db: Session = Depends(get_db)) -> Response:
    if not valid_month(month):
        raise HTTPException(422, "month 格式為 YYYY-MM")
    names = {e.code: e.name for e in db.scalars(select(Equipment))}
    recs = list(db.scalars(select(CheckRecord).where(CheckRecord.period_key.like(f"{month}%")).order_by(CheckRecord.equipment_code, CheckRecord.frequency, CheckRecord.period_key)))
    rows = [[r.equipment_code, names.get(r.equipment_code, ""), r.frequency, r.period_key, r.status, r.performed_by, r.performed_at.isoformat(),
             r.reviewed_by or "", r.reviewed_at.isoformat() if r.reviewed_at else "", "；".join(r.abnormal), r.note or ""]
            for r in recs if _in_scope(db, actor, r.equipment_code)]
    return Response(to_csv(rows), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="equipment-checks-{month}.csv"'})


def _in_scope(db: Session, actor: User, code: str) -> bool:
    try:
        _get(db, actor, code)
        return True
    except HTTPException:
        return False


@router.get("/{code}", response_model=EquipmentStatus)
def get_equipment(code: str, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> EquipmentStatus:
    return _status(db, _get(db, actor, code))


@router.patch("/{code}", response_model=EquipmentRead)
def update_equipment(code: str, body: EquipmentUpdate, actor: User = Depends(require_entry_point(EQUIPMENT_MANAGE)), db: Session = Depends(get_db)) -> Equipment:
    eq = _get(db, actor, code)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(eq, field, value)
    db.commit()
    return eq


@router.get("/{code}/checklist", response_model=list[ChecklistItemRead])
def get_checklist(code: str, frequency: str | None = None, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[ChecklistItem]:
    _get(db, actor, code)
    q = select(ChecklistItem).where(ChecklistItem.equipment_code == code).order_by(ChecklistItem.frequency, ChecklistItem.sort, ChecklistItem.id)
    if frequency:
        q = q.where(ChecklistItem.frequency == frequency)
    return list(db.scalars(q))


@router.put("/{code}/checklist", response_model=list[ChecklistItemRead])
def replace_checklist(code: str, body: list[ChecklistItemWrite], actor: User = Depends(require_entry_point(EQUIPMENT_MANAGE)), db: Session = Depends(get_db)) -> list[ChecklistItem]:
    """整份取代。已送出的歷史紀錄保留當時的結果，不受影響。"""
    _get(db, actor, code)
    seen: set[tuple[str, str]] = set()
    for item in body:
        if item.frequency not in FREQUENCIES:
            raise HTTPException(422, f"frequency 必須是 {list(FREQUENCIES)}")
        if item.kind not in ("bool", "num"):
            raise HTTPException(422, "kind 必須是 bool 或 num")
        if item.low is not None and item.high is not None and item.low > item.high:
            raise HTTPException(422, f"{item.key}：下限不可大於上限")
        if (item.frequency, item.key) in seen:
            raise HTTPException(422, f"項目重複：{item.frequency}/{item.key}")
        seen.add((item.frequency, item.key))
    for old in db.scalars(select(ChecklistItem).where(ChecklistItem.equipment_code == code)):
        db.delete(old)
    db.flush()
    rows = [ChecklistItem(equipment_code=code, sort=i, **item.model_dump()) for i, item in enumerate(body)]
    db.add_all(rows)
    db.commit()
    return rows


@router.post("/{code}/checks", response_model=CheckRead)
def submit_check(code: str, body: CheckSubmit, actor: User = Depends(require_write_access), db: Session = Depends(get_db)) -> CheckRecord:
    eq = _get(db, actor, code)
    if not eq.active:
        raise HTTPException(409, "設備已停用")
    if body.frequency not in FREQUENCIES:
        raise HTTPException(422, f"frequency 必須是 {list(FREQUENCIES)}")
    items = item_defs(db, code, body.frequency)
    if not items:
        raise HTTPException(409, "此設備尚未設定該頻率的點檢表")
    try:
        ev = evaluate(items, body.results, body.note)
    except CheckError as exc:
        raise HTTPException(422, str(exc)) from exc
    key = period_key(body.frequency, today())
    rec = db.scalar(select(CheckRecord).where(CheckRecord.equipment_code == code, CheckRecord.frequency == body.frequency, CheckRecord.period_key == key))
    if rec is not None and not can_resubmit(rec.status):
        raise HTTPException(409, "本期點檢已複核，不可修改")
    if rec is None:
        rec = CheckRecord(equipment_code=code, frequency=body.frequency, period_key=key, performed_by=actor.id)
        db.add(rec)
    rec.results, rec.abnormal, rec.note = ev.normalized, list(ev.abnormal), body.note
    rec.status, rec.performed_by, rec.performed_at = "submitted", actor.id, _now()
    rec.reviewed_by = rec.reviewed_at = None
    db.commit()
    return rec


@router.get("/{code}/checks", response_model=list[CheckRead])
def list_checks(code: str, frequency: str | None = None, limit: int = 100, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[CheckRecord]:
    _get(db, actor, code)
    q = select(CheckRecord).where(CheckRecord.equipment_code == code).order_by(CheckRecord.id.desc()).limit(min(max(limit, 1), 500))
    if frequency:
        q = q.where(CheckRecord.frequency == frequency)
    return list(db.scalars(q))


@checks_router.post("/equipment-checks/{check_id}/review", response_model=CheckRead)
def review_check(check_id: int, actor: User = Depends(require_entry_point(EQUIPMENT_REVIEW)), db: Session = Depends(get_db)) -> CheckRecord:
    rec = db.get(CheckRecord, check_id)
    if rec is None:
        raise HTTPException(404, "點檢紀錄不存在")
    _get(db, actor, rec.equipment_code)
    try:
        validate_review(rec.performed_by, actor.id, rec.status, get_settings().reviewer_must_differ)
    except CheckError as exc:
        raise HTTPException(409, str(exc)) from exc
    rec.status, rec.reviewed_by, rec.reviewed_at = "reviewed", actor.id, _now()
    db.commit()
    return rec


@router.post("/{code}/repairs", response_model=RepairRead, status_code=201)
def report_repair(code: str, body: RepairCreate, actor: User = Depends(require_write_access), db: Session = Depends(get_db)) -> Repair:
    _get(db, actor, code)
    repair = Repair(equipment_code=code, description=body.description, reported_by=actor.id)
    db.add(repair)
    db.commit()
    return repair


@repairs_router.get("/equipment-repairs", response_model=list[RepairRead])
def list_repairs(status_filter: str | None = None, code: str | None = None, limit: int = 200, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[Repair]:
    q = select(Repair).order_by(Repair.id.desc()).limit(min(max(limit, 1), 500))
    if status_filter:
        q = q.where(Repair.status == status_filter)
    if code:
        q = q.where(Repair.equipment_code == code)
    return [r for r in db.scalars(q) if _in_scope(db, actor, r.equipment_code)]


@repairs_router.post("/equipment-repairs/{repair_id}/close", response_model=RepairRead)
def close_repair(repair_id: int, body: RepairClose, actor: User = Depends(require_entry_point(REPAIR_CLOSE)), db: Session = Depends(get_db)) -> Repair:
    repair = db.get(Repair, repair_id)
    if repair is None:
        raise HTTPException(404, "維修單不存在")
    _get(db, actor, repair.equipment_code)
    if repair.status != "open":
        raise HTTPException(409, "維修單已結案")
    repair.status, repair.closed_by, repair.closed_at, repair.resolution = "closed", actor.id, _now(), body.resolution
    db.commit()
    return repair


routers = [router, checks_router, repairs_router]
