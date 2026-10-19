"""點檢週期（純函式）。

每個頻率對應一個「期別鍵」：同一台設備在同一期別只有一筆點檢紀錄。
日 → 2026-10-19；週 → 2026-W43（ISO 週）；月 → 2026-10。
"""

import re
from datetime import date

DAILY, WEEKLY, MONTHLY = "daily", "weekly", "monthly"
FREQUENCIES = (DAILY, WEEKLY, MONTHLY)  # 由短到長，也是閘門檢查與顯示的順序
LABELS = {DAILY: "每日", WEEKLY: "每週", MONTHLY: "每月"}
_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def period_key(frequency: str, day: date) -> str:
    if frequency == DAILY:
        return day.isoformat()
    if frequency == WEEKLY:
        iso = day.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    if frequency == MONTHLY:
        return day.strftime("%Y-%m")
    raise ValueError(f"未知的頻率：{frequency}")


def valid_month(text: str) -> bool:
    return bool(_MONTH.match(text))
