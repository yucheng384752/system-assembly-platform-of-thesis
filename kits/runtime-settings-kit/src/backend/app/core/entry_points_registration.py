"""向 entry-permission-kit 註冊本 Kit 的入口。改值的權限依各參數自己的 edit_roles 判斷，不另開入口。"""

from app.core.entry_points import EntryPoint, registry
from app.core.roles import Role

KIT = "runtime-settings-kit"

# 匯出目前有效值（供留存或搬到另一個環境）：只限管理者。
SETTINGS_EXPORT = registry.register(
    EntryPoint(key="settings_export", label="匯出參數有效值", roles=(Role.admin,), owner_kit=KIT)
)
