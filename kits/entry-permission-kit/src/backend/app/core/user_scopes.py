"""帳號資源範圍（機制）。

取代來源系統中直接以外鍵綁定產品的做法：本 Kit 不知道「產品線」是什麼，
只保存 (帳號, 範圍類型, 範圍鍵)。擁有該資源的 Kit 註冊範圍類型，並提供
「哪些鍵不存在」的檢查函式。沒有任何綁定代表不限制，不代表全部禁止。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.roles import Role
from app.models.user import User
from app.models.user_scope import UserScope

MissingKeysCheck = Callable[[AsyncSession, set[str]], Awaitable[set[str]]]  # async (db, 鍵) -> 不存在的鍵


class ScopeTypeError(ValueError):
    pass


@dataclass(frozen=True)
class ScopeType:
    key: str
    label: str
    owner_kit: str
    scopable_roles: tuple[Role, ...]
    find_missing_keys: MissingKeysCheck


class ScopeTypeRegistry:
    def __init__(self) -> None:
        self._items: dict[str, ScopeType] = {}

    def register(self, scope_type: ScopeType) -> ScopeType:
        if scope_type.key in self._items:
            raise ScopeTypeError(f"範圍類型 {scope_type.key} 已註冊")
        if not scope_type.scopable_roles:
            raise ScopeTypeError(f"範圍類型 {scope_type.key} 未指定可綁定的角色")
        self._items[scope_type.key] = scope_type
        return scope_type

    def get(self, key: str) -> ScopeType:
        try:
            return self._items[key]
        except KeyError as exc:
            raise ScopeTypeError(f"未知的範圍類型：{key}") from exc

    def all(self) -> tuple[ScopeType, ...]:
        return tuple(self._items.values())


scope_types = ScopeTypeRegistry()


async def scoped_keys(user: User, scope_type_key: str, db: AsyncSession) -> set[str] | None:
    """帳號在某範圍類型被限制的鍵；不可綁定的角色或沒有綁定時回傳 None（不限制）。"""
    scope_type = scope_types.get(scope_type_key)
    if user.role not in scope_type.scopable_roles:
        return None
    keys = set(
        await db.scalars(
            select(UserScope.scope_key).where(
                UserScope.user_id == user.id,
                UserScope.scope_type == scope_type_key,
            )
        )
    )
    return keys or None


async def scopes_read(user: User, db: AsyncSession) -> dict[str, list[str]]:
    rows = await db.scalars(select(UserScope).where(UserScope.user_id == user.id))
    result: dict[str, list[str]] = {st.key: [] for st in scope_types.all()}
    for row in rows:
        result.setdefault(row.scope_type, []).append(row.scope_key)
    return {key: sorted(values) for key, values in result.items()}
