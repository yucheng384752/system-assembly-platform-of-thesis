"""帳號 × 入口覆寫查詢。deps、即時連線與帳號管理共用同一份查詢。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.entry_points import EntryPoint, registry
from app.models.user import User
from app.models.user_entry_point_override import UserEntryPointOverride


async def entry_point_allows(user: User, entry_point: EntryPoint, db: AsyncSession) -> bool:
    """有覆寫紀錄就以紀錄為準；沒有就依入口的角色預設值。

    不可覆寫的入口一律只看角色，避免舊的覆寫紀錄繞過限制。
    """
    if entry_point.overridable:
        override = await db.scalar(
            select(UserEntryPointOverride).where(
                UserEntryPointOverride.user_id == user.id,
                UserEntryPointOverride.entry_point == entry_point.key,
            )
        )
        if override is not None:
            return override.allowed
    return user.role in entry_point.roles


async def entry_point_overrides_read(user: User, db: AsyncSession) -> dict[str, bool | None]:
    """每個可覆寫入口的目前覆寫值；None 表示沒有覆寫、依角色預設。"""
    rows = await db.scalars(
        select(UserEntryPointOverride).where(UserEntryPointOverride.user_id == user.id)
    )
    overrides = {row.entry_point: row.allowed for row in rows}
    return {ep.key: overrides.get(ep.key) for ep in registry.overridable()}
