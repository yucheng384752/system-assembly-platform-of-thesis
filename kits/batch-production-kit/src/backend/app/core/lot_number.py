"""批號格式與流水號（純函式）。

來源系統把前綴、製程變體碼、廠區碼與位數寫死在程式裡。這裡改成可設定的樣板：

    {variant}  製程變體對應的代碼（由設定的對照表提供，沒有對照就用空字串）
    {region}   廠區碼
    {yy} {mm}  年、月（兩位數，依設定的時區）
    {serial}   流水號，可加格式，例如 {serial:03d}

樣板必須包含 `{serial}`。流水號依 (產線, 製程變體) 累加，不隨月份或年度歸零
（沿用來源系統已確認的規則）；是否歸零由設定 `serial_reset` 決定，預設 `never`。
"""

import re
from dataclasses import dataclass, field
from datetime import date

_ALLOWED = {"variant", "region", "yy", "mm", "serial"}
_FIELD = re.compile(r"\{(\w+)(?::[^}]*)?\}")


class LotNumberError(ValueError):
    pass


@dataclass(frozen=True)
class LotNumberFormat:
    pattern: str = "L{variant}{region}{yy}{mm}{serial:03d}"
    region_code: str = ""
    variant_codes: dict[str, str] = field(default_factory=dict)
    serial_reset: str = "never"  # never | monthly | yearly

    def validate(self) -> None:
        names = _FIELD.findall(self.pattern)
        unknown = set(names) - _ALLOWED
        if unknown:
            raise LotNumberError(f"批號樣板含未知欄位：{', '.join(sorted(unknown))}")
        if "serial" not in names:
            raise LotNumberError("批號樣板必須包含 {serial}")
        if self.serial_reset not in {"never", "monthly", "yearly"}:
            raise LotNumberError("serial_reset 必須是 never、monthly 或 yearly")


def format_lot_no(fmt: LotNumberFormat, variant: str | None, today: date, serial: int) -> str:
    fmt.validate()
    if serial < 1:
        raise LotNumberError("流水號必須從 1 開始")
    return fmt.pattern.format(
        variant=fmt.variant_codes.get(variant or "", ""),
        region=fmt.region_code,
        yy=f"{today.year % 100:02d}",
        mm=f"{today.month:02d}",
        serial=serial,
    )


def counter_period(fmt: LotNumberFormat, today: date) -> str:
    """計數器的期間鍵；never 時恆為空字串，monthly/yearly 隨期間換新計數。"""
    if fmt.serial_reset == "monthly":
        return f"{today.year:04d}{today.month:02d}"
    if fmt.serial_reset == "yearly":
        return f"{today.year:04d}"
    return ""
