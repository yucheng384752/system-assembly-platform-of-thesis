"""ParameterSet service (contract 4.9, decisions 19 to 23).

Production parameter values live here, never in the plan. Sets are append-only: a new proposal is a new
version, and approval or rejection is a separate decision record, so nothing is ever edited or deleted.
Who may propose or approve (entry-permission) is decided at the entry point; this module owns the state and the
one rule that does not belong anywhere else: proposer and approver must differ unless the approver is a
manager or admin.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import math

from .canonical import content_sha256

SELF_APPROVE_ROLES = ('manager', 'admin')
SOURCES = ('manual', 'upload')


class ParameterSetError(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__('; '.join(f"{e['code']} {e['path']}: {e['message']}" for e in errors))
        self.errors = errors


def _error(code: str, path: str, message: str) -> dict:
    return {'code': code, 'path': path, 'message': message}


@dataclass(frozen=True)
class ParameterSet:
    plan_id: str
    set_version: int
    content_sha256: str
    values: dict
    tables: dict
    alarm_intervals: dict
    source: str
    source_sha256: str | None
    proposed_by: str
    proposed_at: str
    reason: str


@dataclass(frozen=True)
class Decision:
    plan_id: str
    set_version: int
    status: str  # approved | rejected
    decided_by: str
    decided_at: str
    note: str


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _check_value(param: dict, value: object, path: str) -> list[dict]:
    kind = param['type']
    if kind in ('number', 'quantity'):  # a quantity is a number in the unit the plan declares
        if not _is_number(value):
            return [_error('type', path, f'{param["id"]} must be a number')]
        bounds = param.get('range')
        if bounds and not bounds['min'] <= value <= bounds['max']:
            return [_error('range', path, f"{param['id']} = {value} is outside {bounds['min']} to {bounds['max']}")]
        return []
    if kind == 'string':
        return [] if isinstance(value, str) else [_error('type', path, f'{param["id"]} must be a string')]
    if kind == 'bool':
        return [] if isinstance(value, bool) else [_error('type', path, f'{param["id"]} must be true or false')]
    if kind == 'string[]':
        return [] if isinstance(value, list) and all(isinstance(v, str) for v in value) else [_error('type', path, f'{param["id"]} must be a list of strings')]
    return [_error('type', path, f'unknown parameter type {kind}')]


def _check_table(table: dict, rows: object, path: str) -> list[dict]:
    if not isinstance(rows, list):
        return [_error('type', path, f"{table['tableId']} must be a list of rows")]
    columns = {c['id']: c for c in table['columns']}
    errors: list[dict] = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            errors.append(_error('type', f'{path}/{i}', 'a row must be an object'))
            continue
        for name in row:
            if name not in columns:
                errors.append(_error('unknown-column', f'{path}/{i}/{name}', f"{table['tableId']} has no column {name}"))
        for name, column in columns.items():
            if name not in row or row[name] is None:
                if column['required']:
                    errors.append(_error('required', f'{path}/{i}/{name}', f'{name} is required'))
                continue
            ok = {'number': _is_number, 'string': lambda v: isinstance(v, str), 'bool': lambda v: isinstance(v, bool)}[column['type']](row[name])
            if not ok:
                errors.append(_error('type', f'{path}/{i}/{name}', f"{name} must be a {column['type']}"))
    return errors


def validate_content(plan: dict, values: object, tables: object, alarm_intervals: object) -> list[dict]:
    """Everything a set must satisfy against the plan's declarations. All errors, or none."""
    errors: list[dict] = []
    params = {p['id']: p for p in plan['params']}
    if not isinstance(values, dict):
        errors.append(_error('type', '/values', 'values must be an object'))
    else:
        for key, value in values.items():
            param = params.get(key)
            if param is None:
                errors.append(_error('unknown-param', f'/values/{key}', f'the plan has no parameter {key}'))
            elif not param['tunable']:
                errors.append(_error('not-tunable', f'/values/{key}', f'{key} is not tunable by the factory'))
            else:
                errors.extend(_check_value(param, value, f'/values/{key}'))
    declared = {t['tableId']: t for t in plan['paramTables']}
    if not isinstance(tables, dict):
        errors.append(_error('type', '/tables', 'tables must be an object'))
    else:
        for key, rows in tables.items():
            if key not in declared:
                errors.append(_error('unknown-table', f'/tables/{key}', f'the plan has no parameter table {key}'))
            else:
                errors.extend(_check_table(declared[key], rows, f'/tables/{key}'))
    rules = {r['ruleId'] for r in plan['alarmRules']}
    if not isinstance(alarm_intervals, dict):
        errors.append(_error('type', '/alarmIntervals', 'alarmIntervals must be an object'))
    else:
        for key, minutes in alarm_intervals.items():
            if key not in rules:
                errors.append(_error('unknown-rule', f'/alarmIntervals/{key}', f'the plan has no alarm rule {key}'))
            elif not _is_number(minutes) or minutes <= 0:
                errors.append(_error('range', f'/alarmIntervals/{key}', 'the repeat interval must be a positive number of minutes'))
    return errors


@dataclass
class ParameterSetService:
    """In-memory reference implementation; a database store must keep the same append-only behavior."""
    plans: dict[str, dict]  # planId -> verified plan
    _sets: dict[str, list[ParameterSet]] = field(default_factory=dict)
    _decisions: dict[tuple[str, int], Decision] = field(default_factory=dict)

    def propose(self, plan_id: str, *, values: dict, tables: dict | None = None, alarm_intervals: dict | None = None,
                source: str = 'manual', source_sha256: str | None = None, proposed_by: str, reason: str, now: str) -> ParameterSet:
        plan = self.plans.get(plan_id)
        if plan is None:
            raise ParameterSetError([_error('unknown-plan', '/planId', f'plan {plan_id} is not stored')])
        errors = validate_content(plan, values, tables or {}, alarm_intervals or {})
        if source not in SOURCES:
            errors.append(_error('source', '/source', 'source must be manual or upload'))
        if source == 'upload' and not source_sha256:
            errors.append(_error('source', '/sourceSha256', 'an upload must record the sha256 of the file'))
        if not proposed_by:
            errors.append(_error('required', '/proposedBy', 'the proposer is required'))
        if not reason.strip():
            errors.append(_error('required', '/reason', 'a reason is required'))
        if errors:
            raise ParameterSetError(errors)  # the whole set is refused; nothing is applied in part
        content = {'values': values, 'tables': tables or {}, 'alarmIntervals': alarm_intervals or {}}
        history = self._sets.setdefault(plan_id, [])
        record = ParameterSet(plan_id, len(history) + 1, content_sha256(content), dict(values), dict(tables or {}), dict(alarm_intervals or {}),
                              source, source_sha256, proposed_by, now, reason)
        history.append(record)
        return record

    def decide(self, plan_id: str, set_version: int, *, approve: bool, by: str, role: str, now: str, note: str = '') -> Decision:
        record = self.get(plan_id, set_version)
        if (plan_id, set_version) in self._decisions:
            raise ParameterSetError([_error('already-decided', '/setVersion', f'version {set_version} is already {self.status(plan_id, set_version)}')])
        if approve and by == record.proposed_by and role not in SELF_APPROVE_ROLES:
            raise ParameterSetError([_error('same-person', '/approvedBy', 'the proposer cannot approve their own change; only a manager or admin may')])
        if not approve and not note.strip():
            raise ParameterSetError([_error('required', '/note', 'a rejection needs a reason')])
        decision = Decision(plan_id, set_version, 'approved' if approve else 'rejected', by, now, note)
        self._decisions[(plan_id, set_version)] = decision
        return decision

    def get(self, plan_id: str, set_version: int) -> ParameterSet:
        history = self._sets.get(plan_id, [])
        if not 1 <= set_version <= len(history):
            raise ParameterSetError([_error('unknown-set', '/setVersion', f'plan {plan_id} has no version {set_version}')])
        return history[set_version - 1]

    def status(self, plan_id: str, set_version: int) -> str:
        self.get(plan_id, set_version)
        decision = self._decisions.get((plan_id, set_version))
        return decision.status if decision else 'pending'

    def decision(self, plan_id: str, set_version: int) -> Decision | None:
        return self._decisions.get((plan_id, set_version))

    def history(self, plan_id: str) -> tuple[ParameterSet, ...]:
        return tuple(self._sets.get(plan_id, ()))

    def latest_approved(self, plan_id: str) -> ParameterSet | None:
        """Only approved versions are ever used; pending and rejected ones are skipped."""
        for record in reversed(self._sets.get(plan_id, [])):
            if self.status(plan_id, record.set_version) == 'approved':
                return record
        return None
