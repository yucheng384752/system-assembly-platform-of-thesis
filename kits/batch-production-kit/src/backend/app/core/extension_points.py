"""第二階段子功能（入庫單、附件）掛入完成條件的插槽。

預設為「沒有入庫單、沒有附件」。選用對應子功能時，該子功能在載入時覆寫這幾個函式，
批次生產核心不需要認得入庫單或附件的資料表。
"""

from collections.abc import Callable
from typing import Any

uploaded_attachment_keys: Callable[[Any, int], set[str]] = lambda db, batch_id: set()
has_warehouse_entry: Callable[[Any, int], bool] = lambda db, batch_id: False
require_warehouse_entry: bool = False
