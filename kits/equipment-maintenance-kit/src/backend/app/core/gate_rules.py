"""生產閘門的判斷（純函式）：某設備現在能不能用來生產。

事實由資料庫層整理成 EquipmentFacts 後傳入，這裡只下判斷，因此可以不接資料庫測試。
檢查順序固定：停用 → 維修中 → 各頻率點檢（由短到長）。回傳第一個原因，說法指名設備。
"""

from dataclasses import dataclass, field

from app.core.periods import FREQUENCIES, LABELS

MISSING, SUBMITTED, REVIEWED = "missing", "submitted", "reviewed"


@dataclass(frozen=True)
class CheckState:
    status: str = MISSING
    abnormal: bool = False


@dataclass(frozen=True)
class EquipmentFacts:
    code: str
    name: str
    active: bool = True
    open_repair: bool = False
    checks: dict[str, CheckState] = field(default_factory=dict)


def blocker(facts: EquipmentFacts, required: tuple[str, ...], require_review: bool, block_on_abnormal: bool) -> str | None:
    label = f"設備 {facts.name or facts.code}"
    if not facts.active:
        return f"{label}已停用"
    if facts.open_repair:
        return f"{label}維修中"
    for freq in FREQUENCIES:
        if freq not in required:
            continue
        state = facts.checks.get(freq, CheckState())
        if state.status == MISSING:
            return f"{label}尚未完成{LABELS[freq]}點檢"
        if require_review and state.status == SUBMITTED:
            return f"{label}的{LABELS[freq]}點檢尚待複核"
        if block_on_abnormal and state.abnormal and state.status != REVIEWED:
            return f"{label}的{LABELS[freq]}點檢有異常，需複核後才能使用"
    return None


def global_blocker(all_facts: list[EquipmentFacts], required: tuple[str, ...], require_review: bool, block_on_abnormal: bool, show: int = 5) -> str | None:
    """批次沒有指定設備時：範圍內的設備必須全部可用。"""
    bad = [f for f in all_facts if blocker(f, required, require_review, block_on_abnormal)]
    if not bad:
        return None
    names = "、".join(f.name or f.code for f in bad[:show])
    more = f" 等 {len(bad)} 台" if len(bad) > show else ""
    return f"尚有設備未通過點檢或維修中：{names}{more}"
