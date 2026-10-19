"""入庫單的規則（純函式）。明細有填時，合計必須等於入庫數量。"""

from decimal import Decimal, InvalidOperation


class WarehouseError(ValueError):
    pass


def _dec(raw, what: str) -> Decimal:
    if isinstance(raw, bool):
        raise WarehouseError(f"{what}必須是數字")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as exc:
        raise WarehouseError(f"{what}必須是數字") from exc
    if not value.is_finite():
        raise WarehouseError(f"{what}必須是有效數字")
    return value


def normalize_lines(lines: list[dict]) -> list[dict]:
    out = []
    for i, line in enumerate(lines, 1):
        label = str(line.get("label", "")).strip()
        if not label:
            raise WarehouseError(f"明細第 {i} 列缺少名稱")
        qty = _dec(line.get("qty"), f"明細第 {i} 列數量")
        if qty <= 0:
            raise WarehouseError(f"明細第 {i} 列數量必須大於 0")
        out.append({"label": label, "qty": str(qty)})
    return out


def validate_for_submit(quantity, unit: str | None, lines: list[dict]) -> list[dict]:
    """送出前的完整檢查；回傳正規化後的明細。"""
    if quantity is None:
        raise WarehouseError("請填入庫數量")
    qty = _dec(quantity, "入庫數量")
    if qty <= 0:
        raise WarehouseError("入庫數量必須大於 0")
    if not (unit and unit.strip()):
        raise WarehouseError("請填單位")
    normalized = normalize_lines(lines)
    if normalized:
        total = sum((Decimal(l["qty"]) for l in normalized), Decimal(0))
        if total != qty:
            raise WarehouseError(f"明細合計 {total.normalize():f} 與入庫數量 {qty.normalize():f} 不符")
    return normalized


def can_edit(entry_status: str | None, batch_status: str) -> bool:
    return batch_status != "completed" and entry_status in (None, "draft")
