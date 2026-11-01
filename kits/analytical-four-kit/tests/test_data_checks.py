"""Every way client data can quietly change a result must be said out loud before the run, or in its record."""
import json

import pandas as pd
import pytest
from pydantic import ValidationError

from app.analytical_four.data_checks import inspect
from app.analytical_four.settings import Settings
from conftest import COMPLAIN_CONFIG, run_and_wait, settings

API = '/api/analytical-four'


def make(**override):
    base = {'layers': {'a': True, 'b': True, 'c': False}, 'mode': 'daily'}
    base.update(override)
    return Settings.model_validate(base)


def complaint(**override):
    return make(mode='complain', analysisConfig=COMPLAIN_CONFIG, **override)


def codes(findings):
    return [f.code for f in findings]


def edit_csv(root, relative, change):
    path = root / relative
    frame = pd.read_csv(path)
    change(frame).to_csv(path, index=False)


def edit_config(root, change, name='analysis_config_complaint.json'):
    path = root / 'config' / name
    config = json.loads(path.read_text(encoding='utf-8'))
    change(config)
    path.write_text(json.dumps(config), encoding='utf-8')


def test_the_demo_data_passes_in_both_modes_with_nothing_to_warn_about(data):
    for report in (inspect(make(layers={'a': True, 'b': True, 'c': True})), inspect(complaint(layers={'a': True, 'b': True, 'c': True}))):
        assert report.errors == [] and report.warnings == []
    daily = inspect(make()).summary
    assert (daily['sampleGroup'], daily['baselineGroup']) == (0, 1)  # which group is diagnosed is stated, not guessed


def test_a_baseline_with_empty_cells_is_named_because_complaint_mode_does_not_clean_it(data):
    edit_csv(data, 'data/baseline.csv', lambda f: f.assign(pasteirontemp=[None] * 5 + list(f['pasteirontemp'][5:])))
    errors = inspect(complaint()).errors
    assert codes(errors) == ['baseline-empty-cells'] and 'pasteirontemp 5 筆' in errors[0].message


def test_text_in_a_number_column_names_the_column_and_the_text(data):
    edit_csv(data, 'data/baseline.csv', lambda f: f.assign(Burr=['abc'] + list(f['Burr'][1:])))
    errors = inspect(complaint()).errors
    assert codes(errors) == ['not-numeric'] and 'Burr' in errors[0].message and 'abc' in errors[0].message


def test_a_repeated_id_that_would_merge_two_events_is_an_error_but_only_among_the_rows_that_become_events(data):
    edit_csv(data, 'data/complaint.csv', lambda f: f.assign(**{'Produce_No.': ['CMP-1', 'CMP-1'] + list(f['Produce_No.'][2:])}))
    assert codes(inspect(complaint()).errors) == ['id-duplicate']
    # daily mode: a repeat inside the baseline group is harmless, a repeat among the diagnosed rows is not
    def dup_baseline_group(frame):
        ok = frame.index[frame['Finish'] == 1][:2]
        frame.loc[ok[1], 'Produce_No.'] = frame.loc[ok[0], 'Produce_No.']
        return frame
    edit_csv(data, 'data/current_daily.csv', dup_baseline_group)
    assert inspect(make()).errors == []
    def dup_diagnosed(frame):
        ng = frame.index[frame['Finish'] == 0][:2]
        frame.loc[ng[1], 'Produce_No.'] = frame.loc[ng[0], 'Produce_No.']
        return frame
    edit_csv(data, 'data/current_daily.csv', dup_diagnosed)
    assert codes(inspect(make()).errors) == ['id-duplicate']


def test_missing_target_categorical_and_numeric_columns_are_reported_together_and_by_name(data):
    edit_csv(data, 'data/complaint.csv', lambda f: f.drop(columns=['Finish', 'Slitting machine', 'Winder number', 'Burr']))
    report = inspect(complaint())
    assert sorted(codes(report.errors)) == ['categorical', 'target']
    assert 'Slitting machine' in next(f.message for f in report.errors if f.code == 'categorical') and 'Winder number' in next(f.message for f in report.errors if f.code == 'categorical')
    assert codes(report.warnings).count('numeric-missing') == 1 and 'Burr' in report.warnings[0].message


def test_no_numeric_feature_at_all_is_an_error(data):
    edit_csv(data, 'data/complaint.csv', lambda f: f[['Produce_No.', 'Finish']])
    assert 'numeric' in codes(inspect(complaint()).errors)


@pytest.mark.parametrize('key,value,code', [('observer', 'LINE1', 'observer'), ('method', 'median', 'method'), ('serializer', 'ACME', 'serializer')])
def test_values_the_engine_would_silently_replace_are_refused(data, key, value, code):
    edit_config(data, lambda c: c.update({key: value}))
    assert codes(inspect(complaint()).errors) == [code]


def test_observer_naming_a_group_that_does_not_exist_is_refused(data):
    edit_config(data, lambda c: c.update({'observer': 'P2', 'feature': {'P1': c['feature']['P1']}}))
    assert codes(inspect(complaint()).errors) == ['observer-group']


def test_a_one_row_baseline_cannot_give_a_standard_deviation(data):
    edit_csv(data, 'data/baseline.csv', lambda f: f.head(1))
    assert 'baseline-rows' in codes(inspect(complaint()).errors)


def test_a_baseline_no_longer_than_the_feature_count_runs_but_is_flagged(data):
    edit_csv(data, 'data/baseline.csv', lambda f: f.head(12))
    report = inspect(complaint())
    assert report.errors == [] and 'baseline-small' in codes(report.warnings)  # 12 rows for 12 features: runs, means little


def test_a_baseline_column_with_one_value_is_flagged(data):
    edit_csv(data, 'data/baseline.csv', lambda f: f.assign(pasteirontemp=235.0))
    assert 'baseline-constant' in codes(inspect(complaint()).warnings)


def test_rows_with_empty_cells_that_the_engine_will_drop_are_counted(data):
    edit_csv(data, 'data/complaint.csv', lambda f: f.assign(pasteirontemp=[None] + list(f['pasteirontemp'][1:])))
    report = inspect(complaint())
    assert report.errors == [] and 'rows-dropped' in codes(report.warnings)
    assert '1 列' in report.warnings[0].message and 'pasteirontemp' in report.warnings[0].message


def test_daily_mode_needs_two_groups_and_says_when_it_ignores_others(data):
    edit_csv(data, 'data/current_daily.csv', lambda f: f.assign(Finish=1))
    assert codes(inspect(make()).errors) == ['target-groups']
    edit_csv(data, 'data/current_daily.csv', lambda f: f.assign(Finish=[0, 1, 2] * (len(f) // 3)))
    assert 'target-extra-groups' in codes(inspect(make()).warnings)


def test_daily_b_layer_needs_the_defect_code_column_and_some_labels(data):
    edit_csv(data, 'data/current_daily.csv', lambda f: f.drop(columns=['P3.NG_code']))
    assert 'ng-column' in codes(inspect(make()).errors)  # the configured column is also missing, which is reported too


def test_daily_b_layer_warns_when_no_diagnosed_row_has_a_defect_code(data):
    edit_csv(data, 'data/current_daily.csv', lambda f: f.assign(**{'P3.NG_code': 0}))
    assert 'ng-labels' in codes(inspect(make()).warnings)


def test_complaint_b_layer_needs_a_filled_known_base(data):
    (data / 'known_base.json').write_text('{}', encoding='utf-8')
    assert codes(inspect(complaint()).errors) == ['known-base']


def test_missing_context_columns_warn_and_a_column_mapping_removes_the_warning(data):
    for relative in ('data/baseline.csv', 'data/complaint.csv'):
        edit_csv(data, relative, lambda f: f.rename(columns={'P3.Machine_No.': 'Press', 'P3.NG_code': 'DefectCode'}))
    edit_config(data, lambda c: [g.update({'categorical': {k: ['Press' if x == 'P3.Machine_No.' else 'DefectCode' if x == 'P3.NG_code' else x for x in v]
                                                           for k, v in g['categorical'].items()}}) for g in c['feature'].values()])
    unmapped = inspect(complaint())
    assert 'context-missing' in codes(unmapped.warnings) and 'P3.Machine_No.' in next(f.message for f in unmapped.warnings if f.code == 'context-missing')
    # the config names the site's columns, so the mapping translates them to the names the engine reads for the context
    edit_config(data, lambda c: [g.update({'categorical': {k: ['P3.Machine_No.' if x == 'Press' else 'P3.NG_code' if x == 'DefectCode' else x for x in v]
                                                           for k, v in g['categorical'].items()}}) for g in c['feature'].values()])
    mapped = inspect(complaint(columnMapping={'Press': 'P3.Machine_No.', 'DefectCode': 'P3.NG_code'}))
    assert mapped.errors == [] and mapped.warnings == []


def test_a_mapping_that_would_create_two_columns_with_one_name_is_an_error(data):
    edit_csv(data, 'data/complaint.csv', lambda f: f.assign(Press='x'))
    errors = inspect(complaint(columnMapping={'Press': 'P3.Machine_No.'})).errors
    assert codes(errors) == ['mapping-collision']


def test_a_mapping_for_a_column_the_file_does_not_have_is_a_warning(data):
    report = inspect(complaint(columnMapping={'Nope': 'Burr'}))
    assert report.errors == [] and codes(report.warnings).count('mapping-unused') == 2  # once per file


def test_topology_and_sop_files_that_do_not_fit_are_reported(data):
    topology = data / 'config' / 'topology.json'
    config = json.loads(topology.read_text(encoding='utf-8'))
    config['topology']['P3']['feature'][0]['name'] = 'paste iron'
    topology.write_text(json.dumps(config), encoding='utf-8')
    with (data / 'config' / 'knowledge.csv').open('a', encoding='utf-8') as handle:
        handle.write('K-X,P3,Burr,Method,cause with, a comma,action,source\n')
    report = inspect(make(layers={'a': True, 'b': True, 'c': True}))
    assert {'topology-unmatched', 'topology-uncovered', 'sop-fields'} <= set(codes(report.warnings))
    assert report.errors == []


def test_a_broken_case_file_is_an_error_in_complaint_mode_only(data):
    (data / 'cases' / 'llm_records.jsonl').write_text('{"ok": 1}\n{broken\n', encoding='utf-8')
    assert codes(inspect(complaint(layers={'a': True, 'b': True, 'c': True})).errors) == ['case-json']
    assert inspect(make(layers={'a': True, 'b': True, 'c': True})).errors == []


def test_settings_refuse_an_ambiguous_or_untidy_mapping():
    with pytest.raises(ValidationError, match='同一個名稱'):
        make(columnMapping={'a': 'X', 'b': 'X'})
    for bad in ({' a': 'X'}, {'a': ''}, {'a ': 'X'}):
        with pytest.raises(ValidationError):
            make(columnMapping=bad)


def test_a_run_is_refused_with_the_reasons_and_nothing_is_started(client, data):
    client.put(f'{API}/settings', json=settings(mode='complain', analysisConfig=COMPLAIN_CONFIG))
    edit_csv(data, 'data/baseline.csv', lambda f: f.assign(Burr=['abc'] + list(f['Burr'][1:])))
    answer = client.post(f'{API}/runs')
    assert answer.status_code == 409 and '資料檢查未通過' in answer.json()['detail'] and 'Burr' in answer.json()['detail']
    assert client.get(f'{API}/runs').json()['runs'] == []
    report = client.get(f'{API}/data-check').json()
    assert report['ok'] is False and report['errors'][0]['code'] == 'not-numeric'


def test_warnings_and_the_rows_the_engine_dropped_end_up_in_the_run_record(client, data):
    edit_csv(data, 'data/current_daily.csv', lambda f: f.assign(pasteirontemp=[None] + list(f['pasteirontemp'][1:])))
    client.put(f'{API}/settings', json=settings())
    record = run_and_wait(client)
    assert record['state'] == 'succeeded'
    messages = [w['message'] for w in record['warnings']]
    assert any('1 列' in m and '因含空值被刪除' in m for m in messages) and {w['code'] for w in record['warnings']} >= {'rows-dropped', 'run-note'}


def test_columns_renamed_by_the_site_give_the_same_diagnosis_once_mapped(client, data):
    mapping = {'Press': 'P3.Machine_No.', 'DefectCode': 'P3.NG_code'}
    for relative in ('data/baseline.csv', 'data/complaint.csv'):
        edit_csv(data, relative, lambda f: f.rename(columns={v: k for k, v in mapping.items()}))
    client.put(f'{API}/settings', json=settings(mode='complain', analysisConfig=COMPLAIN_CONFIG, columnMapping=mapping))
    record = run_and_wait(client)
    assert record['state'] == 'succeeded', record['error']
    events = [json.loads(p.read_text(encoding='utf-8')) for p in sorted((data / 'runs' / record['runId'] / 'results' / 'serialized_events').glob('*.json'))]
    assert all(e['context']['P3.Machine_No.'] in ('P21', 'P22') for e in events)  # the machine reached the event instead of None
