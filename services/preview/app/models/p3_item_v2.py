"""Preview compatibility model; field evidence is recorded in WP4c Codex Notes."""
from sqlalchemy import Column, Date, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class P3ItemV2(Base):
    __tablename__ = "p3_items_v2"

    id = Column(UUID(as_uuid=True), primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    p3_record_id = Column(UUID(as_uuid=True), ForeignKey("p3_records.id"), nullable=False)
    row_no = Column(Integer, nullable=False)
    product_id = Column(Text, nullable=True)
    lot_no = Column(Text, nullable=False)
    production_date = Column(Date, nullable=True)
    machine_no = Column(Text, nullable=False)
    mold_no = Column(Text, nullable=False)
    production_lot = Column(Integer, nullable=True)
    source_winder = Column(Integer, nullable=True)
    specification = Column(Text, nullable=True)
    bottom_tape_lot = Column(Text, nullable=True)
    row_data = Column(JSONB, nullable=False)
