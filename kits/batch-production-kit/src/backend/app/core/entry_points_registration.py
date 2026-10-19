"""向 entry-permission-kit 註冊本 Kit 的入口與資源範圍使用。"""

from app.core.entry_points import USER_DIRECTORY_TAG, EntryPoint, registry
from app.core.roles import Role

KIT = "batch-production-kit"

# 開單、完成、刪除；同時需要讀帳號清單來指派人員，以 tag 宣告而不引用帳號 Kit 的入口常數。
BATCH_MANAGE = registry.register(
    EntryPoint(
        key="batch_manage",
        label="批次管理（開單／完成／刪除）",
        roles=(Role.manager, Role.admin),
        owner_kit=KIT,
        tags=frozenset({USER_DIRECTORY_TAG}),
    )
)

# 派工只限 manager，不含 admin（沿用來源系統已確認的規則）。
BATCH_DISPATCH = registry.register(
    EntryPoint(
        key="batch_dispatch",
        label="批次派工",
        roles=(Role.manager,),
        owner_kit=KIT,
    )
)

# 確認回鍋單：manager 與 admin（第二階段）。
REWORK_CONFIRM = registry.register(
    EntryPoint(key="rework_confirm", label="回鍋單確認", roles=(Role.manager, Role.admin), owner_kit=KIT)
)
