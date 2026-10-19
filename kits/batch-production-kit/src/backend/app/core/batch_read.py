"""供其他 Kit 在同一程序內讀取批次資料的唯讀介面。

其他 Kit 不應直接匯入本 Kit 的資料表模型；它們呼叫這裡的函式。可見性規則
（軟刪除、唯讀角色只看已完成、產線範圍外）集中在 `get_visible_batch`，
本 Kit 自己的端點與其他 Kit 的端點用同一份，不會出現一邊擋、一邊漏的情況。
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.roles import READ_ONLY_ROLES
from app.core.user_scopes import scoped_keys
from app.models.batch import Batch
from app.models.measurement import Measurement
from app.models.user import User

PRODUCT_LINE_SCOPE = "product-line"  # 由 product-process-kit 註冊的範圍類型


@dataclass(frozen=True)
class BatchSnapshot:
    id: int
    status: str
    lot_no: str
    product_line_code: str
    product_model_code: str
    equipment_ref: str | None


async def get_visible_batch(db: AsyncSession, batch_id: int, actor: User) -> Batch:
    """軟刪除、唯讀角色看未完成批次、產線範圍外，一律視為不存在（404），不洩漏存在與否。"""
    batch = await db.get(Batch, batch_id)
    if batch is None or batch.deleted_at is not None:
        raise HTTPException(status_code=404, detail="批號不存在")
    if actor.role in READ_ONLY_ROLES and batch.status != "completed":
        raise HTTPException(status_code=404, detail="批號不存在")
    allowed = await scoped_keys(actor, PRODUCT_LINE_SCOPE, db)
    if allowed is not None and batch.product_line_code not in allowed:
        raise HTTPException(status_code=404, detail="批號不存在")
    return batch


async def get_snapshot(db: AsyncSession, batch_id: int) -> BatchSnapshot | None:
    b = await db.get(Batch, batch_id)
    if b is None:
        return None
    return BatchSnapshot(b.id, b.status, b.lot_no, b.product_line_code, b.product_model_code, b.equipment_ref)


async def batch_labels(db: AsyncSession, batch_ids: set[int]) -> dict[int, str]:
    """批次編號 → 批號，供清單類畫面一次補齊，避免逐列查詢。"""
    if not batch_ids:
        return {}
    return {i: lot for i, lot in await db.execute(select(Batch.id, Batch.lot_no).where(Batch.id.in_(batch_ids)))}


async def latest_values(db: AsyncSession, batch_id: int, station_code: str, keys: list[str]) -> dict[str, Decimal | None]:
    """同一站點指定項目目前的數值（未填為 None）；跨欄位規則使用。"""
    rows = await db.execute(select(Measurement.metric_key, Measurement.value_num).where(
        Measurement.batch_id == batch_id, Measurement.station_code == station_code,
        Measurement.metric_key.in_(keys), Measurement.step_seq == 0))
    found = {k: (None if v is None else Decimal(str(v))) for k, v in rows}
    return {k: found.get(k) for k in keys}


async def current_measurement(db: AsyncSession, batch_id: int, station_code: str, metric_key: str) -> tuple[int, Decimal | None] | None:
    row = (await db.execute(select(Measurement.id, Measurement.value_num).where(
        Measurement.batch_id == batch_id, Measurement.station_code == station_code,
        Measurement.metric_key == metric_key, Measurement.step_seq == 0))).first()
    if row is None:
        return None
    return row[0], (None if row[1] is None else Decimal(str(row[1])))


# ---- 搜尋、計數、追溯（儀表板等唯讀使用者）----
@dataclass(frozen=True)
class BatchSummary:
    id: int
    lot_no: str
    status: str
    product_line_code: str
    product_model_code: str
    equipment_ref: str | None
    created_at: datetime
    finished_at: datetime | None


@dataclass(frozen=True)
class TraceCell:
    station_code: str
    metric_key: str
    step_seq: int
    value_num: Decimal | None
    value_text: str | None
    value_bool: bool | None
    operator_id: int
    recorded_at: datetime


async def _visible_batches(db: AsyncSession, actor: User):
    """帳號看得到的批次：未刪除；唯讀角色只看已完成；產線範圍內。與 get_visible_batch 同一套規則。"""
    q = select(Batch).where(Batch.deleted_at.is_(None))
    if actor.role in READ_ONLY_ROLES:
        q = q.where(Batch.status == "completed")
    allowed = await scoped_keys(actor, PRODUCT_LINE_SCOPE, db)
    if allowed is not None:
        q = q.where(Batch.product_line_code.in_(allowed))
    return q


async def search_batches(db: AsyncSession, actor: User, *, lot_prefix: str | None = None, status: str | None = None,
                   product_line_code: str | None = None, created_from: datetime | None = None,
                   created_to: datetime | None = None, limit: int = 100) -> list[BatchSummary]:
    q = await _visible_batches(db, actor)
    if lot_prefix:
        q = q.where(Batch.lot_no.startswith(lot_prefix, autoescape=True))
    if status:
        q = q.where(Batch.status == status)
    if product_line_code:
        q = q.where(Batch.product_line_code == product_line_code)
    if created_from:
        q = q.where(Batch.created_at >= created_from)
    if created_to:
        q = q.where(Batch.created_at < created_to)
    rows = await db.scalars(q.order_by(Batch.id.desc()).limit(min(max(limit, 1), 500)))
    return [BatchSummary(b.id, b.lot_no, b.status, b.product_line_code, b.product_model_code, b.equipment_ref, b.created_at, b.finished_at) for b in rows]


async def batch_counts(db: AsyncSession, actor: User) -> dict[str, int]:
    visible = (await _visible_batches(db, actor)).subquery()
    rows = await db.execute(select(visible.c.status, func.count()).group_by(visible.c.status))
    return {status: n for status, n in rows}


async def visible_batch_ids(db: AsyncSession, actor: User, batch_ids: set[int]) -> set[int]:
    """從給定編號中挑出帳號看得到的；清單類畫面一次過濾，不逐筆查。"""
    if not batch_ids:
        return set()
    return set(await db.scalars((await _visible_batches(db, actor)).where(Batch.id.in_(batch_ids)).with_only_columns(Batch.id)))


async def batch_trace(db: AsyncSession, batch_id: int, actor: User) -> list[TraceCell]:
    await get_visible_batch(db, batch_id, actor)
    rows = await db.scalars(select(Measurement).where(Measurement.batch_id == batch_id).order_by(Measurement.recorded_at, Measurement.id))
    return [TraceCell(m.station_code, m.metric_key, m.step_seq, None if m.value_num is None else Decimal(str(m.value_num)),
                      m.value_text, m.value_bool, m.operator_id, m.recorded_at) for m in rows]
