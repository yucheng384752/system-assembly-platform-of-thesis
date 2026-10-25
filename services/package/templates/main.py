"""Formal Kit wiring. Schema initialization is an explicit installer step."""
import os
from contextlib import asynccontextmanager
from importlib import import_module
from pathlib import Path
from uuid import UUID

# Check before router imports can instantiate baseline Settings.
for name in @@REQUIRED@@:
    if not os.environ.get(name, "").strip():
        raise RuntimeError(f"Required environment variable is missing: {name}")

from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from app.api.deps import get_current_tenant
from app.core import database, monitoring
from app.core.endpoint_permission_middleware import endpoint_permission_middleware
from app.entry_permission.middleware import configure_entry_permission, entry_permission_middleware
import app.models
from app.models.core.tenant import Tenant

TENANT_ID = UUID(os.environ["DEFAULT_TENANT_ID"])
PERMISSIONS = Path(__file__).resolve().parents[2] / "permissions"
os.environ.setdefault("ENDPOINT_PERMISSIONS_FILE", str(PERMISSIONS / "endpoint_permissions.json"))


async def machine_access_unavailable(request, call_next):
    return JSONResponse(status_code=401, content={"detail": "Machine API key authentication is unavailable"})


@asynccontextmanager
async def lifespan(app):
    configure_entry_permission(app, directory_path=PERMISSIONS / "entry_points.json",
                               default_tenant_id=TENANT_ID, machine_auth=machine_access_unavailable)
    await database.init_db()
    # Only logs-ops-kit's monitoring has a log writer; the platform-core no-op does not. Remote heartbeat stays off.
    if hasattr(monitoring, "_DDL_PG"):
        monitoring.init_monitoring(server_url="")
    try:
        yield
    finally:
        if hasattr(monitoring, "stop_heartbeat"):
            monitoring.stop_heartbeat()
        await database.close_db()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/healthz")
async def healthz():
    try:
        async with database.engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
            tables = await connection.run_sync(lambda conn: set(inspect(conn).get_table_names()))
        missing = set(database.Base.metadata.tables) - tables
        if missing:
            return JSONResponse(status_code=503, content={"detail": "Schema initialization required", "missingTables": sorted(missing)})
        async with database.async_session_factory() as db:
            if await db.get(Tenant, TENANT_ID) is None:
                return JSONResponse(status_code=503, content={"detail": "Default tenant initialization required"})
    except (SQLAlchemyError, OSError):
        return JSONResponse(status_code=503, content={"detail": "Database unavailable"})
    return {"status": "ok"}


app.middleware("http")(endpoint_permission_middleware)
app.middleware("http")(entry_permission_middleware)
@@ROUTERS@@
