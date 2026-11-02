"""The supporting files are checked for what would crash, corrupt or silently weaken a run."""
import json
from pathlib import Path

from app.analytical_four import seed_demo
from app.analytical_four.data_checks import inspect
from app.analytical_four.format_checks import (
    check_analysis_config, check_case_records, check_knowledge, check_ng_code, check_topology, validate_case_record,
)
from app.analytical_four.settings import Settings

DEMO = seed_demo.DEMO / 'config'


def codes(findings, severity=None):
    return [f.code for f in findings if severity in (None, f.severity)]


def write(tmp_path, name, value):
    path = tmp_path / name
    path.write_text(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False), encoding='utf-8')
    return path


def demo_json(name):
    return json.loads((DEMO / name).read_text(encoding='utf-8'))


def test_the_demo_files_pass_every_format_check():
    assert check_ng_code(DEMO / 'ng_code.json') == []
    assert check_topology(DEMO / 'topology.json') == []
    assert check_knowledge(DEMO / 'knowledge.csv') == []
    assert check_analysis_config(demo_json('analysis_config.json')) == []


def test_ng_definitions_that_would_crash_or_mislead(tmp_path):
    assert codes(check_ng_code(write(tmp_path, 'a.json', '{broken'))) == ['ng-format']
    assert codes(check_ng_code(write(tmp_path, 'b.json', {'category': 'NG-A'}))) == ['ng-format']  # an object, not the array of definitions
    assert codes(check_ng_code(write(tmp_path, 'c.json', [{'details': []}]))) == ['ng-format']
    assert codes(check_ng_code(write(tmp_path, 'd.json', [{'category': 'NG-A', 'details': []}]))) == ['ng-format']
    twice = demo_json('ng_code.json') + [demo_json('ng_code.json')[0]]
    assert 'ng-duplicate' in codes(check_ng_code(write(tmp_path, 'e.json', twice)), 'error')


def test_a_defect_with_no_cause_or_action_is_a_warning_because_the_diagnosis_would_show_blanks(tmp_path):
    definitions = demo_json('ng_code.json')
    definitions[0]['details'][0]['action'] = ''
    found = check_ng_code(write(tmp_path, 'a.json', definitions))
    assert codes(found) == ['ng-detail'] and 'action' in found[0].message and found[0].severity == 'warning'


def test_topology_structure_errors_are_the_ones_the_engine_would_die_on(tmp_path):
    base = demo_json('topology.json')
    missing_level = json.loads(json.dumps(base))
    del missing_level['topology']['P1']['feature'][0]['level']
    assert codes(check_topology(write(tmp_path, 'a.json', missing_level)), 'error') == ['topology-format']
    assert codes(check_topology(write(tmp_path, 'b.json', {'process': {}, 'topology': {}}))) == ['topology-format']
    no_stations = json.loads(json.dumps(base))
    no_stations['process']['stations'][0]['order'] = 'first'
    assert codes(check_topology(write(tmp_path, 'c.json', no_stations))) == ['topology-format']
    same_id = json.loads(json.dumps(base))
    same_id['topology']['P2']['feature'][0]['id'] = same_id['topology']['P1']['feature'][0]['id']
    assert 'topology-duplicate' in codes(check_topology(write(tmp_path, 'd.json', same_id)), 'error')


def test_topology_things_the_engine_skips_are_warnings(tmp_path):
    base = json.loads(json.dumps(demo_json('topology.json')))
    base['topology']['P9'] = {'feature': []}  # a station that is not in the process
    base['topology']['P1']['feature'][0]['role'] = 'mystery'
    found = check_topology(write(tmp_path, 'a.json', base))
    assert sorted(codes(found)) == ['topology-role', 'topology-station'] and all(f.severity == 'warning' for f in found)


def test_sop_files_with_no_rows_a_changed_header_or_repeated_ids(tmp_path):
    header = 'Knowledge_ID,Station_ID,Feature_Target,Issue_Category,Root_Cause_Description,Recommended_Action,Source_Ref\n'
    assert codes(check_knowledge(write(tmp_path, 'a.csv', header))) == ['sop-format']  # retrieval would find nothing
    assert codes(check_knowledge(write(tmp_path, 'b.csv', header.replace('Source_Ref', 'Source') + 'K1,P1,x,y,z,w,v\n'))) == ['sop-header']
    twice = header + 'K1,P1,x,y,z,w,v\nK1,P1,x2,y,z,w,v\n'
    assert codes(check_knowledge(write(tmp_path, 'c.csv', twice))) == ['sop-duplicate']
    blank = header + 'K1,P1,,y,z,w,v\n'
    assert codes(check_knowledge(write(tmp_path, 'd.csv', blank))) == ['sop-target']


def test_analysis_config_structure(tmp_path):
    config = demo_json('analysis_config.json')
    config['feature']['P1']['numerical'] = 'Actual Temp_C1'
    config['feature']['P2']['categorical'] = {'Man': 'Quality inspection'}
    config['feature']['P3']['target'] = 5
    found = check_analysis_config(config)
    assert codes(found) == ['config-feature'] * 3 and all(f.severity == 'error' for f in found)
    assert codes(check_analysis_config({'feature': {}})) == ['config-feature']
    doubled = demo_json('analysis_config.json')
    doubled['feature']['P1']['numerical'].append(doubled['feature']['P1']['numerical'][0])
    assert codes(check_analysis_config(doubled)) == ['config-duplicate']


def record(event_id='e-1'):
    return {'event_id': event_id, 'summary': {'anomaly_features': [], 'sop_keys': [], 'categorical': {}},
            'diagnosis_results': {'score_breakdown': {'anomaly': 1, 'metrics': 1, 'env': 1}}, 'conclusion': {}, 'feedback': {}}


def test_case_files_are_checked_record_by_record_and_blank_lines_are_fine(tmp_path):
    good = write(tmp_path, 'a.jsonl', json.dumps(record()) + '\n\n' + json.dumps(record('e-2')) + '\n')
    assert check_case_records(good, '歷史案例檔') == []
    assert check_case_records(write(tmp_path, 'empty.jsonl', ''), '歷史案例檔') == []
    broken = write(tmp_path, 'b.jsonl', json.dumps(record()) + '\n{broken\n')
    found = check_case_records(broken, '歷史案例檔')
    assert codes(found) == ['case-json'] and '第 2 行' in found[0].message
    wrong = record()
    del wrong['summary']['sop_keys']
    found = check_case_records(write(tmp_path, 'c.jsonl', json.dumps(wrong) + '\n'), '誤判案例檔')
    assert codes(found) == ['case-record'] and 'sop_keys' in found[0].message and '第 1 行' in found[0].message
    assert validate_case_record(record(), 'x') is None


def test_inspect_uses_the_checks_and_reports_a_code_the_data_has_but_the_definitions_lack(data):
    definitions = demo_json('ng_code.json')
    path = data / 'config' / 'ng_code.json'
    path.write_text(json.dumps([d for d in definitions if d['category'] != 'NG-D']), encoding='utf-8')
    report = inspect(Settings.model_validate({'layers': {'a': True, 'b': True, 'c': False}, 'mode': 'daily'}))
    found = [f for f in report.warnings if f.code == 'ng-undefined']
    assert report.errors == [] and len(found) == 1 and 'NG-D' in found[0].message


def test_inspect_blocks_a_run_on_a_defect_file_the_engine_would_choke_on(data):
    (data / 'config' / 'ng_code.json').write_text('[{"category": "NG-A"}]', encoding='utf-8')
    report = inspect(Settings.model_validate({'layers': {'a': True, 'b': True, 'c': False}, 'mode': 'daily'}))
    assert codes(report.errors) == ['ng-format']


def test_inspect_blocks_a_run_on_a_topology_missing_required_fields(data):
    path = data / 'config' / 'topology.json'
    topology = json.loads(path.read_text(encoding='utf-8'))
    del topology['topology']['P3']['feature'][0]['name']
    path.write_text(json.dumps(topology), encoding='utf-8')
    report = inspect(Settings.model_validate({'layers': {'a': True, 'b': False, 'c': True}, 'mode': 'daily'}))
    assert 'topology-format' in codes(report.errors)
    assert Path(path).exists()
