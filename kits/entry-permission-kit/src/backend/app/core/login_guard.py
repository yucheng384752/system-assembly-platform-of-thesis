"""登入失敗鎖定。

以帳號名稱計數，不洩漏帳號是否存在。存在單一程序記憶體中：只在單一 worker
部署有效；多 worker 或多實例時須改用共享儲存。次數與時間窗由設定提供，
不寫死在程式中。
"""

from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timedelta, timezone


class LoginLockedError(Exception):
    def __init__(self, window: timedelta) -> None:
        minutes = int(window.total_seconds() // 60)
        super().__init__(f"登入失敗次數過多，請 {minutes} 分鐘後再試")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class LoginGuard:
    def __init__(
        self,
        max_attempts: int,
        window: timedelta,
        clock: Callable[[], datetime] = _utc_now,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts 必須至少為 1")
        if window <= timedelta(0):
            raise ValueError("window 必須大於 0")
        self._max_attempts = max_attempts
        self._window = window
        self._clock = clock
        self._failures: dict[str, list[datetime]] = defaultdict(list)

    def ensure_not_locked(self, username: str) -> None:
        recent = self._recent_failures(username)
        if len(recent) >= self._max_attempts:
            raise LoginLockedError(self._window)

    def record_failure(self, username: str) -> None:
        self._failures[username].append(self._clock())

    def reset(self, username: str) -> None:
        self._failures.pop(username, None)

    def _recent_failures(self, username: str) -> list[datetime]:
        now = self._clock()
        recent = [t for t in self._failures[username] if now - t < self._window]
        self._failures[username] = recent
        return recent
