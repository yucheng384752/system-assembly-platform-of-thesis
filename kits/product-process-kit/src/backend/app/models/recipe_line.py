from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RecipeLine(Base):
    """型號的配方明細，計算規則見 app.core.recipe。"""

    __tablename__ = "recipe_lines"
    __table_args__ = (UniqueConstraint("product_model_id", "key", name="uq_recipe_line_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_model_id: Mapped[int] = mapped_column(ForeignKey("product_models.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(32))
    label: Mapped[str] = mapped_column(String(64))
    item_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ratio_pct: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    ratio_base: Mapped[str] = mapped_column(String(32), default="total")
    is_remainder: Mapped[bool] = mapped_column(Boolean, default=False)
    display_order: Mapped[int] = mapped_column(Integer, default=0)
