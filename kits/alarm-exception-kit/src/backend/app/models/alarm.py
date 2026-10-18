from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Alarm(Base):
    """報警。以批次編號與量測編號（無外鍵）關聯批次生產 Kit 的資料。
    status：active（待處理）→ acknowledged（已確認，仍未解除）→ resolved（條件回復合格後自動解除）。"""

    __tablename__ = "alarms"
    __table_args__ = (Index("ix_alarm_batch_rule", "batch_id", "rule_key", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, index=True)
    measurement_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rule_key: Mapped[str] = mapped_column(String(64))
    station_code: Mapped[str] = mapped_column(String(32))
    metric_key: Mapped[str] = mapped_column(String(64))
    severity: Mapped[str] = mapped_column(String(16), default="warning")
    message: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    acknowledged_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
