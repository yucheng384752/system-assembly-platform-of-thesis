"""有效值的四層優先順序（純函式）：場域鎖定 > 上線後調整 > 組裝期設定 > 功能預設。

場域鎖定有兩種：固定值（fixed）直接取代；範圍（min／max）收窄可調範圍。
下層的值若不在目前的場域範圍內（例如場域設定後來才收窄），該層視為無效並退回更下層，
不會讓系統運作在不合規的值上。
"""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from app.core.param_defs import ParamDef, ParamError, check_value

SITE, RUNTIME, SYSTEM, DEFAULT = "site", "runtime", "system", "default"
SOURCE_LABELS = {SITE: "由場域鎖定", RUNTIME: "上線後調整", SYSTEM: "系統設定", DEFAULT: "功能預設"}


@dataclass(frozen=True)
class SiteLock:
    fixed: Any = None
    min: Decimal | None = None
    max: Decimal | None = None

    @property
    def locks_value(self) -> bool:
        return self.fixed is not None


def validate_site_lock(defn: ParamDef, lock: SiteLock) -> None:
    if lock.fixed is not None:
        check_value(defn, lock.fixed)
    if lock.min is not None and lock.max is not None and lock.min > lock.max:
        raise ParamError(f"{defn.key}：場域範圍的 min 不可大於 max")
    if (lock.min is not None or lock.max is not None) and defn.type != "num":
        raise ParamError(f"{defn.key}：只有數字參數可以設定場域範圍")


def _ok(defn: ParamDef, lock: SiteLock | None, value: Any) -> bool:
    try:
        check_value(defn, value, lock.min if lock else None, lock.max if lock else None)
        return True
    except ParamError:
        return False


def resolve(defn: ParamDef, runtime: Any, lock: SiteLock | None) -> tuple[Any, str]:
    if lock is not None and lock.locks_value:
        return check_value(defn, lock.fixed), SITE
    if runtime is not None and _ok(defn, lock, runtime):
        return check_value(defn, runtime), RUNTIME
    if defn.system is not None and _ok(defn, lock, defn.system):
        return check_value(defn, defn.system), SYSTEM
    return check_value(defn, defn.default), DEFAULT


def bounds(defn: ParamDef, lock: SiteLock | None) -> tuple[Decimal | None, Decimal | None]:
    """對外顯示的可調範圍：定義與場域限制的交集。"""
    lows = [b for b in (defn.min, lock.min if lock else None) if b is not None]
    highs = [b for b in (defn.max, lock.max if lock else None) if b is not None]
    return (max(lows) if lows else None, min(highs) if highs else None)
