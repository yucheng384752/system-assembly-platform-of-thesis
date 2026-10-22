import asyncio
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.entry_permission.middleware import admin_actor, commit, user_manager
from app.entry_permission.policy import builtin_admin, may_manage_role, may_set_overrides
from app.entry_permission.security import hash_password
from app.models.ep_role import EpRole
from app.models.ep_user import EpUser
from app.models.ep_user_entry_point_override import EpUserEntryPointOverride
from app.schemas.ep_auth import NewPassword, UserRead
from app.schemas.ep_entry_points import EntryGrants
from app.schemas.ep_users import UserCreate, UserUpdate

router = APIRouter(prefix="/api/users", tags=["entry-permission-users"])


def check_managed(actor, role):
    if not may_manage_role(actor_admin=builtin_admin(actor.role.name, actor.role.is_builtin), target_role=role.name):
        raise HTTPException(403, "Forbidden")


async def target_user(db, user_id):
    user = (await db.execute(select(EpUser).where(EpUser.id == user_id)
                             .with_for_update(of=EpUser))).scalar_one_or_none()
    if user is None:
        raise HTTPException(404, "User not found")
    return user


async def target_role(db, role_id):
    role = await db.get(EpRole, role_id)
    if role is None:
        raise HTTPException(404, "Role not found")
    return role


@router.get("", response_model=list[UserRead])
async def list_users(actor=Depends(user_manager), db: AsyncSession = Depends(get_db)):
    query = select(EpUser).join(EpRole)
    if not builtin_admin(actor.role.name, actor.role.is_builtin):
        query = query.where(EpRole.name.notin_(["admin", "manager"]))
    return (await db.scalars(query.order_by(EpUser.username))).all()


@router.post("", response_model=UserRead, status_code=201)
async def create_user(body: UserCreate, actor=Depends(user_manager), db: AsyncSession = Depends(get_db)):
    role = await target_role(db, body.role_id)
    check_managed(actor, role)
    user = EpUser(username=body.username, display_name=body.display_name, employee_no=body.employee_no,
                  role_id=role.id, password_hash=await asyncio.to_thread(hash_password, body.password.get_secret_value()),
                  must_change_password=True)
    db.add(user)
    await commit(db)
    return user


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(user_id: UUID, body: UserUpdate, actor=Depends(user_manager), db: AsyncSession = Depends(get_db)):
    user = await target_user(db, user_id)
    check_managed(actor, user.role)
    changes = body.model_dump(exclude_unset=True)
    if "role_id" in changes:
        role = await target_role(db, body.role_id)
        check_managed(actor, role)
    for key, value in changes.items():
        setattr(user, key, value)
    await commit(db)
    return user


@router.post("/{user_id}/reset-password", response_model=UserRead)
async def reset_password(user_id: UUID, body: NewPassword, actor=Depends(user_manager), db: AsyncSession = Depends(get_db)):
    user = await target_user(db, user_id)
    check_managed(actor, user.role)
    user.password_hash = await asyncio.to_thread(hash_password, body.new_password.get_secret_value())
    user.must_change_password = True
    user.failed_login_count = 0
    user.locked_until = None
    await commit(db)
    return user


@router.put("/{user_id}/entry-point-overrides", response_model=UserRead)
async def set_overrides(user_id: UUID, body: EntryGrants, request: Request,
                        actor=Depends(admin_actor), db: AsyncSession = Depends(get_db)):
    user = await target_user(db, user_id)
    if not may_set_overrides(actor_admin=True, target_readonly=user.role.is_readonly):
        raise HTTPException(403, "Forbidden")
    if set(body.entries) - request.app.state.ep_directory.entries.keys():
        raise HTTPException(422, "Unknown entry point")
    existing = {row.entry_point: row for row in (await db.scalars(select(EpUserEntryPointOverride)
                .where(EpUserEntryPointOverride.user_id == user.id))).all()}
    for key, value in body.entries.items():
        row = existing.get(key)
        if value is None:
            if row is not None:
                await db.delete(row)
        elif row is not None:
            row.allowed, row.assigned_by = value, actor.id
        else:
            db.add(EpUserEntryPointOverride(user_id=user.id, entry_point=key, allowed=value, assigned_by=actor.id))
    await commit(db)
    return user
