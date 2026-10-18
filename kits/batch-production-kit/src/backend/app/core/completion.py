"""完成工單與簽核的前置條件（純函式）。

簽核與完成共用同一份判斷，兩個端點不會對「還缺什麼」說法不一致。
附件必填清單來自設定（預設為空），不再寫死在程式裡。
"""

from collections.abc import Iterable


def missing_before_completion(
    *,
    operator_signed: bool,
    inspector_signed: bool,
    incomplete_station: str | None,
    gate_blockers: Iterable[str],
    required_attachments: dict[str, str],
    uploaded_attachment_keys: Iterable[str],
    require_warehouse_entry: bool = False,
    has_warehouse_entry: bool = False,
) -> list[str]:
    missing: list[str] = []
    if not operator_signed:
        missing.append("操作員簽名")
    if not inspector_signed:
        missing.append("檢驗員簽名")
    if incomplete_station is not None:
        missing.append(f"{incomplete_station}尚有必填欄位未填")
    missing.extend(gate_blockers)
    uploaded = set(uploaded_attachment_keys)
    missing.extend(f"{label}未上傳" for key, label in required_attachments.items() if key not in uploaded)
    if require_warehouse_entry and not has_warehouse_entry:
        missing.append("入庫單未送出")
    return missing
