"""Preview compatibility model; field evidence is recorded in WP4c Codex Notes."""
from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class P3Record(Base):
    __tablename__ = "p3_records"

    id = Column(UUID(as_uuid=True), primary_key=True)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    lot_no_raw = Column(Text, nullable=False)
    lot_no_norm = Column(BigInteger, nullable=False)
    schema_version_id = Column(UUID(as_uuid=True), ForeignKey("schema_versions.id"), nullable=True)
    extras = Column(JSONB, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=True)
    production_date_yyyymmdd = Column(Integer, nullable=False)
    machine_no = Column(Text, nullable=False)
    mold_no = Column(Text, nullable=False)
    product_id = Column(Text, nullable=False)
