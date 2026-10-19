"""本 Kit 的設定。

鍵：
- siteLocks：場域鎖定 {參數key: {"fixed": 值} 或 {"min": 數字, "max": 數字}}；預設空。
- requireReasonFrom：風險達到哪一級以上改值必須填原因（never | high | medium | all），預設 medium。
"""

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from app.core.layers import SiteLock
from app.core.policy import REASON_LEVELS

_KNOWN = {"siteLocks", "requireReasonFrom"}


class RuntimeConfigError(ValueError):
    pass


@dataclass(frozen=True)
class RuntimeConfig:
    site_locks: dict[str, SiteLock] = field(default_factory=dict)
    require_reason_from: str = "medium"


def _dec(raw, what):
    try:
        return None if raw is None else Decimal(str(raw))
    except InvalidOperation as exc:
        raise RuntimeConfigError(f"{what}必須是數字") from exc


def load_runtime_config(raw: dict) -> RuntimeConfig:
    unknown = set(raw) - _KNOWN
    if unknown:
        raise RuntimeConfigError(f"未知的設定：{', '.join(sorted(unknown))}")
    level = raw.get("requireReasonFrom", "medium")
    if level not in REASON_LEVELS:
        raise RuntimeConfigError(f"requireReasonFrom 必須是 {list(REASON_LEVELS)}")
    locks: dict[str, SiteLock] = {}
    for key, item in dict(raw.get("siteLocks", {})).items():
        extra = set(item) - {"fixed", "min", "max"}
        if extra or not item:
            raise RuntimeConfigError(f"{key}：場域鎖定只能有 fixed、min、max")
        if "fixed" in item and ("min" in item or "max" in item):
            raise RuntimeConfigError(f"{key}：fixed 與範圍不可同時設定")
        locks[key] = SiteLock(item.get("fixed"), _dec(item.get("min"), f"{key} 的 min"), _dec(item.get("max"), f"{key} 的 max"))
    return RuntimeConfig(locks, level)


_current = RuntimeConfig()


def configure(config: RuntimeConfig) -> None:
    global _current
    _current = config


def get_config() -> RuntimeConfig:
    return _current
