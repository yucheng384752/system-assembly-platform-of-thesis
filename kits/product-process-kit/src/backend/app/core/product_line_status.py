"""來源系統的產線狀態 → 本 Kit 產線狀態的對照（純函式，供匯入程式使用）。

已決議的對照（D-A4 拆分時確認）：來源的 `ok` → `defined`，`wip` → `reserved`。
對照表以外的值一律報錯，不默默歸類；預留的產線不得含站點（見 seed_check），
所以轉成定義檔時，`reserved` 的產線不帶站點。
"""

SOURCE_STATUS_MAP: dict[str, str] = {"ok": "defined", "wip": "reserved"}


class SourceStatusError(ValueError):
    pass


def map_source_status(raw: object) -> str:
    """來源狀態字串（忽略前後空白與大小寫）→ `defined` 或 `reserved`。"""
    key = raw.strip().lower() if isinstance(raw, str) else None
    if key not in SOURCE_STATUS_MAP:
        raise SourceStatusError(f"未知的來源產線狀態：{raw!r}（只接受 {sorted(SOURCE_STATUS_MAP)}）")
    return SOURCE_STATUS_MAP[key]


def source_line_to_seed(code: str, name: str, raw_status: object, stations: list[dict] | None = None) -> dict:
    """組出定義檔（seed）的一條產線；預留產線不帶站點。"""
    status = map_source_status(raw_status)
    line: dict = {"code": code, "name": name, "status": status}
    if status == "defined":
        line["stations"] = list(stations or [])
    return line
