from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Station(Base):
    __tablename__ = "stations"
    __table_args__ = (UniqueConstraint("product_line_id", "code", name="uq_station_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_line_id: Mapped[int] = mapped_column(ForeignKey("product_lines.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(64))
    code: Mapped[str] = mapped_column(String(32))
    sequence: Mapped[int] = mapped_column(Integer, default=0)
