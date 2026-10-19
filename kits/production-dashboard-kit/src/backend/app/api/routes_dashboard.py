"""儀表板：總覽、活動紀錄、製程查詢（搜尋與逐站追溯）。

所有批次資料都經 batch_read，可見性與批次生產 Kit 自己的端點同一套規則。
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_entry_point, require_password_changed
from app.core.activity import describe
from app.core.activity_service import purge_expired
from app.core.batch_read import batch_counts, batch_labels, batch_trace, get_visible_batch, search_batches, visible_batch_ids
from app.core.dashboard_settings import get_settings
from app.core.database import get_db
from app.core.entry_points_registration import ACTIVITY_PURGE
from app.core.providers import registry
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.dashboard import ActivityRead, BatchSummaryRead, OverviewRead, SectionRead, TraceRead

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/overview", response_model=OverviewRead)
def overview(actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> OverviewRead:
    sections = [SectionRead(key=s.key, title=s.title, counts=s.counts, rows=s.rows, error=s.error) for s in registry.collect(db, actor)]
    return OverviewRead(batches=batch_counts(db, actor), sections=sections)


@router.get("/activity", response_model=list[ActivityRead])
def activity(batch_id: int | None = None, before_id: int | None = None, limit: int | None = None,
             actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[ActivityRead]:
    s = get_settings()
    size = min(max(limit or s.list_limit, 1), 200)
    if batch_id is not None:
        get_visible_batch(db, batch_id, actor)
    out: list[ActivityRead] = []
    cursor = before_id
    # 範圍外的批次會被過濾掉，所以分批往前撈，直到湊滿或沒有更多。
    for _ in range(10):
        q = select(ActivityLog).order_by(ActivityLog.id.desc()).limit(size * 2)
        if batch_id is not None:
            q = q.where(ActivityLog.batch_id == batch_id)
        if cursor is not None:
            q = q.where(ActivityLog.id < cursor)
        rows = list(db.scalars(q))
        if not rows:
            break
        ok = visible_batch_ids(db, actor, {r.batch_id for r in rows})
        labels = batch_labels(db, ok)
        for r in rows:
            if r.batch_id in ok:
                out.append(ActivityRead(id=r.id, batch_id=r.batch_id, batch_label=labels.get(r.batch_id), text=describe(r.reason, s.reason_labels),
                                        actor_id=r.actor_id, created_at=r.created_at))
                if len(out) >= size:
                    return out
        cursor = rows[-1].id
    return out


@router.post("/activity/purge")
def purge(actor: User = Depends(require_entry_point(ACTIVITY_PURGE)), db: Session = Depends(get_db)) -> dict:
    n = purge_expired(db)
    db.commit()
    return {"purged": n}


@router.get("/batches", response_model=list[BatchSummaryRead])
def query_batches(lot_prefix: str | None = None, status_filter: str | None = None, product_line_code: str | None = None,
                  created_from: datetime | None = None, created_to: datetime | None = None, limit: int | None = None,
                  actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[BatchSummaryRead]:
    if created_from and created_to and created_from >= created_to:
        raise HTTPException(422, "起始時間必須早於結束時間")
    rows = search_batches(db, actor, lot_prefix=lot_prefix, status=status_filter, product_line_code=product_line_code,
                          created_from=created_from, created_to=created_to, limit=limit or get_settings().list_limit)
    return [BatchSummaryRead(**r.__dict__) for r in rows]


@router.get("/batches/{batch_id}/trace", response_model=list[TraceRead])
def trace(batch_id: int, actor: User = Depends(require_password_changed), db: Session = Depends(get_db)) -> list[TraceRead]:
    return [TraceRead(station_code=c.station_code, metric_key=c.metric_key, step_seq=c.step_seq,
                      value_num=None if c.value_num is None else float(c.value_num), value_text=c.value_text,
                      value_bool=c.value_bool, operator_id=c.operator_id, recorded_at=c.recorded_at)
            for c in batch_trace(db, batch_id, actor)]
