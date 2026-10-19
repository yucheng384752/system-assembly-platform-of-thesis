from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class WarehouseEntry(Base):
    """入庫單：每個批次最多一張。送出後鎖定。"""

    __tablename__ = "batch_warehouse_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    quantity: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    location: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lines: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    updated_by: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    submitted_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReworkRecord(Base):
    __tablename__ = "batch_rework_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, index=True)
    station_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    quantity: Mapped[float] = mapped_column(Numeric)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_by: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    confirmed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class BatchNote(Base):
    """子表格備註：只增不改。station_code 與 step_seq 指出備註針對哪一格區塊；整張單的備註兩者留空/0。"""

    __tablename__ = "batch_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, index=True)
    station_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    step_seq: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text)
    author_id: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class BatchAttachment(Base):
    """照片佐證：每個批次每個附件欄位只有一份目前版本，重傳會取代並刪除舊的物件。"""

    __tablename__ = "batch_attachments"
    __table_args__ = (UniqueConstraint("batch_id", "attachment_key", name="uq_batch_attachment_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, index=True)
    attachment_key: Mapped[str] = mapped_column(String(64))
    object_ref: Mapped[str] = mapped_column(String(512))
    filename: Mapped[str] = mapped_column(String(128))
    content_type: Mapped[str] = mapped_column(String(32))
    size: Mapped[int] = mapped_column(Integer)
    uploaded_by: Mapped[int] = mapped_column(Integer)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
