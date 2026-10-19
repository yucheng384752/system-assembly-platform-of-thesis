from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Equipment(Base):
    """設備。以代碼關聯其他資料（批次的 equipment_ref 存的就是這個代碼），不建外鍵。
    product_line_code 空白代表各產線共用。"""

    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_line_code: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class ChecklistItem(Base):
    __tablename__ = "equipment_checklist_items"
    __table_args__ = (UniqueConstraint("equipment_code", "frequency", "key", name="uq_checklist_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    equipment_code: Mapped[str] = mapped_column(String(64), index=True)
    frequency: Mapped[str] = mapped_column(String(16))
    key: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(8), default="bool")
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    low: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    high: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)


class CheckRecord(Base):
    """一台設備在一個期別的點檢。唯一限制保證同期別只有一筆；複核前可覆寫。"""

    __tablename__ = "equipment_check_records"
    __table_args__ = (UniqueConstraint("equipment_code", "frequency", "period_key", name="uq_check_period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    equipment_code: Mapped[str] = mapped_column(String(64), index=True)
    frequency: Mapped[str] = mapped_column(String(16))
    period_key: Mapped[str] = mapped_column(String(16), index=True)
    status: Mapped[str] = mapped_column(String(16), default="submitted")
    results: Mapped[dict] = mapped_column(JSON, default=dict)
    abnormal: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    performed_by: Mapped[int] = mapped_column(Integer)
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    reviewed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Repair(Base):
    __tablename__ = "equipment_repairs"

    id: Mapped[int] = mapped_column(primary_key=True)
    equipment_code: Mapped[str] = mapped_column(String(64), index=True)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    reported_by: Mapped[int] = mapped_column(Integer)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    closed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
