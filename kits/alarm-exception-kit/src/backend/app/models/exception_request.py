from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExceptionRequest(Base):
    """關鍵量測超規時的異常簽核申請。同一批次可有多筆（重工後再超規會再申請）；
    判斷是否擋住批次時只看最新一筆。"""

    __tablename__ = "exception_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(Integer, index=True)
    station_code: Mapped[str] = mapped_column(String(32))
    metric_key: Mapped[str] = mapped_column(String(64))
    measured_value: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    requested_by: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    decided_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_passed: Mapped[bool] = mapped_column(Boolean, default=False)
    decision_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
