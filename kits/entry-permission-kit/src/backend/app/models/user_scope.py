from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserScope(Base):
    """帳號的資源範圍綁定。不對其他 Kit 的資料表建立外鍵，鍵值由擁有該
    資源的 Kit 在寫入前檢查（見 app.core.user_scopes）。"""

    __tablename__ = "user_scopes"
    __table_args__ = (
        UniqueConstraint("user_id", "scope_type", "scope_key", name="uq_user_scope"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    scope_type: Mapped[str] = mapped_column(String(64))
    scope_key: Mapped[str] = mapped_column(String(64))
    assigned_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
