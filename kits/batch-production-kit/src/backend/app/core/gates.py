"""批次閘門（機制）。

其他 Kit 可以在批次流程的三個位置插入條件，批次生產 Kit 不認識它們：

1. `write_blocker`：寫入某站點量測前，回傳拒絕原因（例如設備點檢未完成）。
   `validate_value`：同一時機，但已知要寫的項目與數值（例如關鍵量測必須是有效數字）。
2. `station_blocked`：判斷某站點是否因外部條件視為「未完成」（例如初始量測異常尚未放行）。
3. `completion_blockers`：完成工單前額外的阻擋原因（例如尚有未結案報警）。

閘門依 `order` 由小到大執行，數字小的先檢查，因此「指明是哪台設備」的精確閘門
可排在籠統的全域閘門之前，使用者看到的是最具體的原因（沿用來源系統的行為）。
沒有註冊任何閘門時全部放行。

閘門方法一律為 async（會查資料庫，與請求共用同一個 AsyncSession）。
"""

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class BatchContext:
    db: Any
    batch_id: int
    product_line_code: str
    product_model_code: str
    equipment_ref: str | None
    status: str


class BatchGate(Protocol):
    key: str
    order: int

    async def write_blocker(self, ctx: BatchContext, station_code: str) -> str | None: ...
    async def validate_value(self, ctx: BatchContext, station_code: str, metric_key: str, value_num: Any,
                             spec_low: Any, spec_high: Any) -> str | None: ...
    async def station_blocked(self, ctx: BatchContext, station_code: str) -> bool: ...
    async def completion_blockers(self, ctx: BatchContext) -> list[str]: ...


class GateBase:
    """子類別只需覆寫用得到的方法。"""

    key = ""
    order = 100

    async def write_blocker(self, ctx: BatchContext, station_code: str) -> str | None:
        return None

    async def validate_value(self, ctx: BatchContext, station_code: str, metric_key: str, value_num: Any,
                             spec_low: Any, spec_high: Any) -> str | None:
        return None

    async def station_blocked(self, ctx: BatchContext, station_code: str) -> bool:
        return False

    async def completion_blockers(self, ctx: BatchContext) -> list[str]:
        return []


class GateRegistry:
    def __init__(self) -> None:
        self._gates: dict[str, BatchGate] = {}

    def register(self, gate: BatchGate) -> BatchGate:
        if not gate.key:
            raise ValueError("閘門缺少 key")
        if gate.key in self._gates:
            raise ValueError(f"閘門 {gate.key} 已註冊")
        self._gates[gate.key] = gate
        return gate

    def _ordered(self) -> list[BatchGate]:
        return sorted(self._gates.values(), key=lambda g: (g.order, g.key))

    async def write_blocker(self, ctx: BatchContext, station_code: str) -> str | None:
        for gate in self._ordered():
            reason = await gate.write_blocker(ctx, station_code)
            if reason:
                return reason
        return None

    async def validate_value(self, ctx: BatchContext, station_code: str, metric_key: str, value_num: Any,
                             spec_low: Any, spec_high: Any) -> str | None:
        for gate in self._ordered():
            reason = await gate.validate_value(ctx, station_code, metric_key, value_num, spec_low, spec_high)
            if reason:
                return reason
        return None

    async def station_blocked(self, ctx: BatchContext, station_code: str) -> bool:
        for gate in self._ordered():
            if await gate.station_blocked(ctx, station_code):
                return True
        return False

    async def completion_blockers(self, ctx: BatchContext) -> list[str]:
        out: list[str] = []
        for gate in self._ordered():
            out.extend(await gate.completion_blockers(ctx))
        return out

    def keys(self) -> list[str]:
        return [g.key for g in self._ordered()]


gates = GateRegistry()
