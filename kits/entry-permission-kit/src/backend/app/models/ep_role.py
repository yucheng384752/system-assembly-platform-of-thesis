import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EpRole(Base):
    __tablename__ = "ep_roles"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(50), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_readonly: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (
        CheckConstraint("name != 'admin' OR (is_builtin AND NOT is_readonly)", name="ck_ep_admin"),
        CheckConstraint("name != 'audit' OR (is_builtin AND is_readonly)", name="ck_ep_audit"),
    )
