from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RuntimeSetting(Base):
    """上線後調整的值；沒有資料列代表沿用下一層。version 用於樂觀鎖。以參數 key 關聯，無外鍵。"""

    __tablename__ = "runtime_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    value: Mapped[object] = mapped_column(JSON, nullable=True)  # None 代表已還原、沿用下一層
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SettingChange(Base):
    """變更紀錄：只增不改。action 為 set 或 reset。"""

    __tablename__ = "runtime_setting_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(128), index=True)
    action: Mapped[str] = mapped_column(String(8))
    old_value: Mapped[object] = mapped_column(JSON, nullable=True)
    new_value: Mapped[object] = mapped_column(JSON, nullable=True)
    version: Mapped[int] = mapped_column(Integer)
    actor_id: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
