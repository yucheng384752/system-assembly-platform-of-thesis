from sqlalchemy import JSON, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StationStep(Base):
    """站點內有順序的製程步驟。`variant` 為空代表所有型號共用；與型號 process_variant
    相同時優先採用。`expected` 放該步驟的預期值（時間、轉速等），鍵名由場域定義。"""

    __tablename__ = "station_steps"
    __table_args__ = (UniqueConstraint("station_id", "seq", "variant", name="uq_station_step"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    station_id: Mapped[int] = mapped_column(ForeignKey("stations.id", ondelete="CASCADE"))
    variant: Mapped[str | None] = mapped_column(String(32), nullable=True)
    seq: Mapped[int] = mapped_column(Integer)
    instruction: Mapped[str] = mapped_column(String(255))
    spec_text: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expected: Mapped[dict] = mapped_column(JSON, default=dict)
