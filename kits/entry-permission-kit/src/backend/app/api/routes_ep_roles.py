from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.entry_permission.middleware import admin_actor, commit
from app.models.ep_role import EpRole
from app.models.ep_role_entry_point import EpRoleEntryPoint
from app.schemas.ep_entry_points import EntryGrants
from app.schemas.ep_roles import RoleCreate, RoleRead, RoleUpdate

router = APIRouter(prefix="/api/roles", tags=["entry-permission-roles"], dependencies=[Depends(admin_actor)])


async def role_by_id(db, role_id):
    role = (await db.execute(select(EpRole).where(EpRole.id == role_id).with_for_update())).scalar_one_or_none()
    if role is None:
        raise HTTPException(404, "Role not found")
    return role


@router.get("", response_model=list[RoleRead])
async def list_roles(db: AsyncSession = Depends(get_db)):
    return (await db.scalars(select(EpRole).order_by(EpRole.name))).all()


@router.post("", response_model=RoleRead, status_code=201)
async def create_role(body: RoleCreate, db: AsyncSession = Depends(get_db)):
    if body.name in {"admin", "audit", "manager", "operator"}:
        raise HTTPException(409, "Reserved role name")
    role = EpRole(**body.model_dump(), is_builtin=False)
    db.add(role)
    await commit(db)
    return role


@router.patch("/{role_id}", response_model=RoleRead)
async def update_role(role_id: UUID, body: RoleUpdate, db: AsyncSession = Depends(get_db)):
    role = await role_by_id(db, role_id)
    if (role.name == "admin" and body.is_readonly is True) or (role.name == "audit" and body.is_readonly is False):
        raise HTTPException(403, "Forbidden")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(role, key, value)
    await commit(db)
    return role


@router.delete("/{role_id}", status_code=204)
async def delete_role(role_id: UUID, db: AsyncSession = Depends(get_db)):
    role = await role_by_id(db, role_id)
    if role.is_builtin:
        raise HTTPException(403, "Forbidden")
    await db.delete(role)
    await commit(db)
    return Response(status_code=204)


@router.put("/{role_id}/entry-points", response_model=RoleRead)
async def set_grants(role_id: UUID, body: EntryGrants, request: Request, db: AsyncSession = Depends(get_db)):
    role = await role_by_id(db, role_id)
    if set(body.entries) - request.app.state.ep_directory.entries.keys():
        raise HTTPException(422, "Unknown entry point")
    rows = {row.entry_point: row for row in (await db.scalars(select(EpRoleEntryPoint)
            .where(EpRoleEntryPoint.role_id == role.id))).all()}
    for key, value in body.entries.items():
        row = rows.get(key)
        if value is None:
            if row is not None:
                await db.delete(row)
        elif row is not None:
            row.allowed = value
        else:
            db.add(EpRoleEntryPoint(role_id=role.id, entry_point=key, allowed=value))
    await commit(db)
    return role
