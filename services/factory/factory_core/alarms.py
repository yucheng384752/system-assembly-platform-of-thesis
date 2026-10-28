"""Alarms and the held node state (decisions 21 to 23).

An alarm that nobody has acknowledged keeps its node held. Held is derived from the open alarms, never stored as a
flag, so it cannot disagree with them: acknowledging is the only thing that releases a node. Raising, reminding and
acknowledging are appended records. Who the reminders go to is resolved from entry-permission by the caller; this
module only decides when one is due and who may acknowledge.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .store import AlreadyExists
from .workorder import FactoryState

# minRole in the plan is "manager": that role and above. Admin is above manager (decision 20).
ACK_ROLES = ('manager', 'admin')
# Used when the pinned parameter set has no interval for a rule. The value is an assumption, to be confirmed with the client.
DEFAULT_REPEAT_MINUTES = 30


class AlarmError(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__('; '.join(f"{e['code']} {e['path']}: {e['message']}" for e in errors))
        self.errors = errors


def _error(code: str, path: str, message: str) -> dict:
    return {'code': code, 'path': path, 'message': message}


def parse_time(value: str) -> datetime:
    """ISO 8601 with a trailing Z; Python 3.10 cannot read the Z itself."""
    moment = datetime.fromisoformat(value[:-1] + '+00:00' if value.endswith('Z') else value)
    if moment.tzinfo is None:
        raise ValueError(f'{value!r} has no time zone')
    return moment.astimezone(timezone.utc)


@dataclass(frozen=True)
class Alarm:
    alarm_id: str
    order_id: str
    rule_id: str
    node_id: str
    episode: int       # the nth time this rule alarmed on this order
    raised_at: str
    detail: str


@dataclass(frozen=True)
class Acknowledgement:
    alarm_id: str
    acknowledged_by: str
    role: str
    acknowledged_at: str
    note: str


class AlarmService:
    def __init__(self, state: FactoryState):
        self.state = state
        self.store = state.store

    def _rule(self, order_id: str, rule_id: str) -> dict:
        order = self.store.get_order(order_id)
        if order is None:
            raise AlarmError([_error('unknown-order', '/orderId', f'work order {order_id} does not exist')])
        if not order.started:
            raise AlarmError([_error('not-started', '/orderId', f'work order {order_id} has not started')])
        for rule in self.store.get_plan(order.plan_id).plan['alarmRules']:
            if rule['ruleId'] == rule_id:
                return rule
        raise AlarmError([_error('unknown-rule', '/ruleId', f"the order's plan has no alarm rule {rule_id}")])

    def raise_alarm(self, order_id: str, rule_id: str, *, now: str, detail: str = '') -> Alarm:
        """Open an alarm and hold its node. A rule that is already alarming returns the open alarm, not a second one."""
        rule = self._rule(order_id, rule_id)
        parse_time(now)
        while True:
            last = self.store.last_alarm(order_id, rule_id)
            if last is not None and self.store.get_ack(last.alarm_id) is None:
                return last
            episode = last.episode + 1 if last else 1
            alarm = Alarm(f'{order_id}:{rule_id}:{episode}', order_id, rule_id, rule['nodeId'], episode, now, detail)
            try:
                self.store.add_alarm(alarm)
            except AlreadyExists:  # a concurrent raise won the episode; return its alarm on the next pass
                continue
            self.store.add_notice(alarm.alarm_id, now)  # the first notice goes out when the alarm is raised
            return alarm

    def repeat_minutes(self, order_id: str, rule_id: str) -> float:
        """The reminder interval from the parameter set the order was pinned to, else the default."""
        order = self.store.get_order(order_id)
        if order.set_version is not None:
            intervals = self.state.params.get(order.plan_id, order.set_version).alarm_intervals
            if rule_id in intervals:
                return intervals[rule_id]
        return DEFAULT_REPEAT_MINUTES

    def status(self, alarm_id: str) -> str:
        self._alarm(alarm_id)
        return 'acknowledged' if self.store.get_ack(alarm_id) else 'open'

    def _alarm(self, alarm_id: str) -> Alarm:
        alarm = self.store.get_alarm(alarm_id)
        if alarm is None:
            raise AlarmError([_error('unknown-alarm', '/alarmId', f'alarm {alarm_id} does not exist')])
        return alarm

    def open_alarms(self, order_id: str | None = None) -> list[Alarm]:
        return [a for a in self.store.list_alarms(order_id) if self.store.get_ack(a.alarm_id) is None]

    def collect_due(self, now: str) -> list[Alarm]:
        """Open alarms whose reminder is due. Each one is recorded as notified now, so it is returned once per interval."""
        moment = parse_time(now)
        due = []
        for alarm in self.open_alarms():
            last = parse_time(self.store.notices(alarm.alarm_id)[-1])
            if moment - last >= timedelta(minutes=self.repeat_minutes(alarm.order_id, alarm.rule_id)):
                self.store.add_notice(alarm.alarm_id, now)
                due.append(alarm)
        return due

    def acknowledge(self, alarm_id: str, *, by: str, role: str, now: str, note: str = '') -> Acknowledgement:
        alarm = self._alarm(alarm_id)
        if role not in ACK_ROLES:
            raise AlarmError([_error('role', '/role', 'only a manager or admin may acknowledge an alarm')])
        if not by:
            raise AlarmError([_error('required', '/acknowledgedBy', 'who acknowledged is required')])
        parse_time(now)
        ack = Acknowledgement(alarm.alarm_id, by, role, now, note)
        try:
            self.store.add_ack(ack)
        except AlreadyExists as error:
            raise AlarmError([_error('already-acknowledged', '/alarmId', str(error))]) from error
        return ack

    def held_nodes(self, order_id: str) -> set[str]:
        return {a.node_id for a in self.open_alarms(order_id)}

    def is_held(self, order_id: str, node_id: str) -> bool:
        return node_id in self.held_nodes(order_id)
