"""Explicit synthetic tenant setup for manual API checks; startup stays empty."""
import asyncio
from uuid import UUID

from app.preview_support import require_preview

require_preview()

from app.core import database
from app.models.core.tenant import Tenant


async def seed():
    await database.init_db()
    try:
        async with database.async_session_factory() as session:
            tenant_id = UUID("00000000-0000-4000-8000-000000000001")
            if await session.get(Tenant, tenant_id) is None:
                session.add(Tenant(id=tenant_id, name="Preview synthetic tenant",
                                   code="preview-synthetic", is_active=True, is_default=True))
                await session.commit()
            print(f"PREVIEW_TENANT: {tenant_id}")
    finally:
        await database.close_db()


if __name__ == "__main__":
    asyncio.run(seed())
