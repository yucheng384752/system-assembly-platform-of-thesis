"""可調參數的定義與數值檢查（純函式）。

每個 Kit 在啟動時登錄自己願意開放調整的參數，說明型別、單位、範圍、風險與誰能改。
只有 kind 為 "value" 的參數能在這裡修改；改欄位型別（migration）或要寫程式的擴充（extension）
只列出來並說明做法，不提供編輯，因為它們需要資料庫遷移或開發。
"""

import math
import re
from dataclasses import dataclass, field, replace
from decimal import Decimal, InvalidOperation
from typing import Any

TYPES = ("bool", "num", "text", "choice")
RISKS = ("low", "medium", "high")
KINDS = ("value", "migration", "extension")
CATEGORIES = ("table", "prefill", "alarm", "perm", "line", "other")
EDITOR_ROLES = ("qc", "manager", "admin")  # operator 與 audit 永遠不能改
MAX_TEXT = 200
_KEY = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class ParamError(ValueError):
    pass


@dataclass(frozen=True)
class ParamDef:
    key: str
    kit_id: str
    label: str
    type: str
    default: Any
    category: str = "other"
    unit: str | None = None
    min: Decimal | None = None
    max: Decimal | None = None
    integer: bool = False
    choices: tuple[str, ...] = ()
    risk: str = "low"
    edit_roles: tuple[str, ...] = ("manager", "admin")
    runtime_editable: bool = True
    kind: str = "value"
    description: str = ""
    impact: str = ""
    system: Any = None  # 組裝期設定值（由 Kit 啟動時帶入）；None 代表沿用預設

    def __post_init__(self) -> None:
        if not _KEY.match(self.key):
            raise ParamError(f"參數 key 格式為「kit.name」且只用小寫英數底線：{self.key}")
        if self.type not in TYPES or self.risk not in RISKS or self.kind not in KINDS or self.category not in CATEGORIES:
            raise ParamError(f"{self.key}：type／risk／kind／category 不合法")
        if not set(self.edit_roles) <= set(EDITOR_ROLES):
            raise ParamError(f"{self.key}：edit_roles 只能包含 {list(EDITOR_ROLES)}")
        if "qc" in self.edit_roles and self.risk != "low":
            raise ParamError(f"{self.key}：只有低風險參數可開放給品管修改")
        if self.risk == "high" and set(self.edit_roles) - {"admin"}:
            raise ParamError(f"{self.key}：高風險參數只能由管理者修改")
        if self.kind != "value" and self.runtime_editable:
            raise ParamError(f"{self.key}：{self.kind} 類參數不可在介面修改")
        if self.type == "choice" and not self.choices:
            raise ParamError(f"{self.key}：choice 類參數需要 choices")
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ParamError(f"{self.key}：min 不可大於 max")
        if self.kind == "value":
            check_value(self, self.default)
            if self.system is not None:
                check_value(self, self.system)

    def with_system(self, value: Any) -> "ParamDef":
        return replace(self, system=value)


def _num(raw: Any, what: str) -> Decimal:
    if isinstance(raw, bool):
        raise ParamError(f"{what}必須是數字")
    try:
        value = Decimal(str(raw))
    except InvalidOperation as exc:
        raise ParamError(f"{what}必須是數字") from exc
    if not value.is_finite() or (isinstance(raw, float) and not math.isfinite(raw)):
        raise ParamError(f"{what}必須是有效數字")
    return value


def check_value(defn: ParamDef, raw: Any, lo: Decimal | None = None, hi: Decimal | None = None) -> Any:
    """檢查並正規化一個值（數字回傳 Decimal）。lo／hi 是場域限制的範圍，與定義本身的範圍取交集。"""
    t, what = defn.type, f"「{defn.label}」"
    if t == "bool":
        if not isinstance(raw, bool):
            raise ParamError(f"{what}必須是 開啟／關閉")
        return raw
    if t == "num":
        value = _num(raw, what)
        if defn.integer and value != value.to_integral_value():
            raise ParamError(f"{what}必須是整數")
        low = max((b for b in (defn.min, lo) if b is not None), default=None)
        high = min((b for b in (defn.max, hi) if b is not None), default=None)
        if (low is not None and value < low) or (high is not None and value > high):
            u = defn.unit or ""
            shown = f"{low.normalize():f}{u}" if low is not None else "不限"
            shown_h = f"{high.normalize():f}{u}" if high is not None else "不限"
            raise ParamError(f"{what}超出範圍（{shown} – {shown_h}）")
        return value
    if t == "choice":
        if raw not in defn.choices:
            raise ParamError(f"{what}必須是 {'、'.join(defn.choices)} 其中之一")
        return raw
    if not isinstance(raw, str):
        raise ParamError(f"{what}必須是文字")
    text = raw.strip()
    if not text:
        raise ParamError(f"{what}不可空白")
    if len(text) > MAX_TEXT or _CONTROL.search(text):
        raise ParamError(f"{what}最多 {MAX_TEXT} 字且不可含控制字元")
    return text


def to_storage(value: Any) -> Any:
    """存進資料庫的形式：數字存字串，保留精確度。"""
    return str(value) if isinstance(value, Decimal) else value
