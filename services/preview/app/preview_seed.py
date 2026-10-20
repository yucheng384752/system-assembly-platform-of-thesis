"""Explicit synthetic tenant setup for manual API checks; startup stays empty."""
import asyncio
import hashlib
import json
from uuid import UUID

from sqlalchemy import select
from app.preview_support import require_preview

require_preview()

from app.core import database
from app.models.core.tenant import Tenant
from app.models.core.schema_registry import SchemaVersion, TableRegistry
from app.models.station import Station, StationSchema


async def seed_tables(session, tenant_id):
    fields = [
        {"name": "entry_key", "type": "text", "required": True},
        {"name": "value", "type": "text", "required": True},
    ]
    schema_json = {"fields": fields}
    schema_hash = hashlib.sha256(json.dumps(schema_json, sort_keys=True).encode()).hexdigest()
    fingerprint = hashlib.sha256("|".join(sorted(f["name"] for f in fields)).encode()).hexdigest()
    table = (await session.execute(
        select(TableRegistry).where(TableRegistry.table_code == "preview_entries")
    )).scalar_one_or_none()
    if table is None:
        table = TableRegistry(table_code="preview_entries", display_name="Preview entries")
        session.add(table)
        await session.flush()
    version = (await session.execute(
        select(SchemaVersion).where(SchemaVersion.table_id == table.id)
    )).scalar_one_or_none()
    if version is None:
        session.add(SchemaVersion(table_id=table.id, schema_hash=schema_hash,
                                  header_fingerprint=fingerprint, schema_json=schema_json))
    elif version.schema_json != schema_json or version.header_fingerprint != fingerprint:
        raise ValueError("Preview schema differs from seed; reset the preview before seeding")
    station = (await session.execute(select(Station).where(
        Station.tenant_id == tenant_id, Station.code == "preview_entries"
    ))).scalar_one_or_none()
    if station is None:
        station = Station(tenant_id=tenant_id, code="preview_entries", name="Preview entries")
        session.add(station)
        await session.flush()
    station_schema = (await session.execute(select(StationSchema).where(
        StationSchema.station_id == station.id
    ))).scalar_one_or_none()
    if station_schema is None:
        session.add(StationSchema(station_id=station.id, version=1, is_active=True,
                                  record_fields=fields, unique_key_fields=["entry_key"]))
    elif (station_schema.record_fields != fields
          or station_schema.unique_key_fields != ["entry_key"] or not station_schema.is_active):
        raise ValueError("Preview station schema differs from seed; reset before seeding")
    # No matching Stations: these codes must exercise the compatibility model branches.
    for code in ("P1", "P2", "P3"):
        registered = (await session.execute(select(TableRegistry).where(
            TableRegistry.table_code == code
        ))).scalar_one_or_none()
        if registered is None:
            session.add(TableRegistry(table_code=code, display_name=f"Preview {code}"))


async def seed():
    await database.init_db()
    try:
        async with database.async_session_factory() as session:
            tenant_id = UUID("00000000-0000-4000-8000-000000000001")
            if await session.get(Tenant, tenant_id) is None:
                session.add(Tenant(id=tenant_id, name="Preview synthetic tenant",
                                   code="preview-synthetic", is_active=True, is_default=True))
                await session.flush()
            await seed_tables(session, tenant_id)
            await session.commit()
            print(f"PREVIEW_TENANT: {tenant_id}")
    finally:
        await database.close_db()


if __name__ == "__main__":
    asyncio.run(seed())
