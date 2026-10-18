"""異常簽核的狀態規則（純函式）。

當「關鍵量測」超出規格，批次不能直接往下做，必須由 admin 簽核：
- rework_approved：核准重工，可重填該量測。
- release_approved：特採放行，必須先確認已完成加驗（verification_passed）。
- rejected：駁回，維持阻擋。
"""

from decimal import Decimal

PENDING, REWORK, RELEASE, REJECTED = "pending", "rework_approved", "release_approved", "rejected"
DECISIONS = {REWORK, RELEASE, REJECTED}


class DecisionError(ValueError):
    pass


def validate_decision(status: str, verification_passed: bool) -> None:
    if status not in DECISIONS:
        raise DecisionError(f"簽核結果必須是 {sorted(DECISIONS)}")
    if status == RELEASE and not verification_passed:
        raise DecisionError("特採必須確認加驗通過")


def is_blocked(latest_status: str | None, value: Decimal | None, low: Decimal | None, high: Decimal | None, has_measurement: bool) -> bool:
    """關鍵量測是否仍擋著批次。

    - 特採放行：不擋。
    - 有申請但不是核准重工（待簽核或駁回）：擋。
    - 核准重工之後，或根本沒有申請：看目前量測值。還沒重填 → 有申請就擋；已填 → 無數值、無規格、超出規格都擋。
    """
    if latest_status == RELEASE:
        return False
    if latest_status is not None and latest_status != REWORK:
        return True
    if not has_measurement:
        return latest_status is not None
    if value is None or (low is None and high is None):
        return True
    return (low is not None and value < low) or (high is not None and value > high)


def blocks_write(*, is_gating_station: bool, is_later_station: bool, latest_status: str | None, batch_blocked: bool, batch_completed: bool) -> str | None:
    """寫入阻擋原因；None 代表放行。"""
    if is_gating_station:
        if batch_completed:
            return "已完成批次不可修改關鍵量測"
        if latest_status is not None and latest_status != REWORK:
            return "異常尚未核准重工，無法重填"
        return None
    if is_later_station and batch_blocked:
        return "初始量測異常尚未通過，無法填寫後續站點"
    return None


def validate_gating_value(value: Decimal | None, low: Decimal | None, high: Decimal | None, finite: bool = True) -> str | None:
    if value is None or not finite:
        return "關鍵量測必須填寫有效數字"
    if low is None and high is None:
        return "此型號尚未設定關鍵量測的數值規格"
    return None
