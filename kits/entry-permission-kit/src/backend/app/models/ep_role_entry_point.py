import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class EpRoleEntryPoint(Base):
    __tablename__ = "ep_role_entry_points"
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ep_roles.id", ondelete="CASCADE"), primary_key=True)
    entry_point: Mapped[str] = mapped_column(String(100), primary_key=True)
    allowed: Mapped[bool] = mapped_column(Boolean)
