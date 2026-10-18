"""量測寫入的目標與權限檢查（純函式）。"""


class MeasurementRuleError(ValueError):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def resolve_step(metric_scope: str, metric_station_code: str, step_seq: int | None, step_station_codes: dict[int, str]) -> int:
    """回傳要儲存的 step_seq（不屬於步驟為 0）。步驟層項目必須指定同站點的步驟。"""
    if metric_scope != "step":
        return 0
    if step_seq is None or step_seq <= 0:
        raise MeasurementRuleError("此欄位需指定步驟")
    if step_station_codes.get(step_seq) != metric_station_code:
        raise MeasurementRuleError("步驟不屬於此欄位站點")
    return step_seq


def check_filler_role(filler_role: str, actor_role: str) -> None:
    """filler_role=manager 的項目，操作員不可填。"""
    if filler_role == "manager" and actor_role == "operator":
        raise MeasurementRuleError("此欄位僅 manager 可填寫", 403)
