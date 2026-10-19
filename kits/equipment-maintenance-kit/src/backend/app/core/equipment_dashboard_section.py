"""設備總覽區塊：登錄到儀表板（只有同時安裝儀表板 Kit 才會載入本檔）。"""

from app.core.dashboard_providers import register as register_section


class EquipmentSection:
    key = "equipment"
    title = "設備總覽"
    order = 20

    async def fetch(self, db, actor) -> dict:
        from app.api.routes_equipment import list_equipment  # 延後匯入：沿用路由的產線範圍過濾

        items = await list_equipment(include_inactive=False, actor=actor, db=db)
        blocked = [e for e in items if e.blocker]
        counts = {"可用": len(items) - len(blocked), "不可用": len(blocked)}
        rows = [{"設備": e.name, "原因": e.blocker} for e in blocked]
        return {"counts": counts, "rows": rows}


def register() -> None:
    register_section(EquipmentSection())
