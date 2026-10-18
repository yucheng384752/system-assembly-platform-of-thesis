"""向 entry-permission-kit 註冊本 Kit 的入口。"""

from app.core.entry_points import EntryPoint, registry
from app.core.roles import Role

KIT = "alarm-exception-kit"

# 確認報警：主管與管理者。
ALARM_MANAGE = registry.register(
    EntryPoint(key="alarm_manage", label="報警確認", roles=(Role.manager, Role.admin), owner_kit=KIT)
)

# 異常簽核（核准重工／特採／駁回）：只限管理者，沿用來源系統已確認的規則。
EXCEPTION_DECIDE = registry.register(
    EntryPoint(key="exception_decide", label="異常簽核", roles=(Role.admin,), owner_kit=KIT)
)
