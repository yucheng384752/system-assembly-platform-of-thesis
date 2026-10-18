"""把本次判斷結果與現有報警對帳，決定要新增、更新或解除哪些報警（純函式）。

規則（沿用來源系統）：
- 合格：解除現有的有效報警（尚未解除的，含已確認但未解除的）。
- 違規且已有有效報警：只更新訊息，避免畫面一直顯示舊數值。
- 違規且沒有有效報警：新增。
- 資料不足：維持現狀。
- 範圍為 `measurement`：報警掛在該筆量測上。
- 範圍為 `group`（跨欄位）：同一批次同一規則最多一個有效報警；若有多個，保留第一個，其餘解除，
  避免同一個問題在多個量測上各開一個報警。
"""

from dataclasses import dataclass, field

from app.core.rules import INCOMPLETE, OK, VIOLATED, Outcome


@dataclass(frozen=True)
class ActiveAlarm:
    id: int
    measurement_id: int
    rule_key: str
    message: str


@dataclass(frozen=True)
class Actions:
    create: str | None = None  # 要新增的訊息
    update: tuple[tuple[int, str], ...] = ()
    resolve: tuple[int, ...] = ()
    active_id: int | None = None  # 對帳後仍有效的既有報警編號（新增者沒有編號）


def reconcile(outcome: Outcome, active: list[ActiveAlarm], *, scope: str) -> Actions:
    """active：同一批次、同一規則、尚未解除的報警；scope='measurement' 時已限於本筆量測。"""
    if outcome.state == INCOMPLETE:
        return Actions(active_id=active[0].id if active else None)
    if outcome.state == OK:
        return Actions(resolve=tuple(a.id for a in active))
    if outcome.state != VIOLATED:
        raise ValueError(f"未知的判斷狀態：{outcome.state}")
    if not active:
        return Actions(create=outcome.message)
    keep, extras = active[0], active[1:] if scope == "group" else ()
    update = ((keep.id, outcome.message),) if keep.message != outcome.message else ()
    return Actions(update=update, resolve=tuple(a.id for a in extras), active_id=keep.id)
