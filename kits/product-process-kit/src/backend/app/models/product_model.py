from sqlalchemy import JSON, Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ProductModel(Base):
    """產線下的型號。規格與配方依型號而不同。

    `process_variant` 取代來源系統的行業專屬分類，決定製程步驟取哪一組（見 form_resolver）。
    `attributes` 放該行業才有的描述性欄位（例如合金、規格代號），本 Kit 只保存與回傳，
    不解讀其意義；批次生產 Kit 以設定決定要把哪些屬性帶入開單欄位。
    """

    __tablename__ = "product_models"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_line_id: Mapped[int] = mapped_column(ForeignKey("product_lines.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    process_variant: Mapped[str | None] = mapped_column(String(32), nullable=True)
    attributes: Mapped[dict] = mapped_column(JSON, default=dict)
