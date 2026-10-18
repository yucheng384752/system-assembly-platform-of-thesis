"""報警判斷的資料庫部分：訂閱 MeasurementRecorded，依規則對帳並寫入報警。

純判斷在 rules.py／reconcile.py；這裡只負責查現有報警、套用 Actions、補齊跨欄位數值。
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.alarm_settings import get_settings
from app.core.batch_read import latest_values
from app.core.events import MeasurementRecorded, bus
from app.core.reconcile import ActiveAlarm, reconcile
from app.core.rules import SPEC_RANGE_KEY, Outcome, evaluate_spec_range
from app.models.alarm import Alarm

UNRESOLVED = ("active", "acknowledged")


def _active(db: Session, batch_id: int, rule_key: str, measurement_id: int | None) -> list[Alarm]:
    q = select(Alarm).where(Alarm.batch_id == batch_id, Alarm.rule_key == rule_key, Alarm.status.in_(UNRESOLVED))
    if measurement_id is not None:
        q = q.where(Alarm.measurement_id == measurement_id)
    return list(db.scalars(q.order_by(Alarm.id)))


def _apply(db: Session, ev: MeasurementRecorded, rule_key: str, outcome: Outcome, scope: str) -> None:
    rows = _active(db, ev.batch_id, rule_key, ev.measurement_id if scope == "measurement" else None)
    actions = reconcile(outcome, [ActiveAlarm(a.id, a.measurement_id or 0, a.rule_key, a.message) for a in rows], scope=scope)
    by_id = {a.id: a for a in rows}
    now = datetime.now(timezone.utc)
    for alarm_id, message in actions.update:
        by_id[alarm_id].message = message
    for alarm_id in actions.resolve:
        by_id[alarm_id].status, by_id[alarm_id].resolved_at = "resolved", now
    if actions.create:
        db.add(Alarm(batch_id=ev.batch_id, measurement_id=ev.measurement_id, rule_key=rule_key, station_code=ev.station_code,
                     metric_key=ev.metric_key, severity=get_settings().severity, message=actions.create))
    db.flush()


def on_measurement_recorded(db: Session, ev: MeasurementRecorded) -> None:
    s = get_settings()
    value = ev.value_num

    for rule in s.threshold_rules:
        if rule.matches(ev.station_code, ev.metric_key):
            _apply(db, ev, rule.key, rule.evaluate(ev.metric_label, ev.unit, value), "measurement")

    for rule in s.consistency_rules:
        if rule.matches(ev.station_code, ev.metric_key):
            scope_station = rule.station_code or ev.station_code
            values = latest_values(db, ev.batch_id, scope_station, rule.all_keys)
            _apply(db, ev, rule.key, rule.evaluate(values), "group")

    if s.spec_range_enabled and not s.covered_by_dedicated_rule(ev.station_code, ev.metric_key):
        _apply(db, ev, SPEC_RANGE_KEY, evaluate_spec_range(ev.metric_label, ev.unit, value, ev.spec_low, ev.spec_high), "measurement")


def unresolved_count(db: Session, batch_id: int) -> int:
    return len(list(db.scalars(select(Alarm.id).where(Alarm.batch_id == batch_id, Alarm.status.in_(UNRESOLVED)))))


def register() -> None:
    """載入時呼叫一次：訂閱量測事件。"""
    bus.subscribe(MeasurementRecorded, on_measurement_recorded)
