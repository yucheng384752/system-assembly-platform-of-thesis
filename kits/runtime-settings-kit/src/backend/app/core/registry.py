"""參數登錄與變更通知（機制）。

其他 Kit 啟動時登錄參數並訂閱變更；本 Kit 不認得它們。通知在同一程序內同步呼叫，
訂閱函式拿到 (key, 新的有效值, 來源)。多個程序同時運作時，其他程序要等到重啟或呼叫
`reload_all` 才會套用，這是已知限制。
"""

from collections.abc import Callable
from typing import Any

from app.core.param_defs import ParamDef

Listener = Callable[[str, Any, str], None]


class ParamRegistry:
    def __init__(self) -> None:
        self._defs: dict[str, ParamDef] = {}
        self._listeners: dict[str, list[Listener]] = {}

    def register(self, defn: ParamDef) -> ParamDef:
        if defn.key in self._defs:
            raise ValueError(f"參數 {defn.key} 已登錄")
        self._defs[defn.key] = defn
        return defn

    def get(self, key: str) -> ParamDef | None:
        return self._defs.get(key)

    def all(self) -> list[ParamDef]:
        return sorted(self._defs.values(), key=lambda d: (d.category, d.kit_id, d.key))

    def subscribe(self, key: str, listener: Listener) -> None:
        if key not in self._defs:
            raise KeyError(f"未登錄的參數：{key}")
        listeners = self._listeners.setdefault(key, [])
        if listener in listeners:
            raise ValueError("重複訂閱")
        listeners.append(listener)

    def notify(self, key: str, value: Any, source: str) -> None:
        for listener in tuple(self._listeners.get(key, ())):
            listener(key, value, source)


registry = ParamRegistry()
