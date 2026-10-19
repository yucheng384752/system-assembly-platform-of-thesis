"""總覽區塊的提供者登錄（機制）。

儀表板不認得報警或設備：想出現在總覽的 Kit 在啟動時登錄一個提供者，儀表板依 order 排列、
單一提供者失敗只影響自己的區塊。沒有任何提供者時，總覽只剩批次狀態計數。

提供者介面：key、title、order 三個屬性，加上 fetch(db, actor) -> {"counts": {標籤: 數量}, "rows": [dict, …]}。
"""

from dataclasses import dataclass, field
from typing import Any, Protocol

MAX_ROWS = 20


class SectionProvider(Protocol):
    key: str
    title: str
    order: int

    def fetch(self, db: Any, actor: Any) -> dict: ...


@dataclass(frozen=True)
class Section:
    key: str
    title: str
    counts: dict[str, int] = field(default_factory=dict)
    rows: list[dict] = field(default_factory=list)
    error: str | None = None


class ProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, SectionProvider] = {}

    def register(self, provider: SectionProvider) -> SectionProvider:
        if not provider.key:
            raise ValueError("提供者缺少 key")
        if provider.key in self._providers:
            raise ValueError(f"提供者 {provider.key} 已登錄")
        self._providers[provider.key] = provider
        return provider

    def keys(self) -> list[str]:
        return [p.key for p in self._ordered()]

    def _ordered(self) -> list[SectionProvider]:
        return sorted(self._providers.values(), key=lambda p: (p.order, p.key))

    def collect(self, db: Any, actor: Any) -> list[Section]:
        sections: list[Section] = []
        for provider in self._ordered():
            try:
                data = provider.fetch(db, actor)
                counts = {str(k): int(v) for k, v in dict(data.get("counts", {})).items()}
                sections.append(Section(provider.key, provider.title, counts, list(data.get("rows", []))[:MAX_ROWS]))
            except Exception:  # noqa: BLE001  一個區塊壞掉不拖垮整個總覽
                sections.append(Section(provider.key, provider.title, error="此區塊暫時無法取得"))
        return sections


registry = ProviderRegistry()
