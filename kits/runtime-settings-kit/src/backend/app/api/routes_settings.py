"""參數設定中心：列出有效值與來源、修改、還原、看變更紀錄、匯出。

改值的流程：參數存在 → 此角色可改 → 值合法（含場域範圍）→ 原因（依風險）→ 版本沒被別人改過 → 寫入並記錄 →
提交後才通知各 Kit 套用，因此資料庫寫入失敗不會讓 Kit 先套用到沒存下來的值。
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_entry_point, require_password_changed, require_write_access
from app.core.database import get_db
from app.core.entry_points_registration import SETTINGS_EXPORT
from app.core.layers import resolve
from app.core.param_defs import ParamDef, ParamError, check_value
from app.core.policy import PolicyError, can_edit, check_reason, check_version
from app.core.registry import registry
from app.core.runtime_config import get_config
from app.core.settings_service import all_rows, store, view
from app.models.runtime_setting import RuntimeSetting, SettingChange
from app.models.user import User
from app.schemas.settings import ChangeRead, SettingRead, SettingReset, SettingWrite

router = APIRouter(prefix="/settings", tags=["runtime-settings"])


def _defn(key: str) -> ParamDef:
    defn = registry.get(key)
    if defn is None:
        raise HTTPException(404, "參數不存在")
    return defn


def _row(db: Session, key: str) -> RuntimeSetting | None:
    return db.scalar(select(RuntimeSetting).where(RuntimeSetting.key == key))


def _announce(db: Session, defn: ParamDef) -> None:
    row = _row(db, defn.key)
    value, source = resolve(defn, row.value if row else None, get_config().site_locks.get(defn.key))
    registry.notify(defn.key, value, source)


@router.get("", response_model=list[SettingRead])
def list_settings(category: str | None = None, kit_id: str | None = None, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[dict]:
    rows = all_rows(db)
    return [view(d, rows.get(d.key), actor.role) for d in registry.all()
            if (category is None or d.category == category) and (kit_id is None or d.kit_id == kit_id)]


# 固定路徑放在 /{key} 之前。
@router.get("/export")
def export_values(actor: User = Depends(require_entry_point(SETTINGS_EXPORT)), db: Session = Depends(get_db)) -> dict:
    rows = all_rows(db)
    return {d.key: {"value": v["value"], "source": v["source"], "version": v["version"]}
            for d in registry.all() if d.kind == "value" for v in [view(d, rows.get(d.key), actor.role)]}


@router.get("/{key}", response_model=SettingRead)
def get_setting(key: str, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> dict:
    defn = _defn(key)
    return view(defn, _row(db, key), actor.role)


@router.put("/{key}", response_model=SettingRead)
def set_setting(key: str, body: SettingWrite, actor: User = Depends(require_write_access), db: Session = Depends(get_db)) -> dict:
    defn = _defn(key)
    lock = get_config().site_locks.get(key)
    ok, why = can_edit(defn, actor.role, lock)
    if not ok:
        raise HTTPException(403, why)
    try:
        value = check_value(defn, body.value, lock.min if lock else None, lock.max if lock else None)
        reason = check_reason(defn, body.reason, get_config().require_reason_from)
    except (ParamError, PolicyError) as exc:
        raise HTTPException(422, str(exc)) from exc
    row = _row(db, key)
    try:
        check_version(row.version if row else 0, body.expected_version)
    except PolicyError as exc:
        raise HTTPException(409, str(exc)) from exc
    new_stored, old_stored = store(value), (row.value if row else None)
    if row is not None and row.value == new_stored:
        return view(defn, row, actor.role)  # 沒有變動：不增加版本、不留紀錄
    now = datetime.now(timezone.utc)
    if row is None:
        row = RuntimeSetting(key=key, value=new_stored, version=1, updated_by=actor.id, updated_at=now)
        db.add(row)
    else:
        row.value, row.version, row.updated_by, row.updated_at = new_stored, row.version + 1, actor.id, now
    db.add(SettingChange(key=key, action="set", old_value=old_stored, new_value=new_stored, version=row.version, actor_id=actor.id, reason=reason))
    try:
        db.commit()
    except IntegrityError as exc:  # 兩人同時第一次設定同一個參數
        db.rollback()
        raise HTTPException(409, "這個參數剛被其他人修改，請重新載入後再改") from exc
    _announce(db, defn)
    return view(defn, row, actor.role)


@router.post("/{key}/reset", response_model=SettingRead)
def reset_setting(key: str, body: SettingReset, actor: User = Depends(require_write_access), db: Session = Depends(get_db)) -> dict:
    defn = _defn(key)
    ok, why = can_edit(defn, actor.role, get_config().site_locks.get(key))
    if not ok:
        raise HTTPException(403, why)
    try:
        reason = check_reason(defn, body.reason, get_config().require_reason_from)
    except PolicyError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = _row(db, key)
    if row is None or row.value is None:
        return view(defn, row, actor.role)  # 本來就沒有上線後調整的值
    try:
        check_version(row.version, body.expected_version)
    except PolicyError as exc:
        raise HTTPException(409, str(exc)) from exc
    # 保留資料列、只清掉值：版本號單調遞增，變更紀錄的版本不會重來。
    db.add(SettingChange(key=key, action="reset", old_value=row.value, new_value=None, version=row.version + 1, actor_id=actor.id, reason=reason))
    row.value, row.version, row.updated_by, row.updated_at = None, row.version + 1, actor.id, datetime.now(timezone.utc)
    db.commit()
    _announce(db, defn)
    return view(defn, row, actor.role)


@router.get("/{key}/history", response_model=list[ChangeRead])
def history(key: str, limit: int = 50, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[SettingChange]:
    _defn(key)
    return list(db.scalars(select(SettingChange).where(SettingChange.key == key).order_by(SettingChange.id.desc()).limit(min(max(limit, 1), 200))))
