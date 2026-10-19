"""有效值的讀寫（資料庫部分）。純判斷在 layers／policy／param_defs。"""

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.layers import SOURCE_LABELS, SiteLock, bounds, resolve
from app.core.param_defs import ParamDef, to_storage
from app.core.policy import can_edit
from app.core.registry import registry
from app.core.runtime_config import get_config
from app.models.runtime_setting import RuntimeSetting


def stored_value(defn: ParamDef, row: RuntimeSetting | None) -> Any:
    """資料庫存的是正規化後的值；數字存字串，讀回來交給 check_value 轉 Decimal。"""
    return None if row is None else row.value  # 還原後為 None


async def effective(db: AsyncSession, defn: ParamDef) -> tuple[Any, str]:
    row = await db.scalar(select(RuntimeSetting).where(RuntimeSetting.key == defn.key))
    return resolve(defn, stored_value(defn, row), get_config().site_locks.get(defn.key))


def view(defn: ParamDef, row: RuntimeSetting | None, role: str) -> dict:
    lock: SiteLock | None = get_config().site_locks.get(defn.key)
    value, source = resolve(defn, stored_value(defn, row), lock)
    low, high = bounds(defn, lock)
    ok, why = can_edit(defn, role, lock)
    show = lambda v: float(v) if hasattr(v, "is_finite") else v  # noqa: E731  Decimal 轉成 JSON 數字
    return dict(key=defn.key, kit_id=defn.kit_id, label=defn.label, category=defn.category, type=defn.type, unit=defn.unit,
                min=None if low is None else float(low), max=None if high is None else float(high), integer=defn.integer,
                choices=list(defn.choices), risk=defn.risk, kind=defn.kind, description=defn.description, impact=defn.impact,
                default=show(defn.default), value=show(value) if defn.kind == "value" else None, source=source,
                source_label=SOURCE_LABELS[source], version=row.version if row else 0, can_edit=ok, why_not=why)


async def all_rows(db: AsyncSession) -> dict[str, RuntimeSetting]:
    return {r.key: r for r in await db.scalars(select(RuntimeSetting))}


async def apply_all(db: AsyncSession) -> None:
    """把目前所有有效值通知各 Kit（啟動時，或定期重新載入時）。"""
    rows = await all_rows(db)
    for defn in registry.all():
        if defn.kind != "value":
            continue
        value, source = resolve(defn, stored_value(defn, rows.get(defn.key)), get_config().site_locks.get(defn.key))
        registry.notify(defn.key, value, source)


def store(value: Any) -> Any:
    return to_storage(value)
