"""型號配方明細的理論用量計算（純函式，不碰資料庫）。

來源系統把「主料、輔料、添加劑」的拆算寫死在開單流程裡，欄位也是行業專屬名稱。
這裡改成通用的配方明細：每一行有 key、比例與比例基準，餘量行吃掉總重扣除其他行
之後的剩餘。批次生產 Kit 只呼叫 `compute_theoretical`，不需要知道配方長什麼樣。

規則：
- `ratio_base="total"`：比例以總重為基準。
- `ratio_base=<另一行的 key>`：比例以那一行的用量為基準（例如添加劑佔輔料的比例）。
- `is_remainder=True`：用量 = 總重 − 其他所有行的用量；最多一行，且不可同時給比例。
- 沒有任何比例資料的型號，回傳空清單，使用者照舊手動填寫，不擋流程。
"""

from dataclasses import dataclass
from decimal import Decimal

TOTAL = "total"


class RecipeError(ValueError):
    """配方明細不合法。"""


@dataclass(frozen=True)
class RecipeLine:
    key: str
    label: str
    item_no: str | None = None
    ratio_pct: Decimal | None = None
    ratio_base: str = TOTAL
    is_remainder: bool = False


@dataclass(frozen=True)
class TheoreticalLine:
    key: str
    label: str
    item_no: str | None
    weight: Decimal


def validate_lines(lines: list[RecipeLine]) -> None:
    keys = [line.key for line in lines]
    if len(set(keys)) != len(keys):
        raise RecipeError("配方明細的 key 不可重複")
    if TOTAL in keys:
        raise RecipeError(f"配方明細不可使用保留字 {TOTAL!r} 當 key")
    remainders = [line for line in lines if line.is_remainder]
    if len(remainders) > 1:
        raise RecipeError("餘量行最多一行")
    for line in lines:
        if line.is_remainder and line.ratio_pct is not None:
            raise RecipeError(f"{line.key}：餘量行不可同時指定比例")
        if line.ratio_pct is not None and not (Decimal(0) <= line.ratio_pct <= Decimal(100)):
            raise RecipeError(f"{line.key}：比例須介於 0 到 100")
        if line.ratio_base != TOTAL and line.ratio_base not in keys:
            raise RecipeError(f"{line.key}：比例基準 {line.ratio_base!r} 不存在")
        if line.ratio_base == line.key:
            raise RecipeError(f"{line.key}：比例基準不可是自己")
        if line.is_remainder and line.ratio_base != TOTAL:
            raise RecipeError(f"{line.key}：餘量行的比例基準固定為總重")
    _order(lines)  # 偵測循環


def _order(lines: list[RecipeLine]) -> list[RecipeLine]:
    """依比例基準排序，基準先算；循環參照直接報錯。"""
    by_key = {line.key: line for line in lines}
    ordered: list[RecipeLine] = []
    state: dict[str, int] = {}

    def visit(line: RecipeLine) -> None:
        if state.get(line.key) == 2:
            return
        if state.get(line.key) == 1:
            raise RecipeError(f"配方比例基準形成循環：{line.key}")
        state[line.key] = 1
        if line.ratio_base != TOTAL and not line.is_remainder:
            visit(by_key[line.ratio_base])
        state[line.key] = 2
        ordered.append(line)

    for line in lines:
        visit(line)
    return ordered


def has_ratio_data(lines: list[RecipeLine]) -> bool:
    return any(line.ratio_pct is not None for line in lines)


def compute_theoretical(lines: list[RecipeLine], total_weight: Decimal) -> list[TheoreticalLine]:
    """依總重算每一行的理論用量；沒有比例資料時回傳空清單。"""
    if total_weight < 0:
        raise RecipeError("總重不可為負")
    if not has_ratio_data(lines):
        return []
    validate_lines(lines)
    weights: dict[str, Decimal] = {}
    for line in _order(lines):
        if line.is_remainder:
            continue
        if line.ratio_pct is None:
            weights[line.key] = Decimal(0)
            continue
        base = total_weight if line.ratio_base == TOTAL else weights[line.ratio_base]
        weights[line.key] = base * line.ratio_pct / Decimal(100)
    for line in lines:
        if line.is_remainder:
            weights[line.key] = total_weight - sum(weights.values(), Decimal(0))
            if weights[line.key] < 0:
                raise RecipeError(f"{line.key}：其他行合計超過總重，餘量為負")
    return [TheoreticalLine(l.key, l.label, l.item_no, weights[l.key]) for l in lines]
