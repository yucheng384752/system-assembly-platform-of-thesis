import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EpUserEntryPointOverride(Base):
    __tablename__ = "ep_user_entry_point_overrides"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ep_users.id", ondelete="CASCADE"), index=True)
    entry_point: Mapped[str] = mapped_column(String(100))
    allowed: Mapped[bool] = mapped_column(Boolean)
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ep_users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (UniqueConstraint("user_id", "entry_point", name="uq_ep_user_entry_point"),)
