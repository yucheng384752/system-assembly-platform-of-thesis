"""活動紀錄的資料庫部分：訂閱 BatchChanged 寫入，並提供清除。"""

from datetime import datetime, timezone

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.dashboard_settings import get_settings
from app.core.events import BatchChanged, bus
from app.core.retention import cutoff
from app.models.activity_log import ActivityLog


def on_batch_changed(db: Session, ev: BatchChanged) -> None:
    if get_settings().activity_enabled:
        db.add(ActivityLog(batch_id=ev.batch_id, reason=ev.reason[:300], actor_id=ev.actor_id))


def purge_expired(db: Session, now: datetime | None = None) -> int:
    """依設定的保留天數清除；回傳清除筆數。永久保留時什麼都不做。"""
    limit = cutoff(now or datetime.now(timezone.utc), get_settings().activity_retention_days)
    if limit is None:
        return 0
    result = db.execute(delete(ActivityLog).where(ActivityLog.created_at < limit))
    return result.rowcount or 0


def register() -> None:
    bus.subscribe(BatchChanged, on_batch_changed)
