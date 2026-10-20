"""Preview compatibility model; field evidence is recorded in WP4c Codex Notes."""
from sqlalchemy import Column, Float, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class P2ItemV2(Base):
    __tablename__ = "p2_items_v2"

    id = Column(UUID(as_uuid=True), primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    p2_record_id = Column(UUID(as_uuid=True), ForeignKey("p2_records.id"), nullable=False)
    winder_number = Column(Integer, nullable=False)
    production_date_yyyymmdd = Column(Integer, nullable=True)
    trace_lot_no = Column(Text, nullable=True)
    row_data = Column(JSONB, nullable=False)
    slitting_result = Column(Float, nullable=True)
    sheet_width = Column(Float, nullable=True)
    thickness1 = Column(Float, nullable=True)
    thickness2 = Column(Float, nullable=True)
    thickness3 = Column(Float, nullable=True)
    thickness4 = Column(Float, nullable=True)
    thickness5 = Column(Float, nullable=True)
    thickness6 = Column(Float, nullable=True)
    thickness7 = Column(Float, nullable=True)
    appearance = Column(Float, nullable=True)
    rough_edge = Column(Float, nullable=True)
