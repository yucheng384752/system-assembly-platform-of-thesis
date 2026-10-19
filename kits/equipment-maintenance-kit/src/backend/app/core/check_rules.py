"""點檢項目的判斷與狀態轉換（純函式）。

項目有兩種：
- bool：勾選代表正常；沒勾（False）算異常。
- num：數值，超出上下限算異常；上下限可只填一邊。
必填項目沒填不能送出；有異常項目就必須寫說明；複核者預設不能是點檢者本人。
"""

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation


class CheckError(ValueError):
    pass


@dataclass(frozen=True)
class ItemDef:
    key: str
    label: str
    kind: str = "bool"
    unit: str | None = None
    low: Decimal | None = None
    high: Decimal | None = None
    required: bool = True

    def __post_init__(self) -> None:
        if self.kind not in ("bool", "num"):
            raise CheckError(f"{self.key}：kind 必須是 bool 或 num")
        if self.low is not None and self.high is not None and self.low > self.high:
            raise CheckError(f"{self.key}：下限不可大於上限")


@dataclass(frozen=True)
class Evaluation:
    abnormal: tuple[str, ...] = ()
    normalized: dict = field(default_factory=dict)


def _num(item: ItemDef, raw) -> Decimal:
    if isinstance(raw, bool):
        raise CheckError(f"「{item.label}」必須是數字")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as exc:
        raise CheckError(f"「{item.label}」必須是數字") from exc
    if not value.is_finite():
        raise CheckError(f"「{item.label}」必須是有效數字")
    return value


def evaluate(items: list[ItemDef], results: dict, note: str | None) -> Evaluation:
    """回傳異常清單與正規化後的結果；不合法就丟 CheckError（訊息可直接顯示給使用者）。"""
    by_key = {i.key: i for i in items}
    unknown = set(results) - set(by_key)
    if unknown:
        raise CheckError(f"不在點檢表的項目：{', '.join(sorted(unknown))}")
    missing = [i.label for i in items if i.required and results.get(i.key) is None]
    if missing:
        raise CheckError(f"尚有必填項目未填：{'、'.join(missing)}")
    abnormal: list[str] = []
    normalized: dict = {}
    for item in items:
        raw = results.get(item.key)
        if raw is None:
            continue
        if item.kind == "bool":
            if not isinstance(raw, bool):
                raise CheckError(f"「{item.label}」必須是勾選（是／否）")
            normalized[item.key] = raw
            if not raw:
                abnormal.append(f"{item.label}異常")
            continue
        value = _num(item, raw)
        normalized[item.key] = str(value)
        u = item.unit or ""
        if (item.low is not None and value < item.low) or (item.high is not None and value > item.high):
            abnormal.append(f"{item.label} {value.normalize():f}{u} 超出範圍")
    if abnormal and not (note and note.strip()):
        raise CheckError("有異常項目，請填寫說明")
    return Evaluation(tuple(abnormal), normalized)


def validate_review(performed_by: int, reviewer: int, status: str, must_differ: bool) -> None:
    if status != "submitted":
        raise CheckError("只有已送出的點檢可以複核")
    if must_differ and performed_by == reviewer:
        raise CheckError("複核者不可是點檢者本人")


def can_resubmit(status: str | None) -> bool:
    """同一期別重送：尚未複核前可覆寫，複核後鎖定。"""
    return status in (None, "submitted")
