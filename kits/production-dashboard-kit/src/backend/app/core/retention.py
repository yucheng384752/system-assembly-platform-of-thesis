"""活動紀錄保留期限（純函式）。0 代表永久保留。"""

from datetime import datetime, timedelta


class RetentionError(ValueError):
    pass


def cutoff(now: datetime, days: int) -> datetime | None:
    """早於此時間的紀錄可清除；days 為 0 時回傳 None（不清除）。"""
    if days < 0 or days > 3650:
        raise RetentionError("保留天數需在 0 到 3650 之間（0 為永久保留）")
    return None if days == 0 else now - timedelta(days=days)
