"""報警與異常簽核設定（預設值中性：只啟用規格範圍，沒有門檻、一致性與關鍵量測）。

鍵：
- thresholdRules：[{key, metricKey, op: lt|le|gt|ge, limit, stationCode?}]
- consistencyRules：[{key, keys:[…], expectKey, offset?, stationCode?, labels?}]
- gating：{stationCode, metricKey, verificationLabel?}，最多一個關鍵量測；省略代表不使用異常簽核。
- severity：warning | critical，預設 warning。
- specRangeEnabled：是否套用規格範圍，預設 true。
- blockCompletion：尚有未解除報警時是否擋完成工單，預設 true。
被門檻或一致性規則涵蓋的項目，不再套用規格範圍（沿用來源系統：兩者語意不同，不重複報警）。
"""

from dataclasses import dataclass, field
from decimal import Decimal

from app.core.rules import ConsistencyRule, RuleConfigError, ThresholdRule

_KNOWN = {"thresholdRules", "consistencyRules", "gating", "severity", "specRangeEnabled", "blockCompletion"}


@dataclass(frozen=True)
class Gating:
    station_code: str
    metric_key: str
    verification_label: str = "加驗"


@dataclass(frozen=True)
class AlarmSettings:
    threshold_rules: tuple[ThresholdRule, ...] = ()
    consistency_rules: tuple[ConsistencyRule, ...] = ()
    gating: Gating | None = None
    severity: str = "warning"
    spec_range_enabled: bool = True
    block_completion: bool = True

    def covered_by_dedicated_rule(self, station_code: str, metric_key: str) -> bool:
        return any(r.matches(station_code, metric_key) for r in (*self.threshold_rules, *self.consistency_rules))


def load_alarm_settings(raw: dict) -> AlarmSettings:
    unknown = set(raw) - _KNOWN
    if unknown:
        raise RuleConfigError(f"未知的設定：{', '.join(sorted(unknown))}")
    severity = raw.get("severity", "warning")
    if severity not in {"warning", "critical"}:
        raise RuleConfigError("severity 必須是 warning 或 critical")
    thresholds = tuple(ThresholdRule(r["key"], r["metricKey"], r["op"], Decimal(str(r["limit"])), r.get("stationCode"))
                       for r in raw.get("thresholdRules", []))
    consistency = tuple(ConsistencyRule(r["key"], tuple(r["keys"]), r["expectKey"], Decimal(str(r.get("offset", 0))), r.get("stationCode"), dict(r.get("labels", {})))
                        for r in raw.get("consistencyRules", []))
    keys = [r.key for r in (*thresholds, *consistency)]
    if len(set(keys)) != len(keys) or "spec_range" in keys:
        raise RuleConfigError("規則 key 不可重複，且不可使用保留字 spec_range")
    g = raw.get("gating")
    gating = Gating(g["stationCode"], g["metricKey"], g.get("verificationLabel", "加驗")) if g else None
    return AlarmSettings(thresholds, consistency, gating, severity, bool(raw.get("specRangeEnabled", True)), bool(raw.get("blockCompletion", True)))


_current = AlarmSettings()


def configure(settings: AlarmSettings) -> None:
    global _current
    _current = settings


def get_settings() -> AlarmSettings:
    return _current
