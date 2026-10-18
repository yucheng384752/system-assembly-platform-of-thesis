from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DefinitionChangeLog(Base):
    """產品與型號定義的異動紀錄。不對帳號表建外鍵：同時保存帳號編號與當時的顯示名稱，
    帳號之後被改名或停用，紀錄仍可讀。"""

    __tablename__ = "definition_change_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(32))  # product_model | recipe
    entity_id: Mapped[int] = mapped_column(Integer, index=True)
    summary: Mapped[str] = mapped_column(String(1000))
    reason: Mapped[str] = mapped_column(String(500))
    changed_by_id: Mapped[int] = mapped_column(Integer)
    changed_by_name: Mapped[str] = mapped_column(String(64))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
