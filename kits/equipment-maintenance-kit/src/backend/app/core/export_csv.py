"""月度點檢匯出（純函式）。

CSV 公式注入：以 = + - @ 開頭的儲存格會被試算表當成公式執行，匯出時一律在前面補單引號。
"""

import csv
import io

_DANGER = ("=", "+", "-", "@", "\t", "\r")
HEADER = ["設備代碼", "設備名稱", "頻率", "期別", "狀態", "點檢者", "點檢時間", "複核者", "複核時間", "異常", "說明"]


def safe_cell(value) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_DANGER) else text


def to_csv(rows: list[list]) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(HEADER)
    for row in rows:
        writer.writerow([safe_cell(v) for v in row])
    return "﻿" + out.getvalue()  # BOM：Excel 開啟時正確辨識為 UTF-8
