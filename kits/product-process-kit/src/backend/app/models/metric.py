from sqlalchemy import JSON, Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Metric(Base):
    """表單上一個可填寫的項目。spec_source=constant 用本列規格；=model 依型號到
    model_specs 以 key 查值。filler_role 決定誰能填。product_model_id 非空代表該型號
    專屬項目，整組取代站點的共用項目。"""

    __tablename__ = "metrics"
    __table_args__ = (UniqueConstraint("station_id", "key", "product_model_id", name="uq_metric_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id", ondelete="CASCADE"))
    product_model_id: Mapped[int | None] = mapped_column(ForeignKey("product_models.id", ondelete="CASCADE"), nullable=True)
    section: Mapped[str] = mapped_column(String(32))
    scope: Mapped[str] = mapped_column(String(16), default="station")  # batch | station | step
    key: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(128))
    unit: Mapped[str | None] = mapped_column(String(16), nullable=True)
    data_type: Mapped[str] = mapped_column(String(16))  # number | text | boolean | datetime | enum
    spec_min: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    spec_max: Mapped[float | None] = mapped_column(Numeric, nullable=True)
    spec_text: Mapped[str | None] = mapped_column(String(128), nullable=True)
    spec_source: Mapped[str] = mapped_column(String(16), default="constant")
    filler_role: Mapped[str] = mapped_column(String(16), default="operator")
    display_order: Mapped[int] = mapped_column(Integer, default=0)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    # 這些角色連讀取都擋（在後端過濾，不只是前端隱藏）。來源系統以寫死的 key 清單處理稽核角色。
    hidden_from_roles: Mapped[list] = mapped_column(JSON, default=list)
