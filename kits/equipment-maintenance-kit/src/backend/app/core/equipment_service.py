"""設備狀態的資料庫部分：把資料整理成純函式需要的事實。"""

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.check_rules import ItemDef
from app.core.equipment_settings import get_settings
from app.core.gate_rules import CheckState, EquipmentFacts
from app.core.periods import FREQUENCIES, period_key
from app.models.equipment import CheckRecord, ChecklistItem, Equipment, Repair

# 由 product-process-kit 註冊的資源範圍類型；這裡只用字串，不匯入其他 Kit。
PRODUCT_LINE_SCOPE = "product-line"


def today() -> date:
    return datetime.now(ZoneInfo(get_settings().timezone)).date()


async def item_defs(db: AsyncSession, code: str, frequency: str) -> list[ItemDef]:
    rows = await db.scalars(select(ChecklistItem).where(ChecklistItem.equipment_code == code, ChecklistItem.frequency == frequency)
                      .order_by(ChecklistItem.sort, ChecklistItem.id))
    return [ItemDef(r.key, r.label, r.kind, r.unit, None if r.low is None else Decimal(str(r.low)),
                    None if r.high is None else Decimal(str(r.high)), r.required) for r in rows]


async def has_open_repair(db: AsyncSession, code: str) -> bool:
    return await db.scalar(select(Repair.id).where(Repair.equipment_code == code, Repair.status == "open").limit(1)) is not None


async def facts_for(db: AsyncSession, eq: Equipment, day: date | None = None) -> EquipmentFacts:
    day = day or today()
    checks: dict[str, CheckState] = {}
    for freq in FREQUENCIES:
        rec = await db.scalar(select(CheckRecord).where(CheckRecord.equipment_code == eq.code, CheckRecord.frequency == freq,
                                                  CheckRecord.period_key == period_key(freq, day)))
        if rec is not None:
            checks[freq] = CheckState(rec.status, bool(rec.abnormal))
    return EquipmentFacts(eq.code, eq.name, eq.active, await has_open_repair(db, eq.code), checks)


async def find_equipment(db: AsyncSession, code: str) -> Equipment | None:
    return await db.scalar(select(Equipment).where(Equipment.code == code))


async def equipment_in_scope(db: AsyncSession, product_line_code: str | None) -> list[Equipment]:
    """啟用中的設備；指定產線時，含該產線專用與各產線共用的。"""
    q = select(Equipment).where(Equipment.active.is_(True))
    rows = list(await db.scalars(q.order_by(Equipment.code)))
    if product_line_code is None:
        return rows
    return [e for e in rows if e.product_line_code in (None, product_line_code)]
