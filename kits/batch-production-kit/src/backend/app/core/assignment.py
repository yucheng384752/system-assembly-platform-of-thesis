"""負責人指派檢查（純函式）：角色須相符，兩位操作員不可同一人。"""


class AssignmentError(ValueError):
    pass


def validate_assignment(roles: dict[int, str | None], operator1_id: int, operator2_id: int, qc_id: int) -> None:
    """roles：帳號編號 → 角色（查無帳號為 None）。"""
    if operator1_id == operator2_id:
        raise AssignmentError("負責操作員1、操作員2不可為同一人")
    if roles.get(operator1_id) != "operator":
        raise AssignmentError("負責操作員1需為 operator 角色帳號")
    if roles.get(operator2_id) != "operator":
        raise AssignmentError("負責操作員2需為 operator 角色帳號")
    if roles.get(qc_id) != "qc":
        raise AssignmentError("負責QC需為 qc 角色帳號")
