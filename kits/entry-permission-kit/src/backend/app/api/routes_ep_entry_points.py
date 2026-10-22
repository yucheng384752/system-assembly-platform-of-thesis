from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.entry_permission.middleware import changed_actor, grants_for

router = APIRouter(prefix="/api/entry-points", tags=["entry-permission-directory"])


@router.get("")
async def directory(request: Request, actor=Depends(changed_actor)):
    return request.app.state.ep_directory.document


@router.get("/me", description="Entry-layer visibility only. The legacy endpoint permission middleware may still deny access; effective access is the intersection of both layers.")
async def available(request: Request, actor=Depends(changed_actor), db: AsyncSession = Depends(get_db)):
    directory = request.app.state.ep_directory
    grants, overrides = await grants_for(db, actor)
    return [key for key, entry in directory.entries.items()
            if directory.entry_allowed(entry, actor, grants, overrides)]
