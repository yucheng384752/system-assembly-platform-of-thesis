"""帳號管理、入口覆寫與資源範圍。

調整他人權限（入口覆寫、資源範圍）固定只限 admin，不走入口覆寫機制本身，
避免覆寫系統被用來替自己擴權。
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin, require_entry_point, require_entry_point_or_tag
from app.core.database import get_db
from app.core.entry_points import USER_DIRECTORY_TAG, USER_MANAGE, registry
from app.core.passwords import WeakPasswordError, validate_password_strength
from app.core.roles import MANAGER_MANAGEABLE_ROLES, READ_ONLY_ROLES, Role
from app.core.security import hash_password
from app.core.user_read import user_read
from app.core.user_scopes import ScopeTypeError, scope_types
from app.models.user import User
from app.models.user_entry_point_override import UserEntryPointOverride
from app.models.user_scope import UserScope
from app.schemas.auth import UserRead
from app.schemas.user import (
    EntryPointOverridesUpdate,
    ResetPasswordRequest,
    UserCreate,
    UserScopesUpdate,
    UserUpdate,
)

router = APIRouter(prefix="/users", tags=["users"])


def _error(code: int, detail: str) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _get_user(user_id: int, db: Session) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise _error(status.HTTP_404_NOT_FOUND, "帳號不存在")
    return target


def _get_managed_target(user_id: int, actor: User, db: Session) -> User:
    """manager 只能管理可管理角色；admin 可管理所有人。"""
    target = _get_user(user_id, db)
    if actor.role == Role.manager and target.role not in MANAGER_MANAGEABLE_ROLES:
        raise _error(status.HTTP_403_FORBIDDEN, "管理者僅能管理現場操作員與品管人員")
    return target


def _ensure_strong(password: str) -> None:
    try:
        validate_password_strength(password)
    except WeakPasswordError as exc:
        raise _error(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    body: UserCreate,
    actor: User = Depends(require_entry_point(USER_MANAGE)),
    db: Session = Depends(get_db),
) -> UserRead:
    if actor.role == Role.manager and body.role not in MANAGER_MANAGEABLE_ROLES:
        raise _error(status.HTTP_403_FORBIDDEN, "管理者僅能建立現場操作員與品管人員")
    if db.scalar(select(User).where(User.username == body.username)) is not None:
        raise _error(status.HTTP_409_CONFLICT, "帳號已存在")
    _ensure_strong(body.password)
    user = User(
        username=body.username,
        display_name=body.display_name,
        employee_no=body.employee_no,
        password_hash=hash_password(body.password),
        role=body.role,
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user_read(user, db)


@router.get("", response_model=list[UserRead])
def list_users(
    _: User = Depends(require_entry_point_or_tag(USER_MANAGE, USER_DIRECTORY_TAG)),
    db: Session = Depends(get_db),
) -> list[UserRead]:
    users = db.scalars(select(User).order_by(User.id)).all()
    return [user_read(u, db) for u in users]


def _apply_role_change(target: User, actor: User, role: Role) -> None:
    if actor.role != Role.admin:
        raise _error(status.HTTP_403_FORBIDDEN, "僅 admin 可變更角色")
    if target.id == actor.id:
        raise _error(status.HTTP_400_BAD_REQUEST, "不可變更自己的角色")
    target.role = role


def _apply_active_change(target: User, actor: User, is_active: bool) -> None:
    if target.id == actor.id and not is_active:
        raise _error(status.HTTP_400_BAD_REQUEST, "不可停用自己的帳號")
    target.is_active = is_active


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    body: UserUpdate,
    actor: User = Depends(require_entry_point(USER_MANAGE)),
    db: Session = Depends(get_db),
) -> UserRead:
    target = _get_managed_target(user_id, actor, db)
    if body.display_name is not None:
        target.display_name = body.display_name
    if body.employee_no is not None:
        target.employee_no = body.employee_no
    if body.role is not None:
        _apply_role_change(target, actor, body.role)
    if body.is_active is not None:
        _apply_active_change(target, actor, body.is_active)
    db.commit()
    db.refresh(target)
    return user_read(target, db)


@router.post("/{user_id}/reset-password", response_model=UserRead)
def reset_password(
    user_id: int,
    body: ResetPasswordRequest,
    actor: User = Depends(require_entry_point(USER_MANAGE)),
    db: Session = Depends(get_db),
) -> UserRead:
    target = _get_managed_target(user_id, actor, db)
    _ensure_strong(body.new_password)
    target.password_hash = hash_password(body.new_password)
    target.must_change_password = True
    db.commit()
    db.refresh(target)
    return user_read(target, db)


@router.put("/{user_id}/scopes/{scope_type}", response_model=UserRead)
def update_user_scopes(
    user_id: int,
    scope_type: str,
    body: UserScopesUpdate,
    actor: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserRead:
    target = _get_user(user_id, db)
    try:
        declared = scope_types.get(scope_type)
    except ScopeTypeError as exc:
        raise _error(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    if target.role not in declared.scopable_roles:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"此帳號的角色不可設定「{declared.label}」範圍",
        )
    keys = set(body.keys)
    missing = declared.find_missing_keys(db, keys) if keys else set()
    if missing:
        raise _error(status.HTTP_404_NOT_FOUND, f"{declared.label}不存在：{sorted(missing)}")
    db.execute(
        delete(UserScope).where(
            UserScope.user_id == target.id, UserScope.scope_type == scope_type
        )
    )
    for key in sorted(keys):
        db.add(UserScope(user_id=target.id, scope_type=scope_type, scope_key=key, assigned_by=actor.id))
    db.commit()
    return user_read(target, db)


def _upsert_override(target: User, key: str, allowed: bool | None, actor: User, db: Session) -> None:
    existing = db.scalar(
        select(UserEntryPointOverride).where(
            UserEntryPointOverride.user_id == target.id,
            UserEntryPointOverride.entry_point == key,
        )
    )
    if allowed is None:
        if existing is not None:
            db.delete(existing)
        return
    if existing is not None:
        existing.allowed = allowed
        existing.assigned_by = actor.id
        return
    db.add(UserEntryPointOverride(user_id=target.id, entry_point=key, allowed=allowed, assigned_by=actor.id))


@router.put("/{user_id}/entry-point-overrides", response_model=UserRead)
def update_entry_point_overrides(
    user_id: int,
    body: EntryPointOverridesUpdate,
    actor: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserRead:
    target = _get_user(user_id, db)
    if target.role in READ_ONLY_ROLES:
        raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "唯讀帳號不可設定入口覆寫")
    overridable = {ep.key for ep in registry.overridable()}
    unknown = set(body.overrides) - overridable
    if unknown:
        raise _error(status.HTTP_422_UNPROCESSABLE_ENTITY, f"未知或不可覆寫的入口：{sorted(unknown)}")
    for key, allowed in body.overrides.items():
        _upsert_override(target, key, allowed, actor, db)
    db.commit()
    return user_read(target, db)


@router.get("/entry-points")
def list_entry_points(_: User = Depends(require_admin)) -> list[dict[str, object]]:
    """admin 覆寫畫面用的入口目錄；前端不再自行維護一份清單。"""
    return [
        {"key": ep.key, "label": ep.label, "roles": [r.value for r in ep.roles], "ownerKit": ep.owner_kit}
        for ep in registry.overridable()
    ]
