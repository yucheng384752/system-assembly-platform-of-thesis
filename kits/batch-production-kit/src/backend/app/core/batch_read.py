"""供其他 Kit 在同一程序內讀取批次資料的唯讀介面。

其他 Kit 不應直接匯入本 Kit 的資料表模型；它們呼叫這裡的函式。可見性規則
（軟刪除、唯讀角色只看已完成、產線範圍外）集中在 `get_visible_batch`，
本 Kit 自己的端點與其他 Kit 的端點用同一份，不會出現一邊擋、一邊漏的情況。
"""

from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

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


def get_visible_batch(db: Session, batch_id: int, actor: User) -> Batch:
    """軟刪除、唯讀角色看未完成批次、產線範圍外，一律視為不存在（404），不洩漏存在與否。"""
    batch = db.get(Batch, batch_id)
    if batch is None or batch.deleted_at is not None:
        raise HTTPException(status_code=404, detail="批號不存在")
    if actor.role in READ_ONLY_ROLES and batch.status != "completed":
        raise HTTPException(status_code=404, detail="批號不存在")
    allowed = scoped_keys(actor, PRODUCT_LINE_SCOPE, db)
    if allowed is not None and batch.product_line_code not in allowed:
        raise HTTPException(status_code=404, detail="批號不存在")
    return batch


def get_snapshot(db: Session, batch_id: int) -> BatchSnapshot | None:
    b = db.get(Batch, batch_id)
    if b is None:
        return None
    return BatchSnapshot(b.id, b.status, b.lot_no, b.product_line_code, b.product_model_code, b.equipment_ref)


def batch_labels(db: Session, batch_ids: set[int]) -> dict[int, str]:
    """批次編號 → 批號，供清單類畫面一次補齊，避免逐列查詢。"""
    if not batch_ids:
        return {}
    return {i: lot for i, lot in db.execute(select(Batch.id, Batch.lot_no).where(Batch.id.in_(batch_ids)))}


def latest_values(db: Session, batch_id: int, station_code: str, keys: list[str]) -> dict[str, Decimal | None]:
    """同一站點指定項目目前的數值（未填為 None）；跨欄位規則使用。"""
    rows = db.execute(select(Measurement.metric_key, Measurement.value_num).where(
        Measurement.batch_id == batch_id, Measurement.station_code == station_code,
        Measurement.metric_key.in_(keys), Measurement.step_seq == 0))
    found = {k: (None if v is None else Decimal(str(v))) for k, v in rows}
    return {k: found.get(k) for k in keys}


def current_measurement(db: Session, batch_id: int, station_code: str, metric_key: str) -> tuple[int, Decimal | None] | None:
    row = db.execute(select(Measurement.id, Measurement.value_num).where(
        Measurement.batch_id == batch_id, Measurement.station_code == station_code,
        Measurement.metric_key == metric_key, Measurement.step_seq == 0)).first()
    if row is None:
        return None
    return row[0], (None if row[1] is None else Decimal(str(row[1])))
