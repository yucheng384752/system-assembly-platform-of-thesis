"""報警判斷規則（純函式）。

三種規則涵蓋來源系統的全部判斷，且都由設定提供，不寫死項目名稱與數值：

1. 規格範圍（預設啟用）：數值低於下限或高於上限即違規，邊界值合格。
2. 門檻規則：指定項目必須滿足某個關係（小於、不大於、大於、不小於）。
   「嚴格小於」與規格範圍的「含邊界」不同，所以獨立成規則。
3. 一致性規則：一組項目的數值必須彼此相等，且等於另一個項目加上固定偏移。
   跨欄位判斷，任一欄位尚未填寫時不下判斷（既不報警也不解除）。

判斷結果有三種狀態：ok、violated、incomplete（資料不足，維持現狀）。
"""

from dataclasses import dataclass, field
from decimal import Decimal

OK, VIOLATED, INCOMPLETE = "ok", "violated", "incomplete"
SPEC_RANGE_KEY = "spec_range"
_OPS = {
    "lt": ("小於", lambda v, x: v < x),
    "le": ("不大於", lambda v, x: v <= x),
    "gt": ("大於", lambda v, x: v > x),
    "ge": ("不小於", lambda v, x: v >= x),
}


class RuleConfigError(ValueError):
    pass


def fmt(value: Decimal | None) -> str:
    if value is None:
        return ""
    text = format(Decimal(value).normalize(), "f")
    return text


@dataclass(frozen=True)
class Outcome:
    state: str
    message: str = ""


@dataclass(frozen=True)
class ThresholdRule:
    key: str
    metric_key: str
    op: str
    limit: Decimal
    station_code: str | None = None

    def __post_init__(self) -> None:
        if self.op not in _OPS:
            raise RuleConfigError(f"{self.key}：op 必須是 {sorted(_OPS)}")

    def matches(self, station_code: str, metric_key: str) -> bool:
        return metric_key == self.metric_key and self.station_code in (None, station_code)

    def evaluate(self, label: str, unit: str | None, value: Decimal | None) -> Outcome:
        if value is None:
            return Outcome(OK)
        word, test = _OPS[self.op]
        if test(value, self.limit):
            return Outcome(OK)
        u = unit or ""
        return Outcome(VIOLATED, f"{label} {fmt(value)}{u} 超出規格 需{word}{fmt(self.limit)}{u}")


@dataclass(frozen=True)
class ConsistencyRule:
    key: str
    keys: tuple[str, ...]
    expect_key: str
    offset: Decimal = Decimal(0)
    station_code: str | None = None
    labels: dict[str, str] = field(default_factory=dict)

    def matches(self, station_code: str, metric_key: str) -> bool:
        return metric_key in (*self.keys, self.expect_key) and self.station_code in (None, station_code)

    @property
    def all_keys(self) -> list[str]:
        return [*self.keys, self.expect_key]

    def evaluate(self, values: dict[str, Decimal | None]) -> Outcome:
        if any(values.get(k) is None for k in self.all_keys):
            return Outcome(INCOMPLETE)
        expected = values[self.expect_key] + self.offset
        if all(values[k] == expected for k in self.keys):
            return Outcome(OK)
        name = lambda k: self.labels.get(k, k)
        shown = "／".join(f"{name(k)}{fmt(values[k])}" for k in self.all_keys)
        sign = f"+{fmt(self.offset)}" if self.offset > 0 else (fmt(self.offset) if self.offset < 0 else "")
        return Outcome(VIOLATED, f"{'／'.join(name(k) for k in self.keys)}需一致且等於{name(self.expect_key)}{sign}（{shown}）")


def evaluate_spec_range(label: str, unit: str | None, value: Decimal | None, low: Decimal | None, high: Decimal | None) -> Outcome:
    """沒有數值或沒有任何上下限時視為合格（不下判斷）。"""
    if value is None or (low is None and high is None):
        return Outcome(OK)
    out = (low is not None and value < low) or (high is not None and value > high)
    if not out:
        return Outcome(OK)
    u = unit or ""
    return Outcome(VIOLATED, f"{label} {fmt(value)}{u} 超出規格 {fmt(low)}~{fmt(high)}{u}")
