from datetime import date, datetime, timezone

from sqlalchemy import JSON, Date, DateTime, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Batch(Base):
    """一張生產紀錄（一個批號）。

    以業務鍵（產線代碼、型號代碼）參照產品定義，不對其他 Kit 的資料表建外鍵；帳號欄位
    只存編號，名稱讀取時再查。批號只在同一型號內唯一，真正的身分是 (型號代碼, 批號)。
    `extra` 放該行業才有的表頭欄位，本 Kit 只保存與回傳。
    """

    __tablename__ = "batches"
    __table_args__ = (UniqueConstraint("product_model_code", "lot_no", name="uq_batches_model_lot_no"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_line_code: Mapped[str] = mapped_column(String(32), index=True)
    product_model_code: Mapped[str] = mapped_column(String(64), index=True)
    process_variant: Mapped[str | None] = mapped_column(String(32), nullable=True)  # 開單當下的快照
    lot_no: Mapped[str] = mapped_column(String(64), index=True)
    serial_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    order_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    customer: Mapped[str | None] = mapped_column(String(128), nullable=True)
    equipment_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    container_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mfg_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    env_temp_c: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    env_rh_pct: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    env_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    target_weight: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    extra: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="not_started")  # not_started | in_progress | completed
    created_by: Mapped[int] = mapped_column(Integer)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    dispatched_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assigned_operator1_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assigned_operator2_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    assigned_qc_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_signed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    operator_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    inspector_signed_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    inspector_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
