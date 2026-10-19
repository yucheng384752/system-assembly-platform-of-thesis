"""啟動時呼叫一次：套用第二階段設定，把有啟用的子功能接上完成條件，回傳要掛上的路由。

    from app.core.extras_startup import enable_batch_extras
    for router in enable_batch_extras(raw, object_store=my_store):
        app.include_router(router)

object_store 只有啟用 attachments 時才需要；未提供時上傳端點回 501。
"""

from app.core import extension_points
from app.core.extras_settings import ExtrasSettings, configure, load_extras_settings


async def _has_warehouse_entry(db, batch_id: int) -> bool:
    from sqlalchemy import select
    from app.models.extras import WarehouseEntry
    return await db.scalar(select(WarehouseEntry.id).where(WarehouseEntry.batch_id == batch_id, WarehouseEntry.status == "submitted")) is not None


async def _uploaded_keys(db, batch_id: int) -> set[str]:
    from sqlalchemy import select
    from app.models.extras import BatchAttachment
    return set(await db.scalars(select(BatchAttachment.attachment_key).where(BatchAttachment.batch_id == batch_id)))


async def _pending_rework(db, batch_id: int) -> list[str]:
    from sqlalchemy import func, select
    from app.models.extras import ReworkRecord
    n = await db.scalar(select(func.count(ReworkRecord.id)).where(ReworkRecord.batch_id == batch_id, ReworkRecord.status == "pending")) or 0
    return [f"尚有 {n} 筆回鍋確認單待確認"] if n else []


def apply_settings(raw: dict | None = None, object_store=None) -> ExtrasSettings:
    """只做設定與插槽接線，不碰路由（可在沒有網頁框架的環境測試）。"""
    settings = load_extras_settings(raw or {})
    configure(settings)
    if "warehouse-entry" in settings.enabled:
        extension_points.has_warehouse_entry = _has_warehouse_entry
        extension_points.require_warehouse_entry = settings.require_warehouse_entry
    if "attachments" in settings.enabled:
        extension_points.uploaded_attachment_keys = _uploaded_keys
        if object_store is not None:
            extension_points.set_object_store(object_store)
    if "rework-record" in settings.enabled and settings.block_on_pending_rework and _pending_rework not in extension_points.completion_checks:
        extension_points.completion_checks.append(_pending_rework)
    return settings


def enable_batch_extras(raw: dict | None = None, object_store=None) -> list:
    from app.api.routes_extras import ROUTERS

    settings = apply_settings(raw, object_store)
    return [ROUTERS[name] for name in ("warehouse-entry", "rework-record", "batch-notes", "attachments") if name in settings.enabled]
