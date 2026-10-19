"""向 entry-permission-kit 註冊本 Kit 的入口。查看類端點只需登入，可見範圍由批次可見性決定。"""

from app.core.entry_points import EntryPoint, registry
from app.core.roles import Role

KIT = "production-dashboard-kit"

# 清除過期活動紀錄：只限管理者。
ACTIVITY_PURGE = registry.register(
    EntryPoint(key="activity_purge", label="清除過期活動紀錄", roles=(Role.admin,), owner_kit=KIT)
)
