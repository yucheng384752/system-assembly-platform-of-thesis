"""Test harness only: wires the real entry-permission middleware, the unchanged legacy endpoint gate and real Kit routers."""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.core import database
from app.core.endpoint_permission_middleware import endpoint_permission_middleware
from app.entry_permission.middleware import configure_entry_permission, entry_permission_middleware
import app.models  # noqa: F401  registers every table
from app.models.core.tenant import Tenant
from app.api import routes_ep_auth, routes_ep_entry_points, routes_ep_roles, routes_ep_users, routes_generic_forms, routes_edit

TENANT = os.environ["DEFAULT_TENANT_ID"]


async def machine_double(request, call_next):
    # TEST DOUBLE: the baseline api_key_auth_middleware is not in kits/. It accepts exactly one fixed key.
    if request.headers.get("X-Admin-API-Key") == "e2e-machine-key":
        request.state.is_admin = True
        # The baseline middleware binds the tenant for admin keys from the request; mimic only that.
        request.state.auth_tenant_id = request.headers.get("X-Tenant-Id")
        return await call_next(request)
    return JSONResponse(status_code=401, content={"detail": "Unauthorized"})


@asynccontextmanager
async def lifespan(app):
    await database.init_db()
    async with database.engine.begin() as conn:
        await conn.run_sync(database.Base.metadata.create_all)
    async with database.get_db_context() as db:
        if await db.get(Tenant, TENANT) is None:
            db.add(Tenant(id=TENANT, name="e2e", code="e2e", is_active=True, is_default=True))
    configure_entry_permission(app, directory_path=os.environ["ENTRY_POINTS_FILE"],
                               default_tenant_id=TENANT, machine_auth=machine_double)
    yield
    await database.close_db()


app = FastAPI(lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


app.middleware("http")(endpoint_permission_middleware)   # inner, as in the baseline
app.middleware("http")(entry_permission_middleware)      # outer
for module, prefix in ((routes_ep_auth, ""), (routes_ep_entry_points, ""), (routes_ep_roles, ""), (routes_ep_users, ""),
                       (routes_generic_forms, "/api"), (routes_edit, "/api/edit")):
    app.include_router(module.router, prefix=prefix)
