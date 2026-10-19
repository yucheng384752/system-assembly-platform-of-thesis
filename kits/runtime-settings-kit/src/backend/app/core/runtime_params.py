"""其他 Kit 登錄參數的入口（薄薄一層，讓呼叫端只需匯入這一個模組）。

    register_param(ParamDef(...), apply=lambda value: ...)

apply 在參數的有效值改變（或啟動時同步）時被呼叫，拿到新的有效值（數字為 Decimal）。
"""

from collections.abc import Callable
from typing import Any

from app.core.param_defs import ParamDef
from app.core.registry import registry


def register_param(defn: ParamDef, apply: Callable[[Any], None] | None = None) -> ParamDef:
    registry.register(defn)
    if apply is not None:
        registry.subscribe(defn.key, lambda key, value, source: apply(value))
    return defn
