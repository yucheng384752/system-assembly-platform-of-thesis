"""批次生產閘門：生產前設備必須可用。只有同時安裝批次生產 Kit 才會載入本檔。

`order=10`：比籠統的閘門先講。批次有指定設備時，原因直接指名那台設備；
沒指定且設定 `globalMode=line-equipment` 時，才檢查產線內全部設備。
"""

from app.core.equipment_service import equipment_in_scope, facts_for, find_equipment
from app.core.equipment_settings import get_settings
from app.core.gate_rules import blocker, global_blocker
from app.core.gates import BatchContext, GateBase, gates


class EquipmentCheckGate(GateBase):
    key = "equipment.check"
    order = 10

    async def write_blocker(self, ctx: BatchContext, station_code: str) -> str | None:
        s = get_settings()
        if s.gated_stations is not None and station_code not in s.gated_stations:
            return None
        args = (s.required_frequencies, s.require_review, s.block_on_abnormal)
        if ctx.equipment_ref:
            eq = await find_equipment(ctx.db, ctx.equipment_ref)
            if eq is None:
                return f"設備 {ctx.equipment_ref} 不在設備清單"
            return blocker(await facts_for(ctx.db, eq), *args)
        if s.global_mode == "line-equipment":
            return global_blocker([await facts_for(ctx.db, e) for e in await equipment_in_scope(ctx.db, ctx.product_line_code)], *args)
        return None


def register() -> None:
    gates.register(EquipmentCheckGate())
