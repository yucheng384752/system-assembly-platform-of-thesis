import asyncio
import secrets
from datetime import datetime, timezone
from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.entry_permission.lockout import failed_attempt, is_locked
from app.entry_permission.middleware import commit, current_actor
from app.entry_permission.security import hash_password, issue_token, verify_password
from app.models.ep_user import EpUser
from app.schemas.ep_auth import ChangePassword, Login, TokenResponse, UpdateMe, UserRead

router = APIRouter(prefix="/api/auth", tags=["entry-permission-auth"])


@lru_cache(maxsize=1)
def dummy_hash():
    return hash_password(secrets.token_urlsafe(32))


@router.post("/login", response_model=TokenResponse)
async def login(body: Login, request: Request, db: AsyncSession = Depends(get_db)):
    # PostgreSQL row locks serialize failed-attempt updates across workers.
    user = (await db.execute(select(EpUser).where(EpUser.username == body.username)
                             .with_for_update(of=EpUser))).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    hashed = user.password_hash if user else await asyncio.to_thread(dummy_hash)
    valid = await asyncio.to_thread(verify_password, body.password.get_secret_value(), hashed)
    if user is None:
        raise HTTPException(401, "Invalid credentials")
    if is_locked(user.locked_until, now):
        raise HTTPException(401, "Invalid credentials")
    if not valid or not user.is_active:
        user.failed_login_count, user.locked_until = failed_attempt(user.failed_login_count, user.locked_until, now)
        await commit(db)
        raise HTTPException(401, "Invalid credentials")
    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    await commit(db)
    return TokenResponse(access_token=issue_token(user.id, request.app.state.ep_secret),
                         must_change_password=user.must_change_password,
                         user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
async def me(actor=Depends(current_actor)):
    return actor


@router.patch("/me", response_model=UserRead)
async def update_me(body: UpdateMe, actor=Depends(current_actor), db: AsyncSession = Depends(get_db)):
    actor.display_name = body.display_name
    await commit(db)
    return actor


@router.post("/change-password", response_model=UserRead)
async def change_password(body: ChangePassword, actor=Depends(current_actor), db: AsyncSession = Depends(get_db)):
    user = (await db.execute(select(EpUser).where(EpUser.id == actor.id)
                             .with_for_update(of=EpUser).execution_options(populate_existing=True))).scalar_one()
    current, new = body.current_password.get_secret_value(), body.new_password.get_secret_value()
    if current == new or not await asyncio.to_thread(verify_password, current, user.password_hash):
        raise HTTPException(400, "Invalid password change")
    user.password_hash = await asyncio.to_thread(hash_password, new)
    user.must_change_password = False
    user.failed_login_count = 0
    user.locked_until = None
    await commit(db)
    return user
