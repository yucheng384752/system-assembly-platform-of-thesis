"""測試用的平台資料庫替身（契約 platform.db.session）。

與契約一致：每個請求一個 AsyncSession、`expire_on_commit=False`（提交後仍可讀物件屬性，
不觸發非同步環境下不允許的隱式延遲載入）；請求以例外結束時，未提交的變更隨 session 關閉回復。
"""

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


_maker: async_sessionmaker[AsyncSession] | None = None


def configure(url: str = "sqlite+aiosqlite://") -> AsyncEngine:
    global _maker
    engine = create_async_engine(url, poolclass=StaticPool, connect_args={"check_same_thread": False})
    _maker = async_sessionmaker(engine, expire_on_commit=False)
    return engine


def session() -> AsyncSession:
    assert _maker is not None, "先呼叫 configure()"
    return _maker()


async def get_db() -> AsyncIterator[AsyncSession]:
    async with session() as db:
        yield db
