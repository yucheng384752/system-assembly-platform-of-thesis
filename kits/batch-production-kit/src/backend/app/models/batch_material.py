from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BatchMaterial(Base):
    """用料與秤重。`kind` 為 'total' 或配方明細的 key（見 product-process-kit），
    用字串而非列舉，新增原料不必改結構。"""

    __tablename__ = "batch_materials"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("batches.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    item_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lot_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    supplier: Mapped[str | None] = mapped_column(String(128), nullable=True)
    theoretical_qty: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    actual_qty: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    updated_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
