"""其他 Kit 登錄總覽區塊的入口（薄薄一層，讓呼叫端只需匯入這一個模組）。"""

from app.core.providers import SectionProvider, registry


def register(provider: SectionProvider) -> SectionProvider:
    return registry.register(provider)
