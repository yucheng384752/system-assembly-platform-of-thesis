"""向 entry-permission-kit 註冊本 Kit 的入口。點檢送出與報修是一般寫入，用 require_write_access。"""

from app.core.entry_points import EntryPoint, registry
from app.core.roles import Role

KIT = "equipment-maintenance-kit"

# 設備清單與點檢表維護、月度匯出。
EQUIPMENT_MANAGE = registry.register(
    EntryPoint(key="equipment_manage", label="設備與點檢表管理", roles=(Role.manager, Role.admin), owner_kit=KIT)
)
# 點檢複核。
EQUIPMENT_REVIEW = registry.register(
    EntryPoint(key="equipment_review", label="點檢複核", roles=(Role.qc, Role.manager, Role.admin), owner_kit=KIT)
)
# 結案維修單。
REPAIR_CLOSE = registry.register(
    EntryPoint(key="repair_close", label="維修結案", roles=(Role.manager, Role.admin), owner_kit=KIT)
)
