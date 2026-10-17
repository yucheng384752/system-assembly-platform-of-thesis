"""登入與入口權限的共用相依。其他 Kit 以 require_entry_point 保護自己的端點。"""

from collections.abc import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.entry_point_overrides import entry_point_allows
from app.core.entry_points import EntryPoint, registry
from app.core.roles import READ_ONLY_ROLES, Role
from app.core.security import decode_access_token
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

_FORBIDDEN = "權限不足"


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="無效或過期的憑證",
        headers={"WWW-Authenticate": "Bearer"},
    )
    subject = decode_access_token(token)
    if subject is None or not subject.isdigit():
        raise credentials_error
    user = db.get(User, int(subject))
    if user is None or not user.is_active:
        raise credentials_error
    return user


def require_password_changed(user: User = Depends(get_current_user)) -> User:
    """首次登入尚未變更密碼前，擋下所有受保護資源。"""
    if user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="首次登入需先變更密碼"
        )
    return user


def require_admin(user: User = Depends(require_password_changed)) -> User:
    """調整他人權限範圍的端點固定只限 admin，不走入口覆寫，避免權限迴圈。"""
    if user.role != Role.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_FORBIDDEN)
    return user


def require_entry_point(entry_point: EntryPoint) -> Callable[..., User]:
    def checker(
        user: User = Depends(require_password_changed),
        db: Session = Depends(get_db),
    ) -> User:
        if not entry_point_allows(user, entry_point, db):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_FORBIDDEN)
        return user

    return checker


def require_entry_point_or_tag(entry_point: EntryPoint, tag: str) -> Callable[..., User]:
    """指定入口，或任何帶有 tag 的已註冊入口允許即可放行。

    用途：帳號清單同時供帳號管理與「指派人員」使用；其他 Kit 以 tag 宣告
    需求，本 Kit 不必引用它們的入口常數。
    """

    def checker(
        user: User = Depends(require_password_changed),
        db: Session = Depends(get_db),
    ) -> User:
        candidates = (entry_point, *registry.with_tag(tag))
        if not any(entry_point_allows(user, ep, db) for ep in candidates):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_FORBIDDEN)
        return user

    return checker


def require_write_access(user: User = Depends(require_password_changed)) -> User:
    """多角色共用的寫入端點用此排除唯讀角色，不必重列允許清單。"""
    if user.role in READ_ONLY_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="唯讀帳號無法寫入"
        )
    return user
