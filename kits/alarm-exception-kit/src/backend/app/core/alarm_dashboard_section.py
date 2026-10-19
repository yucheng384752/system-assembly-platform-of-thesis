"""報警總覽區塊：登錄到儀表板（只有同時安裝儀表板 Kit 才會載入本檔）。"""

from app.core.dashboard_providers import register as register_section


class AlarmSection:
    key = "alarm"
    title = "報警總覽"
    order = 10

    async def fetch(self, db, actor) -> dict:
        from app.api.routes_alarms import list_alarms  # 延後匯入：沿用路由的可見性過濾

        items = await list_alarms(status_filter="unresolved", batch_id=None, limit=200, actor=actor, db=db)
        counts = {"待處理": sum(1 for a in items if a.status == "active"), "已確認未解除": sum(1 for a in items if a.status == "acknowledged")}
        rows = [{"批號": a.batch_label, "訊息": a.message, "狀態": a.status} for a in items]
        return {"counts": counts, "rows": rows}


def register() -> None:
    register_section(AlarmSection())
