"""批次事件匯流排（機制）。

批次生產 Kit 只負責「發出事實」，不知道誰在聽。報警、儀表板等 Kit 在載入時訂閱。
這取代來源系統在量測儲存流程裡直接新增報警資料列、直接呼叫儀表板更新的寫法。

規則：
- 處理函式同步執行，並與發出事件的請求共用同一個資料庫交易：訂閱者寫入失敗，
  整筆量測一併回復，不會出現「量測存了、報警沒開」的半套狀態。
- 處理函式依訂閱順序執行；任一函式拋出例外就中止並往外傳。
- 沒有任何訂閱者時，發出事件什麼都不做（沒選報警功能的系統照常運作）。
"""

from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class MeasurementRecorded:
    """一筆量測值已寫入（含重填覆寫）。規格上下限由發出方依型號解析好帶入，
    訂閱者不必再查產品定義。"""

    batch_id: int
    measurement_id: int
    product_line_code: str
    product_model_code: str
    station_code: str
    metric_key: str
    metric_label: str
    unit: str | None
    step_seq: int  # 0 代表不屬於任何步驟
    value_num: Decimal | None
    value_text: str | None
    value_bool: bool | None
    spec_low: Decimal | None
    spec_high: Decimal | None
    operator_id: int


@dataclass(frozen=True)
class BatchChanged:
    """批次資料有任何異動（建立、派工、量測、簽核、完成…）。不帶內容，訂閱者自行重新讀取。"""

    batch_id: int
    reason: str
    actor_id: int | None = None  # 誰做的；活動紀錄用。沒有帳號脈絡的異動為 None


Handler = Callable[[Any, Any], None]  # (db, event)


class EventBus:
    def __init__(self) -> None:
        self._handlers: dict[type, list[Handler]] = {}

    def subscribe(self, event_type: type, handler: Handler) -> None:
        handlers = self._handlers.setdefault(event_type, [])
        if handler in handlers:
            raise ValueError(f"{handler!r} 已訂閱 {event_type.__name__}")
        handlers.append(handler)

    def publish(self, db: Any, event: Any) -> None:
        for handler in tuple(self._handlers.get(type(event), ())):
            handler(db, event)

    def subscriber_count(self, event_type: type) -> int:
        return len(self._handlers.get(event_type, ()))


bus = EventBus()
