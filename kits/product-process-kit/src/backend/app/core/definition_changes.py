"""產品與型號定義異動的比對與摘要（純函式）。

規則（沿用來源系統）：沒有實際變動就不寫紀錄；有變動一定要填原因；新增也算一次異動。
"""

from decimal import Decimal, InvalidOperation


class ReasonRequiredError(ValueError):
    pass


def _norm(value: object) -> object:
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        try:
            return Decimal(str(value)).normalize()
        except InvalidOperation:
            return value
    return value


def display(value: object) -> str:
    if value is None:
        return "(無)"
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        return format(Decimal(str(value)).normalize(), "f")
    return str(value)


def changed_fields(current: dict[str, object], incoming: dict[str, object]) -> dict[str, tuple[object, object]]:
    """只列出值真的不同的欄位，回傳 {欄位: (舊值, 新值)}；數字以十進位比對。"""
    return {k: (current.get(k), v) for k, v in incoming.items() if _norm(current.get(k)) != _norm(v)}


def summarize(changes: dict[str, tuple[object, object]], labels: dict[str, str]) -> str:
    return "；".join(f"{labels.get(k, k)}：{display(old)} → {display(new)}" for k, (old, new) in changes.items())


def require_reason(reason: str | None) -> str:
    if reason is None or not reason.strip():
        raise ReasonRequiredError("修改定義需填寫原因")
    return reason.strip()
