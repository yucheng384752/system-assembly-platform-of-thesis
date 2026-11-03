"""The Kit's description files must say what the code does: the AoV follows the real stage order, the contract lists the real routes."""
import json
import re
from pathlib import Path

from app.analytical_four.offline_vectors import HashEncoder
from app.analytical_four.runs import COMPLAIN_ONLY, STAGES

KIT = Path(__file__).resolve().parents[1]
REPO = KIT.parents[1]


def load(path: Path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def test_aov_describes_every_run_stage_in_execution_order():
    workflow = load(KIT / 'workflow.aov.json')
    nodes = {n['id']: n for n in workflow['nodes']}
    order = [stage_id for stage_id, _layer, _name in STAGES]
    assert set(order) <= set(nodes), 'a stage the run records has no step in the AoV'
    # an edge between two stages may never run against the order the run executes them in
    for edge in workflow['edges']:
        if edge['from'] in order and edge['to'] in order:
            assert order.index(edge['from']) < order.index(edge['to']), edge
    # each stage belongs to the sub-feature of its layer, so switching a layer off in Composer drops exactly its steps
    for stage_id, layer, _name in STAGES:
        assert nodes[stage_id].get('subfeatureId') == f'layer-{layer}', stage_id


def test_aov_has_no_step_that_the_run_does_not_perform():
    workflow = load(KIT / 'workflow.aov.json')
    stage_ids = {s[0] for s in STAGES}
    after_run = {'submit-feedback', 'approve-feedback', 'publish-library'}  # steps that follow a run rather than being part of one
    run_steps = {n['id'] for n in workflow['nodes'] if n.get('subfeatureId')} - after_run
    assert run_steps == stage_ids


def test_complaint_only_stages_are_the_ones_that_need_the_b_layers_predictions():
    assert COMPLAIN_ONLY == {'compile', 'search-key', 'similarity', 'llm'}
    layer_of = {s[0]: s[1] for s in STAGES}
    assert {layer_of[s] for s in COMPLAIN_ONLY} == {'c'}


def test_contract_registry_and_routes_agree():
    source = (KIT / 'src/backend/app/api/routes_analytical_four.py').read_text(encoding='utf-8')
    routes = {(m.group(1).upper(), m.group(2)) for m in re.finditer(r"@router\.(get|post|put|patch|delete)\('([^']*)'", source)}
    contract = load(KIT / 'kit.contract.json')
    provided = {(a['method'], a['path']) for a in contract['provides']['api']}
    registry = load(REPO / 'config/registry/analytical-four-kit.json')
    registered = {(c['method'], c['path']) for c in registry['capabilities']}
    assert routes == provided == registered
    in_entry_points = [r['capability'] for e in contract['entryPoints'] for r in e['routes']]
    assert sorted(in_entry_points) == sorted(a['capability'] for a in contract['provides']['api'])


def test_changing_settings_needs_the_admin_entry_not_the_run_entry():
    # Only the setting that sends event data elsewhere (the LLM address) justifies the narrower role list.
    contract = load(KIT / 'kit.contract.json')
    entries = {e['key']: e for e in contract['entryPoints']}
    configure = {r['capability'] for r in entries['analytical_four.configure']['routes']}
    assert 'analytical-four.settings.put' in configure
    assert entries['analytical_four.configure']['defaultRoles'] == ['admin']
    assert 'audit' not in entries['analytical_four.run']['defaultRoles']


def test_builtin_hash_encoder_is_deterministic_and_prefers_shared_wording():
    encoder = HashEncoder()
    a, b = encoder.encode(['paste iron temperature abnormal', 'rewind torque abnormal'])
    query = encoder.encode('paste iron temperature')
    assert (encoder.encode('x y z') == encoder.encode('x y z')).all()
    assert float(query @ a) > float(query @ b)
    assert abs(float((a * a).sum()) - 1.0) < 1e-5
