"""第二階段子功能（入庫單、回鍋單、備註、附件）掛入完成條件的插槽。

預設為「沒有入庫單、沒有附件」。選用對應子功能時，該子功能在載入時覆寫這幾個函式，
批次生產核心不需要認得入庫單或附件的資料表。
"""

from collections.abc import Callable
from typing import Any

uploaded_attachment_keys: Callable[[Any, int], set[str]] = lambda db, batch_id: set()
has_warehouse_entry: Callable[[Any, int], bool] = lambda db, batch_id: False
require_warehouse_entry: bool = False

# 其他完成前檢查（例如待確認的回鍋單）：每個函式回傳「還缺什麼」的文字清單。
completion_checks: list[Callable[[Any, int], list[str]]] = []

# 物件儲存：照片實際放哪裡由平台提供（連線資訊以引用方式在部署時給），本 Kit 只保存參照。
# 介面：put(batch_id, filename, content_type, data) -> ref；delete(ref)；url(ref) -> str | None
object_store: Any = None


def set_object_store(store: Any) -> None:
    global object_store
    object_store = store
