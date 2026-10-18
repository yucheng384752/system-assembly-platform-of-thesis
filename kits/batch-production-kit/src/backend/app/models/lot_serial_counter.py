from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LotSerialCounter(Base):
    """批號流水號計數器，依 (產線, 製程變體, 期間) 累加。current_serial 是最近一次已發出的值。
    期間在 serial_reset=never 時恆為空字串。人工修改走 LotSerialCounterLog 留下紀錄。"""

    __tablename__ = "lot_serial_counters"
    __table_args__ = (UniqueConstraint("product_line_code", "variant", "period", name="uq_lot_serial_counter"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_line_code: Mapped[str] = mapped_column(String(32))
    variant: Mapped[str] = mapped_column(String(32), default="")
    period: Mapped[str] = mapped_column(String(8), default="")
    current_serial: Mapped[int] = mapped_column(Integer, default=0)
    updated_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LotSerialCounterLog(Base):
    __tablename__ = "lot_serial_counter_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    counter_id: Mapped[int] = mapped_column(ForeignKey("lot_serial_counters.id", ondelete="CASCADE"))
    old_value: Mapped[int] = mapped_column(Integer)
    new_value: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    changed_by: Mapped[int] = mapped_column(Integer)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
