from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ModelSpec(Base):
    __tablename__ = "model_specs"
    __table_args__ = (UniqueConstraint("product_model_id", "metric_key", name="uq_model_spec_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_model_id: Mapped[int] = mapped_column(ForeignKey("product_models.id", ondelete="CASCADE"))
    metric_key: Mapped[str] = mapped_column(String(64))
    spec_min: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    spec_max: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    spec_text: Mapped[str | None] = mapped_column(String(128), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
