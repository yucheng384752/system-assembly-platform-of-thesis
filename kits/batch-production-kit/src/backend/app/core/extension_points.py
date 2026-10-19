"""第二階段子功能（入庫單、回鍋單、備註、附件）掛入完成條件的插槽。

預設為「沒有入庫單、沒有附件」。選用對應子功能時，該子功能在載入時覆寫這幾個函式，
批次生產核心不需要認得入庫單或附件的資料表。插槽函式一律為 async (db, batch_id)。
"""

from collections.abc import Awaitable, Callable
from typing import Any



async def _no_attachments(db: Any, batch_id: int) -> set[str]:
    return set()


async def _no_warehouse_entry(db: Any, batch_id: int) -> bool:
    return False


uploaded_attachment_keys: Callable[[Any, int], Awaitable[set[str]]] = _no_attachments
has_warehouse_entry: Callable[[Any, int], Awaitable[bool]] = _no_warehouse_entry
require_warehouse_entry: bool = False

# 其他完成前檢查（例如待確認的回鍋單）：每個函式回傳「還缺什麼」的文字清單。
completion_checks: list[Callable[[Any, int], Awaitable[list[str]]]] = []

# 物件儲存：照片實際放哪裡由平台提供（連線資訊以引用方式在部署時給），本 Kit 只保存參照。
# 介面：put(batch_id, filename, content_type, data) -> ref；delete(ref)；url(ref) -> str | None
# 物件儲存維持同步介面（平台提供）；若實作會阻塞，請由平台自行改以執行緒執行。
object_store: Any = None


def set_object_store(store: Any) -> None:
    global object_store
    object_store = store
