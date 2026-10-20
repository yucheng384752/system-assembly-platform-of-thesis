"""Local preview entry point, not a deployment or authentication entry point."""
import json
import os
import secrets
from contextlib import asynccontextmanager
from importlib import import_module
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy import text

from app.preview_support import require_preview

require_preview()

from app.core import database
from app.core import monitoring
from app.api.deps import get_current_tenant
from app import preview_gate
import app.models  # Register every assembled model before create_all.


@asynccontextmanager
async def lifespan(app):
    await database.init_db()
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(database.Base.metadata.create_all)
            # logs-ops uses its own DDL rather than an ORM model.
            if hasattr(monitoring, "_DDL_PG"):
                await connection.execute(text(monitoring._DDL_PG))
        monitoring.init_monitoring(server_url="")
        print("PREVIEW_READY: tables created; no seed data; authentication not covered", flush=True)
        yield
    finally:
        monitoring.stop_heartbeat()
        await database.close_db()


app = FastAPI(title="Composer local preview (unverified)", lifespan=lifespan,
              docs_url=None, redoc_url=None)
root = Path(__file__).parent
gate = preview_gate.Gate(
    json.loads((root / "preview_policy.json").read_text(encoding="utf-8")),
    json.loads((root / "recipe.schema.json").read_text(encoding="utf-8")),
    os.environ.get("PREVIEW_RECIPE_FILE", "/preview-data/recipe.json"),
    json.loads((root / "initial_recipe.json").read_text(encoding="utf-8")),
)
preview_gate.active_gate = gate
app.add_middleware(preview_gate.GateMiddleware, gate=gate)


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


@app.get("/_preview/capabilities")
async def capabilities():
    return gate.snapshot()


def require_admin(request):
    if not getattr(request.state, "is_admin", False):
        raise HTTPException(status_code=403, detail="需要預覽管理員標頭")


@app.put("/_preview/recipe")
async def put_recipe(request: Request):
    require_admin(request)
    try:
        recipe = await request.json()
        if recipe is None:
            raise ValueError("Recipe 必須是物件；回到 all 請使用 DELETE")
        gate.replace(recipe)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return gate.snapshot()


@app.delete("/_preview/recipe")
async def delete_recipe(request: Request):
    require_admin(request)
    gate.replace(None)
    return gate.snapshot()


for registration in json.loads(Path(__file__).with_name("preview_registry.json").read_text(encoding="utf-8")):
    module = import_module(registration["module"])
    app.include_router(module.router, prefix=registration["prefix"],
                       dependencies=[Depends(get_current_tenant)] if registration["tenant"] else [])
    for route in module.router.routes:
        gate.routes.append({"kit": registration["kit"], "path": registration["prefix"] + route.path,
                            "methods": sorted(route.methods or [])})
