"""用料秤重的寫入規則（純函式）。

現場操作員只能改「實際重量」；料號、批號、供應商、理論重量須由管理者或品管填寫。
作法沿用來源系統：不是檢查值合不合法，而是檢查這幾欄是否被操作員動過
（與資料庫現值逐列比對），且操作員不能減少列數。
"""

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class MaterialRow:
    kind: str
    item_no: str | None = None
    lot_no: str | None = None
    supplier: str | None = None
    theoretical_kg: Decimal | None = None
    actual_kg: Decimal | None = None

    def identity(self) -> tuple:
        theo = None if self.theoretical_kg is None else Decimal(self.theoretical_kg).normalize()
        return (self.item_no, self.lot_no, self.supplier, theo)


_BLANK = MaterialRow(kind="").identity()


def operator_may_write(existing: list[MaterialRow], incoming: list[MaterialRow]) -> bool:
    kinds = {r.kind for r in existing} | {r.kind for r in incoming}
    for kind in kinds:
        old = [r for r in existing if r.kind == kind]
        new = [r for r in incoming if r.kind == kind]
        if len(new) < len(old):
            return False
        for i, row in enumerate(new):
            before = old[i].identity() if i < len(old) else _BLANK
            if before != row.identity():
                return False
    return True
