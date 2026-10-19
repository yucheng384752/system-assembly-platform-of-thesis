"""誰能改哪個參數、改的時候要補什麼（純函式）。"""

from app.core.layers import SiteLock
from app.core.param_defs import ParamDef

REASON_LEVELS = {"never": (), "high": ("high",), "medium": ("medium", "high"), "all": ("low", "medium", "high")}


class PolicyError(ValueError):
    pass


def can_edit(defn: ParamDef, role: str, lock: SiteLock | None) -> tuple[bool, str]:
    """回傳 (能不能改, 不能改的原因)。能改時原因為空字串。"""
    if defn.kind != "value":
        return False, "這類變更需要開發或資料庫遷移，不能在介面修改"
    if not defn.runtime_editable:
        return False, "此參數只能在組裝時設定"
    if lock is not None and lock.locks_value:
        return False, "由場域鎖定，不能修改"
    if role not in defn.edit_roles:
        return False, "此角色沒有修改權限"
    return True, ""


def check_reason(defn: ParamDef, reason: str | None, require_from: str) -> str | None:
    """依設定決定風險達到哪一級以上必須填原因；回傳整理後的原因。"""
    if require_from not in REASON_LEVELS:
        raise PolicyError(f"requireReasonFrom 必須是 {list(REASON_LEVELS)}")
    text = (reason or "").strip()
    if defn.risk in REASON_LEVELS[require_from] and not text:
        raise PolicyError("此參數的風險等級需要填寫變更原因")
    if len(text) > 500:
        raise PolicyError("變更原因最多 500 字")
    return text or None


def check_version(current: int, expected: int | None) -> None:
    """樂觀鎖：畫面載入後別人已改過就拒絕，避免互相覆蓋。第一次設定時 current 為 0。"""
    if expected is not None and expected != current:
        raise PolicyError("這個參數剛被其他人修改，請重新載入後再改")
