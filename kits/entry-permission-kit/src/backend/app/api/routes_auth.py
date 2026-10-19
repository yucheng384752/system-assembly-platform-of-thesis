"""登入、本人資料、首次登入強制變更密碼。"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.login_guard import LoginGuard, LoginLockedError
from app.core.passwords import WeakPasswordError, validate_password_strength
from app.core.security import create_access_token, hash_password, verify_password
from app.core.user_read import user_read
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    TokenResponse,
    UpdateMeRequest,
    UserRead,
)

router = APIRouter(prefix="/auth", tags=["auth"])

login_guard = LoginGuard(
    max_attempts=settings.login_max_attempts,
    window=timedelta(minutes=settings.login_lockout_minutes),
)


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    try:
        login_guard.ensure_not_locked(body.username)
    except LoginLockedError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)
        ) from exc
    user = await db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        login_guard.record_failure(body.username)
        # 統一訊息，不洩漏帳號是否存在。
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="帳號或密碼錯誤"
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="帳號已停用")
    login_guard.reset(body.username)
    return TokenResponse(
        access_token=create_access_token(str(user.id)),
        must_change_password=user.must_change_password,
        user=await user_read(user, db),
    )


@router.get("/me", response_model=UserRead)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> UserRead:
    return await user_read(user, db)


@router.patch("/me", response_model=UserRead)
async def update_me(
    body: UpdateMeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user.display_name = body.display_name
    await db.commit()
    await db.refresh(user)
    return await user_read(user, db)


@router.post("/change-password", response_model=UserRead)
async def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    if not verify_password(body.current_password, user.password_hash):
        raise _bad_request("目前密碼錯誤")
    if body.new_password == body.current_password:
        raise _bad_request("新密碼不可與目前密碼相同")
    try:
        validate_password_strength(body.new_password)
    except WeakPasswordError as exc:
        raise _bad_request(str(exc)) from exc
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    await db.commit()
    await db.refresh(user)
    return await user_read(user, db)
