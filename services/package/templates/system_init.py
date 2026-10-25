"""Explicit first-install schema/tenant creation; not an upgrade migration."""
import asyncio
import os
from uuid import UUID


async def initialize():
    for name in ("DATABASE_URL", "SECRET_KEY", "DEFAULT_TENANT_ID", "SYSTEM_ID"):
        if not os.environ.get(name, "").strip():
            raise RuntimeError(f"Required environment variable is missing: {name}")
    tenant_id = UUID(os.environ["DEFAULT_TENANT_ID"])
    system_id = os.environ["SYSTEM_ID"]
    if len(system_id) > 50:
        raise ValueError("SYSTEM_ID must contain at most 50 characters")
    from sqlalchemy import text
    from app.core import database, monitoring
    import app.models
    from app.models.core.tenant import Tenant

    await database.init_db()
    try:
        async with database.engine.begin() as connection:
            # Serialize concurrent first installs; all DDL and tenant creation commit together.
            await connection.execute(text("SELECT pg_advisory_xact_lock(12720261025)"))
            await connection.run_sync(database.Base.metadata.create_all)
            # logs-ops keeps system_logs as plain DDL (no ORM model), so create_all does not see it.
            if hasattr(monitoring, "_DDL_PG"):
                await connection.execute(text(monitoring._DDL_PG))
            existing = await connection.scalar(Tenant.__table__.select().with_only_columns(Tenant.id).where(Tenant.id == tenant_id))
            if existing is None:
                await connection.execute(Tenant.__table__.insert().values(
                    id=tenant_id, name=system_id, code=system_id, is_active=True, is_default=True))
    finally:
        await database.close_db()


if __name__ == "__main__":
    asyncio.run(initialize())
