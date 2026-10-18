from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Measurement(Base):
    """表單上一個格子的值。以 (站點代碼, 項目 key, 步驟序號) 參照產品定義；不屬於步驟時
    step_seq 為 0，而不是 NULL，因此唯一限制由資料庫保證，不必靠應用層 upsert 補洞
    （來源系統的 NULL 在唯一限制中視為相異，只能靠程式約定）。"""

    __tablename__ = "measurements"
    __table_args__ = (UniqueConstraint("batch_id", "station_code", "metric_key", "step_seq", name="uq_measurement_cell"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"))
    station_code: Mapped[str] = mapped_column(String(32))
    metric_key: Mapped[str] = mapped_column(String(64))
    step_seq: Mapped[int] = mapped_column(Integer, default=0)
    operator_id: Mapped[int] = mapped_column(Integer)
    value_num: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    value_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    value_bool: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_done: Mapped[bool] = mapped_column(Boolean, default=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True)
