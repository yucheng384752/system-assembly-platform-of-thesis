from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserEntryPointOverride(Base):
    """帳號 × 入口的例外覆寫。

    `entry_point` 是已註冊入口的 key（程式碼註冊的目錄，不是資料庫目錄表）。
    `allowed` 雙向覆寫角色預設值。唯讀角色不會出現在此表：寫入時由服務層拒絕。
    """

    __tablename__ = "user_entry_point_overrides"
    __table_args__ = (
        UniqueConstraint("user_id", "entry_point", name="uq_user_entry_point"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    entry_point: Mapped[str] = mapped_column(String(64))
    allowed: Mapped[bool] = mapped_column(Boolean)
    # 指派的管理者被刪除時保留覆寫，只清除指派人。
    assigned_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
