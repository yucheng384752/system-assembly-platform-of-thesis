"""活動紀錄的文字化（純函式）。

批次異動事件的 reason 是機器用的短字串；這裡轉成人看得懂的說法。
不認得的 reason 原樣顯示（清掉控制字元、截短），不會因此出錯，也不會把未預期內容當成標記顯示。
可由設定 `reasonLabels` 覆寫或擴充。
"""

import re

DEFAULT_LABELS = {
    "created": "開立批次",
    "dispatched": "派工",
    "header": "修改表頭",
    "measurement": "填寫量測",
    "materials": "填寫用料",
    "completed": "完成工單",
    "warehouse_saved": "儲存入庫單",
    "warehouse_submitted": "送出入庫單",
    "rework_created": "新增回鍋單",
    "rework_confirmed": "確認回鍋單",
    "note_added": "新增備註",
    "attachment_uploaded": "上傳附件",
    "attachment_deleted": "刪除附件",
    "alarm_acknowledged": "確認報警",
    "exception_requested": "申請異常簽核",
    "exception_decided": "異常簽核",
}
ROLE_LABELS = {"operator": "操作員", "inspector": "檢驗員"}
MAX_LEN = 200
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _clean(text: str) -> str:
    text = _CONTROL.sub(" ", text).strip()
    return text if len(text) <= MAX_LEN else text[:MAX_LEN] + "…"


def describe(reason: str, overrides: dict[str, str] | None = None) -> str:
    labels = {**DEFAULT_LABELS, **(overrides or {})}
    if reason in labels:
        return labels[reason]
    if reason.startswith("signed:"):
        role = reason.split(":", 1)[1]
        return f"{ROLE_LABELS.get(role, _clean(role))}簽核"
    if reason.startswith("deleted:"):
        why = _clean(reason.split(":", 1)[1])
        return f"刪除批次（原因：{why}）" if why else "刪除批次"
    return _clean(reason) or "（未知異動）"
