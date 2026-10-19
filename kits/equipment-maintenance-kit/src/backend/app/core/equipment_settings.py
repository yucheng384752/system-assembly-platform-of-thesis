"""設備點檢設定。預設中性：只要求每日點檢、不需複核、批次沒指定設備時不檢查。

鍵：
- requiredFrequencies：閘門要求哪些頻率都完成，預設 ["daily"]。
- requireReview：點檢送出後須複核才算完成，預設 false。
- reviewerMustDiffer：複核者不可是點檢者，預設 true。
- blockOnAbnormal：有異常的點檢在複核前擋住生產，預設 true。
- gatedStations：只擋這些站點的寫入；省略代表所有站點。
- globalMode：off | line-equipment。批次沒有指定設備時，line-equipment 要求該產線所有啟用中的設備都可用，預設 off。
- timezone：判斷「今天」的時區，預設 UTC。
"""

from dataclasses import dataclass

from app.core.periods import FREQUENCIES

_KNOWN = {"requiredFrequencies", "requireReview", "reviewerMustDiffer", "blockOnAbnormal", "gatedStations", "globalMode", "timezone"}


class SettingsError(ValueError):
    pass


@dataclass(frozen=True)
class EquipmentSettings:
    required_frequencies: tuple[str, ...] = ("daily",)
    require_review: bool = False
    reviewer_must_differ: bool = True
    block_on_abnormal: bool = True
    gated_stations: frozenset[str] | None = None
    global_mode: str = "off"
    timezone: str = "UTC"


def load_equipment_settings(raw: dict) -> EquipmentSettings:
    unknown = set(raw) - _KNOWN
    if unknown:
        raise SettingsError(f"未知的設定：{', '.join(sorted(unknown))}")
    freqs = tuple(raw.get("requiredFrequencies", ["daily"]))
    if not freqs or any(f not in FREQUENCIES for f in freqs):
        raise SettingsError(f"requiredFrequencies 只能包含 {list(FREQUENCIES)} 且不可為空")
    mode = raw.get("globalMode", "off")
    if mode not in ("off", "line-equipment"):
        raise SettingsError("globalMode 必須是 off 或 line-equipment")
    stations = raw.get("gatedStations")
    return EquipmentSettings(freqs, bool(raw.get("requireReview", False)), bool(raw.get("reviewerMustDiffer", True)),
                             bool(raw.get("blockOnAbnormal", True)), None if stations is None else frozenset(stations), mode,
                             str(raw.get("timezone", "UTC")))


_current = EquipmentSettings()


def configure(settings: EquipmentSettings) -> None:
    global _current
    _current = settings


def get_settings() -> EquipmentSettings:
    return _current
