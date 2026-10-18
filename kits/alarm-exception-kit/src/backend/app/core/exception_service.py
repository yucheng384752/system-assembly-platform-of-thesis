"""異常簽核的批次閘門（資料庫部分）。判斷規則在 exception_gate.py。"""

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.alarm_service import unresolved_count
from app.core.alarm_settings import Gating, get_settings
from app.core.batch_read import current_measurement
from app.core.exception_gate import blocks_write, is_blocked, validate_gating_value
from app.core.gates import BatchContext, GateBase, gates
from app.core.model_lookup import find_model_id, load_stations
from app.models.exception_request import ExceptionRequest


def latest_request(db: Session, batch_id: int, g: Gating) -> ExceptionRequest | None:
    return db.scalars(select(ExceptionRequest).where(
        ExceptionRequest.batch_id == batch_id, ExceptionRequest.station_code == g.station_code,
        ExceptionRequest.metric_key == g.metric_key).order_by(ExceptionRequest.id.desc())).first()


def gating_spec(db: Session, ctx: BatchContext, g: Gating) -> tuple[Decimal | None, Decimal | None]:
    model_id = find_model_id(db, ctx.product_line_code, ctx.product_model_code)
    for st in load_stations(db, ctx.product_line_code, model_id):
        if st.code == g.station_code:
            for m in st.metrics:
                if m.key == g.metric_key:
                    return m.spec_low, m.spec_high
    return None, None


def batch_blocked(db: Session, ctx: BatchContext, g: Gating) -> bool:
    req = latest_request(db, ctx.batch_id, g)
    cur = current_measurement(db, ctx.batch_id, g.station_code, g.metric_key)
    low, high = gating_spec(db, ctx, g)
    return is_blocked(req.status if req else None, cur[1] if cur else None, low, high, cur is not None)


class ExceptionGate(GateBase):
    """異常簽核閘門。`order` 取小，讓這個最具體的原因排在籠統閘門之前。"""

    key = "alarm.exception"
    order = 20

    def write_blocker(self, ctx: BatchContext, station_code: str) -> str | None:
        g = get_settings().gating
        if g is None:
            return None
        req = latest_request(ctx.db, ctx.batch_id, g)
        return blocks_write(
            is_gating_station=station_code == g.station_code, is_later_station=station_code != g.station_code,
            latest_status=req.status if req else None, batch_blocked=batch_blocked(ctx.db, ctx, g),
            batch_completed=ctx.status == "completed")

    def validate_value(self, ctx, station_code, metric_key, value_num, spec_low, spec_high) -> str | None:
        g = get_settings().gating
        if g is None or (station_code, metric_key) != (g.station_code, g.metric_key):
            return None
        finite = value_num is not None and value_num == value_num and abs(value_num) != float("inf")
        return validate_gating_value(None if value_num is None else Decimal(str(value_num)), spec_low, spec_high, finite)

    def station_blocked(self, ctx: BatchContext, station_code: str) -> bool:
        g = get_settings().gating
        return g is not None and station_code == g.station_code and batch_blocked(ctx.db, ctx, g)

    def completion_blockers(self, ctx: BatchContext) -> list[str]:
        s, out = get_settings(), []
        if s.gating is not None and batch_blocked(ctx.db, ctx, s.gating):
            out.append("關鍵量測異常尚未通過簽核")
        if s.block_completion:
            n = unresolved_count(ctx.db, ctx.batch_id)
            if n:
                out.append(f"尚有 {n} 筆未解除報警")
        return out


def register() -> None:
    gates.register(ExceptionGate())
