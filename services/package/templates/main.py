"""Formal Kit wiring. Schema initialization is an explicit installer step."""
import json
import os
from contextlib import asynccontextmanager
from importlib import import_module
from pathlib import Path
from uuid import UUID

# Secret values come from mounted files (<NAME>_FILE); load them before any Settings is instantiated.
from app.secret_files import load_secret_files

load_secret_files()
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
from app.license_gate import GATE, license_gate_middleware
from app import selfcheck
import app.models
from app.models.core.tenant import Tenant

TENANT_ID = UUID(os.environ["DEFAULT_TENANT_ID"])
PERMISSIONS = Path(__file__).resolve().parents[2] / "permissions"
os.environ.setdefault("ENDPOINT_PERMISSIONS_FILE", str(PERMISSIONS / "endpoint_permissions.json"))


MANIFEST = Path(os.environ.get("SYSTEM_MANIFEST_FILE", "/system/manifest/system-manifest.json"))


async def run_selfcheck():
    """The on-site checks (D182): package, contracts, dependencies, permission directory, routes, database."""
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    findings = selfcheck.static_findings(manifest, app, app.state.ep_directory)
    reachable, tables, declared, tenant_present = await selfcheck.collect_database(database, Tenant, TENANT_ID)
    return findings + selfcheck.database_findings(reachable, tables, declared, tenant_present, selfcheck.owners_of(manifest))


SELFCHECK = selfcheck.SelfCheck(run_selfcheck)


async def machine_access_unavailable(request, call_next):
    return JSONResponse(status_code=401, content={"detail": "Machine API key authentication is unavailable"})


@asynccontextmanager
async def lifespan(app):
    configure_entry_permission(app, directory_path=PERMISSIONS / "entry_points.json",
                               default_tenant_id=TENANT_ID, machine_auth=machine_access_unavailable)
    GATE.result()  # log the license state at startup; the gate re-checks on every request window
    await database.init_db()
    await SELFCHECK.run()  # log and record the result at startup; the gate below keeps re-checking while it fails
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
    result = await SELFCHECK.current()
    if result["status"] != "passed":
        return JSONResponse(status_code=503, content=selfcheck.refusal(result))
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
# Inside the license gate: nothing is served while the on-site self-check fails, except /healthz which reports why (D182).
app.middleware("http")(selfcheck.gate(SELFCHECK))
# Added last so it is the outermost middleware: nothing is served while the license is invalid (D142).
app.middleware("http")(license_gate_middleware)
