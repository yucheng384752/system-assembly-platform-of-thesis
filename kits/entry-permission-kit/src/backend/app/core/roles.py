"""帳號角色。角色只是預設白名單，實際能否使用某入口以 entry_points 判斷。"""

from enum import Enum


class Role(str, Enum):
    operator = "operator"
    qc = "qc"
    manager = "manager"
    admin = "admin"
    # 稽核：唯讀角色。不得出現在任何入口的角色清單，也不得被覆寫成可寫入。
    audit = "audit"


READ_ONLY_ROLES: frozenset[Role] = frozenset({Role.audit})

# manager 只能建立與管理這些角色，不能建立 manager 或 admin。
MANAGER_MANAGEABLE_ROLES: tuple[Role, ...] = (Role.operator, Role.qc)
