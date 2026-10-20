"""Local preview entry point, not a deployment or authentication entry point."""
import json
import os
import secrets
from contextlib import asynccontextmanager
from importlib import import_module
from pathlib import Path

from fastapi import Depends, FastAPI
from sqlalchemy import text

from app.preview_support import require_preview

require_preview()

from app.core import database
from app.core.monitoring import _DDL_PG, init_monitoring, stop_heartbeat
from app.api.deps import get_current_tenant
import app.models  # Register every assembled model before create_all.


@asynccontextmanager
async def lifespan(app):
    await database.init_db()
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(database.Base.metadata.create_all)
            # logs-ops uses its own DDL rather than an ORM model.
            await connection.execute(text(_DDL_PG))
        init_monitoring(server_url="")
        print("PREVIEW_READY: tables created; no seed data; authentication not covered", flush=True)
        yield
    finally:
        stop_heartbeat()
        await database.close_db()


app = FastAPI(title="Composer local preview (unverified)", lifespan=lifespan,
              docs_url=None, redoc_url=None)


# Preview-only stand-in for the baseline API-key middleware (D105). A fixed fake key marks the caller as admin and a
# header picks a role, so admin-gated and role-gated routes can be exercised. This is NOT authentication.
PREVIEW_ADMIN_KEY = os.environ.get("PREVIEW_ADMIN_API_KEY", "")


@app.middleware("http")
async def preview_identity(request, call_next):
    key = request.headers.get("X-Admin-API-Key", "")
    request.state.is_admin = bool(PREVIEW_ADMIN_KEY) and secrets.compare_digest(key, PREVIEW_ADMIN_KEY)
    role = request.headers.get("X-Preview-Role")
    request.state.actor_role = role if role in {"operator", "manager"} else None
    return await call_next(request)


@app.get("/healthz")
async def healthz():
    async with database.engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
    return {"status": "ok", "preview": True, "authentication": "not-covered"}


@app.get("/_preview/mod/subscriptions/{subscription_id}")
async def local_subscription(subscription_id: str):
    return {"external_subscription_id": subscription_id, "plan_code": "basic",
            "status": "active", "expires_at": None, "preview_fake": True}


for registration in json.loads(Path(__file__).with_name("preview_registry.json").read_text(encoding="utf-8")):
    module = import_module(registration["module"])
    app.include_router(module.router, prefix=registration["prefix"],
                       dependencies=[Depends(get_current_tenant)] if registration["tenant"] else [])
