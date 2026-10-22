"""EP4 integration: replace the outer user API-key gate with this callable.

Pass the original API-key middleware as machine_auth, and keep the original
endpoint_permission_middleware downstream. Do not register both user auth gates.
Call configure_entry_permission during startup, before accepting requests.
"""
import logging
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import database
from app.models.ep_user import EpUser
from app.models.ep_role_entry_point import EpRoleEntryPoint
from app.models.ep_user_entry_point_override import EpUserEntryPointOverride
from .directory import Directory
from .policy import builtin_admin, tenant_header_allowed
from .security import load_secret, token_subject

log = logging.getLogger(__name__)
SELF_ROUTES = {("GET", "/api/auth/me"), ("PATCH", "/api/auth/me"),
               ("POST", "/api/auth/change-password")}
DIRECTORY_ROUTES = {("GET", "/api/entry-points"), ("GET", "/api/entry-points/me")}


def configure_entry_permission(app, *, directory_path, default_tenant_id, machine_auth):
    """Fail startup on missing/short key, invalid tenant, directory or machine gate."""
    secret = load_secret()
    UUID(str(default_tenant_id))
    directory = Directory.load(directory_path)
    if not callable(machine_auth):
        raise ValueError("Original machine API-key middleware is required")
    app.state.ep_secret = secret
    app.state.ep_tenant_id = str(default_tenant_id)
    app.state.ep_directory = directory
    app.state.ep_machine_auth = machine_auth


def forbidden():
    return JSONResponse(status_code=403, content={"detail": "Forbidden"})


def check_tenant(request):
    allowed = tenant_header_allowed(request.headers.getlist("x-tenant-id"), request.app.state.ep_tenant_id)
    if not allowed:
        log.warning("Entry permission rejected a tenant header")
    return allowed


async def grants_for(db, actor):
    grants = dict((await db.execute(select(EpRoleEntryPoint.entry_point, EpRoleEntryPoint.allowed)
                                   .where(EpRoleEntryPoint.role_id == actor.role_id))).all())
    overrides = dict((await db.execute(select(EpUserEntryPointOverride.entry_point, EpUserEntryPointOverride.allowed)
                                      .where(EpUserEntryPointOverride.user_id == actor.id))).all())
    return grants, overrides


async def entry_permission_middleware(request: Request, call_next):
    directory = request.app.state.ep_directory
    path, method = request.url.path, request.method.upper()
    if not (path == "/api" or path.startswith("/api/")) or directory.is_public(method, path):
        return await call_next(request)

    # Machine credentials are validated by the original gate, never by presence alone.
    if request.headers.get("X-Admin-API-Key") and not request.headers.get("Authorization"):
        request.state.is_admin = False
        async def machine_next(authenticated_request):
            if not getattr(authenticated_request.state, "is_admin", False):
                return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
            if not check_tenant(authenticated_request):
                return forbidden()
            return await call_next(authenticated_request)
        return await request.app.state.ep_machine_auth(request, machine_next)

    authorization = request.headers.get("Authorization", "").split()
    subject = token_subject(authorization[1], request.app.state.ep_secret) if (
        len(authorization) == 2 and authorization[0].lower() == "bearer") else None
    if subject is None:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    async with database.async_session_factory() as db:
        actor = await db.get(EpUser, subject)
        if actor is None or not actor.is_active:
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
        if not check_tenant(request):
            return forbidden()
        request.state.actor_user_id = actor.id
        request.state.actor_role = actor.role.name
        request.state.is_admin = builtin_admin(actor.role.name, actor.role.is_builtin)
        request.state.auth_tenant_id = request.app.state.ep_tenant_id
        request.state.must_change_password = actor.must_change_password
        request.state.ep_actor = actor
        if actor.must_change_password and (method, path) not in {
            ("GET", "/api/auth/me"), ("POST", "/api/auth/change-password")
        }:
            return JSONResponse(status_code=403, content={"detail": "Password change required"})
        if (method, path) not in SELF_ROUTES | DIRECTORY_ROUTES:
            grants, overrides = await grants_for(db, actor)
            if not directory.matching(method, path):
                log.warning("Entry permission encountered an uncatalogued API route")
            if not directory.request_allowed(method, path, actor, grants, overrides):
                return forbidden()
    # No role promotion, no response rewriting: the old endpoint layer can veto.
    return await call_next(request)


async def current_actor(request: Request, db: AsyncSession = Depends(database.get_db)):
    actor_id = getattr(request.state, "actor_user_id", None)
    if not getattr(request.state, "ep_actor", None) or actor_id is None:
        raise HTTPException(401, "Unauthorized")
    actor = await db.get(EpUser, actor_id)
    if actor is None or not actor.is_active:
        raise HTTPException(401, "Unauthorized")
    return actor


async def changed_actor(actor=Depends(current_actor)):
    if actor.must_change_password:
        raise HTTPException(403, "Password change required")
    return actor


async def admin_actor(actor=Depends(changed_actor)):
    if not builtin_admin(actor.role.name, actor.role.is_builtin):
        raise HTTPException(403, "Forbidden")
    return actor


async def user_manager(request: Request, actor=Depends(changed_actor), db: AsyncSession = Depends(database.get_db)):
    entry = request.app.state.ep_directory.entries.get("entry_permission.user_manage")
    grants, overrides = await grants_for(db, actor)
    if entry is None or not request.app.state.ep_directory.entry_allowed(entry, actor, grants, overrides):
        raise HTTPException(403, "Forbidden")
    return actor


async def commit(db):
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(409, "Conflicting record") from exc
