"""Receiving an executable plan (contract section 6): integrity first, then what the factory itself relies on.

The plan is immutable and content addressed. Nothing here edits it; a plan that cannot be used to create work
orders is still stored for viewing, with the reasons.
"""
from __future__ import annotations

from dataclasses import dataclass
import copy

from .canonical import CanonicalError, content_sha256, parse_json

FORMAT = 'composer-executable-plan'
SUPPORTED_VERSIONS = (1,)
REQUIRED = ('source', 'scope', 'nodes', 'flows', 'businessOnly', 'artifactTypes', 'params', 'paramTables', 'alarmRules', 'rules', 'stages', 'order')
EXECUTORS = ('manual', 'auto', 'system')
# Nodes that make the factory evaluate expressions at run time (guard, judge): their meaning depends on the evaluator version.
EVALUATED_KEYS = ('guard', 'route', 'decision', 'checks', 'verdicts')


class PlanRejected(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__('; '.join(f"{e['code']} {e['path']}: {e['message']}" for e in errors))
        self.errors = errors


def _error(code: str, path: str, message: str) -> dict:
    return {'code': code, 'path': path, 'message': message}


@dataclass(frozen=True)
class ReceivedPlan:
    plan: dict
    plan_id: str
    blockers: tuple[dict, ...]  # non-executable nodes: {nodeId, reason}

    @property
    def executable(self) -> bool:
        return not self.blockers

    @property
    def needs_evaluator(self) -> bool:
        return any(n['category'] == 'judge' or any(k in n for k in EVALUATED_KEYS) for n in self.plan['nodes'])


def plan_id_of(plan: dict) -> str:
    return content_sha256({key: value for key, value in plan.items() if key != 'planId'})


def receive_plan(document: str | dict) -> ReceivedPlan:
    """Parse, verify and return the plan; raise PlanRejected with located errors. Never partially accepts."""
    try:
        plan = parse_json(document) if isinstance(document, str) else copy.deepcopy(document)
    except ValueError as error:
        raise PlanRejected([_error('broken-structure', '/', f'not valid JSON: {error}')]) from error
    if not isinstance(plan, dict):
        raise PlanRejected([_error('broken-structure', '/', 'a plan must be an object')])
    if plan.get('format') != FORMAT:
        raise PlanRejected([_error('unknown-format', '/format', f'expected {FORMAT}')])
    if plan.get('formatVersion') not in SUPPORTED_VERSIONS:
        raise PlanRejected([_error('unknown-version', '/formatVersion', f"version {plan.get('formatVersion')!r} is not supported; no guessing")])
    missing = [key for key in ('planId', *REQUIRED) if key not in plan]
    if missing:
        raise PlanRejected([_error('broken-structure', '/' + key, 'required field is missing') for key in missing])
    try:
        recomputed = plan_id_of(plan)
    except CanonicalError as error:
        raise PlanRejected([_error('broken-structure', '/', str(error))]) from error
    if plan['planId'] != recomputed:
        raise PlanRejected([_error('plan-id-mismatch', '/planId', f"declared {plan['planId']} but the content hashes to {recomputed}")])

    try:
        errors = _check_structure(plan)
    except (KeyError, TypeError, AttributeError, IndexError) as error:
        raise PlanRejected([_error('broken-structure', '/', f'a field the factory relies on is missing or has the wrong shape: {error!r}')]) from error
    if errors:
        raise PlanRejected(errors)
    blockers = tuple({'nodeId': n['nodeId'], 'reason': n['reason']} for n in plan['nodes'] if not n['executable'])
    return ReceivedPlan(plan=plan, plan_id=plan['planId'], blockers=blockers)


def _check_structure(plan: dict) -> list[dict]:
    errors: list[dict] = []
    nodes = plan['nodes']
    if not isinstance(nodes, list) or not isinstance(plan['flows'], list):
        return [_error('broken-structure', '/nodes', 'nodes and flows must be arrays')]
    by_id: dict[str, dict] = {}
    for i, node in enumerate(nodes):
        path = f'/nodes/{i}'
        if not isinstance(node, dict) or not isinstance(node.get('nodeId'), str):
            errors.append(_error('broken-structure', path, 'node needs a nodeId'))
            continue
        if node['nodeId'] in by_id:
            errors.append(_error('duplicate-node', path, f"node id {node['nodeId']} appears twice"))
        by_id[node['nodeId']] = node
        if node.get('executable') is True:
            binding = node.get('binding')
            if not (isinstance(binding, dict) and binding.get('capability') and binding.get('kitId')):
                errors.append(_error('missing-binding', path + '/binding', 'an executable node needs capability and kitId'))
            if node.get('executor') not in EXECUTORS:
                errors.append(_error('missing-executor', path + '/executor', 'an executable node needs an executor'))
            if 'reason' in node:
                errors.append(_error('contradiction', path + '/reason', 'an executable node must not carry a reason'))
        elif node.get('executable') is False:
            if not node.get('reason'):
                errors.append(_error('missing-reason', path + '/reason', 'a non-executable node must say why'))
        else:
            errors.append(_error('broken-structure', path + '/executable', 'executable must be true or false'))

    flows: dict[str, dict] = {}
    for i, flow in enumerate(plan['flows']):
        path = f'/flows/{i}'
        flows[flow['id']] = flow
        for end, direction in (('from', 'outputs'), ('to', 'inputs')):
            ref = flow[end]
            node = by_id.get(ref['node'])
            port = next((p for p in (node or {}).get(direction, []) if p['port'] == ref['port']), None)
            if node is None or port is None:
                errors.append(_error('dangling-flow', f'{path}/{end}', f"{ref['node']}.{ref['port']} is not a port of an existing node"))
            elif flow['id'] not in port['flows']:
                errors.append(_error('port-flow-mismatch', f'{path}/{end}', f"port {ref['node']}.{ref['port']} does not list flow {flow['id']}"))
    for node in by_id.values():
        for p in (*node.get('inputs', []), *node.get('outputs', [])):
            for flow_id in p['flows']:
                if flow_id not in flows:
                    errors.append(_error('dangling-flow', f"/nodes/{node['nodeId']}/{p['port']}", f'lists unknown flow {flow_id}'))
    if sorted(plan['order']) != sorted(by_id):
        errors.append(_error('order-mismatch', '/order', 'order must list every node exactly once'))
    else:
        position = {node_id: i for i, node_id in enumerate(plan['order'])}
        for flow in flows.values():
            if flow['from']['node'] in position and flow['to']['node'] in position and position[flow['from']['node']] >= position[flow['to']['node']]:
                errors.append(_error('order-violation', '/order', f"flow {flow['id']} runs backwards in the order"))
    for i, param in enumerate(plan['params']):
        if param.get('tunable') and 'default' not in param:
            errors.append(_error('missing-default', f'/params/{i}', 'a tunable parameter needs a default'))
    return errors


def work_order_blockers(received: ReceivedPlan, *, active_kits: set[str], form_hashes: dict[str, str], evaluator_commit: str | None) -> list[dict]:
    """Conditions for creating a work order from a stored plan (contract section 6); empty means allowed."""
    plan = received.plan
    errors = [_error('not-executable', f"/nodes/{b['nodeId']}", b['reason']) for b in received.blockers]
    for node in plan['nodes']:
        binding = node.get('binding')
        if binding and binding['kitId'] not in active_kits:
            errors.append(_error('kit-not-active', f"/nodes/{node['nodeId']}/binding", f"kit {binding['kitId']} is not in the current selection"))
        form = node.get('form')
        if form:
            actual = form_hashes.get(form['formId'])
            if actual != form['contentSha256']:
                errors.append(_error('form-mismatch', f"/nodes/{node['nodeId']}/form", f"form {form['formId']} is " + ('unavailable' if actual is None else 'different from the one the plan was built with')))
    if received.needs_evaluator and evaluator_commit != plan['source']['aovCoreCommit']:
        errors.append(_error('evaluator-mismatch', '/source/aovCoreCommit', f"evaluator {evaluator_commit!r} differs from the plan's {plan['source']['aovCoreCommit']}; a guard could mean something else at run time"))
    return errors
