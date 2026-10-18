"""向 entry-permission-kit 註冊本 Kit 的入口與資源範圍類型。

載入本模組即完成註冊（重複註冊會報錯）。入口目錄與範圍機制由 entry-permission-kit
擁有，本 Kit 只宣告自己的部分。
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.entry_points import EntryPoint, registry
from app.core.roles import Role
from app.core.user_scopes import ScopeType, scope_types
from app.models.product_line import ProductLine

KIT = "product-process-kit"

PRODUCT_MODEL_MANAGE = registry.register(
    EntryPoint(
        key="product_model_manage",
        label="型號與配方管理（新增／修改／異動紀錄）",
        roles=(Role.manager, Role.admin),
        owner_kit=KIT,
    )
)

PRODUCT_LINE_SCOPE = "product-line"


def _missing_lines(db: Session, keys: set[str]) -> set[str]:
    found = set(db.scalars(select(ProductLine.code).where(ProductLine.code.in_(keys))))
    return keys - found


scope_types.register(
    ScopeType(
        key=PRODUCT_LINE_SCOPE,
        label="產線",
        owner_kit=KIT,
        scopable_roles=(Role.manager,),
        find_missing_keys=_missing_lines,
    )
)
