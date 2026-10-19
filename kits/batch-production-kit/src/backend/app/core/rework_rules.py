"""回鍋確認單的規則（純函式）。"""

from decimal import Decimal, InvalidOperation


class ReworkError(ValueError):
    pass


def validate_create(quantity, reason: str) -> Decimal:
    if not (reason and reason.strip()):
        raise ReworkError("請填回鍋原因")
    try:
        qty = Decimal(str(quantity))
    except InvalidOperation as exc:
        raise ReworkError("回鍋數量必須是數字") from exc
    if not qty.is_finite() or qty <= 0:
        raise ReworkError("回鍋數量必須大於 0")
    return qty


def validate_confirm(creator: int, confirmer: int, status: str, must_differ: bool) -> None:
    if status != "pending":
        raise ReworkError("此回鍋單已確認")
    if must_differ and creator == confirmer:
        raise ReworkError("確認者不可是填單者本人")
