"""A file is judged where it is staged, and only a file that passes is put where the analysis reads."""
import json

import pandas as pd
import pytest

from app.analytical_four import uploads as uploads_module
from conftest import COMPLAIN_CONFIG, settings

API = '/api/analytical-four'
ADMIN = {'x-test-role': 'admin'}


def upload(client, kind, content, filename='client.csv'):
    body = content if isinstance(content, bytes) else content.encode('utf-8')
    return client.post(f'{API}/uploads', params={'kind': kind, 'filename': filename}, content=body, headers={'content-type': 'application/octet-stream'})


def accept(client, upload_id, replace=None):
    return client.post(f'{API}/uploads/{upload_id}/accept', json={} if replace is None else {'replace': replace})


def csv_text(data, relative, change=lambda f: f):
    return change(pd.read_csv(data / relative)).to_csv(index=False)


def test_a_good_file_is_staged_with_a_report_and_nothing_is_placed_until_it_is_accepted(client, data):
    before = (data / 'data' / 'current_daily.csv').read_bytes()
    answer = upload(client, 'current-data', csv_text(data, 'data/current_daily.csv'))
    meta = answer.json()
    assert answer.status_code == 201 and meta['status'] == 'staged' and meta['report']['ok'] is True
    assert meta['kind'] == 'current-data' and meta['target'] == 'data/current_daily.csv' and len(meta['sha256']) == 64
    assert (data / 'data' / 'current_daily.csv').read_bytes() == before  # staged is not placed
    assert (data / 'uploads' / meta['uploadId'] / 'content').is_file()


def test_replacing_an_existing_file_needs_an_explicit_yes_and_keeps_the_old_one(client, data):
    old = (data / 'data' / 'current_daily.csv').read_text(encoding='utf-8')
    new = csv_text(data, 'data/current_daily.csv', lambda f: f.assign(**{'Produce_No.': 'X' + f['Produce_No.']}))
    meta = upload(client, 'current-data', new).json()
    refused = accept(client, meta['uploadId'])
    assert refused.status_code == 409 and 'replace' in refused.json()['detail']
    assert (data / 'data' / 'current_daily.csv').read_text(encoding='utf-8') == old
    done = accept(client, meta['uploadId'], True)
    assert done.status_code == 200 and done.json()['status'] == 'accepted'
    assert 'X' in (data / 'data' / 'current_daily.csv').read_text(encoding='utf-8')
    backup = data / done.json()['replacedBackup']
    assert backup.read_text(encoding='utf-8') == old  # what was there is still there, under uploads/replaced
    assert accept(client, meta['uploadId'], True).status_code == 409  # one decision per upload


def test_a_file_with_errors_is_reported_and_can_never_be_accepted(client, data):
    client.put(f'{API}/settings', json=settings())
    bad = csv_text(data, 'data/current_daily.csv', lambda f: f.assign(Burr=['abc'] + list(f['Burr'][1:])))
    meta = upload(client, 'current-data', bad).json()
    assert meta['report']['ok'] is False and [e['code'] for e in meta['report']['errors']] == ['not-numeric']
    refused = accept(client, meta['uploadId'], True)
    assert refused.status_code == 409 and 'Burr' in refused.json()['detail']
    assert 'abc' not in (data / 'data' / 'current_daily.csv').read_text(encoding='utf-8')


def test_an_upload_is_judged_by_its_own_problems_not_by_the_files_around_it(client, data):
    # The baseline already in place is broken. Uploading a good complaint file must not be blocked by it,
    # and the baseline problem is shown as something else to fix.
    client.put(f'{API}/settings', json=settings(mode='complain', analysisConfig=COMPLAIN_CONFIG))
    path = data / 'data' / 'baseline.csv'
    frame = pd.read_csv(path)
    frame.loc[:3, 'Burr'] = None
    frame.to_csv(path, index=False)
    meta = upload(client, 'current-data', csv_text(data, 'data/complaint.csv')).json()
    assert meta['report']['ok'] is True
    assert [i['code'] for i in meta['report']['otherIssues']] == ['baseline-empty-cells'] and meta['report']['otherIssues'][0]['source'] == 'baseline'
    assert accept(client, meta['uploadId'], True).status_code == 200
    # and the way out of the broken baseline is the same route
    fixed = upload(client, 'baseline-data', csv_text(data, 'data/baseline.csv', lambda f: f.fillna(235.0)))
    assert fixed.json()['report']['ok'] is True and fixed.json()['report']['otherIssues'] == []


def test_a_first_file_for_a_location_that_is_still_empty_needs_no_replace(client, data):
    (data / 'config' / 'ng_code.json').unlink()
    meta = upload(client, 'ng-code', (seed_ng(data)), 'defects.json').json()
    assert meta['report']['ok'] is True
    assert accept(client, meta['uploadId']).status_code == 200
    assert (data / 'config' / 'ng_code.json').is_file()


def seed_ng(data):
    from app.analytical_four import seed_demo
    return (seed_demo.DEMO / 'config' / 'ng_code.json').read_text(encoding='utf-8')


@pytest.mark.parametrize('kind,content,code', [
    ('ng-code', '[{"category": "NG-A"}]', 'ng-format'),
    ('topology', '{"process": {}, "topology": {}}', 'topology-format'),
    ('knowledge', 'Knowledge_ID,Station_ID,Feature_Target,Issue_Category,Root_Cause_Description,Recommended_Action,Source_Ref\n', 'sop-format'),
    ('analysis-config', '{"feature": {}}', 'config'),
    ('analysis-config', '{"feature": {"P1": {"numerical": "Burr"}}, "data_source": {"current_data": {}, "baseline_data": {}, "case_data": {}, "rag_setting": {"builder_type": "x", "db_path": "x", "collection_name": "x"}}}', 'config-feature'),
])
def test_each_kind_is_checked_by_its_own_format_check(client, data, kind, content, code):
    meta = upload(client, kind, content).json()
    assert meta['report']['ok'] is False and code in [e['code'] for e in meta['report']['errors']]
    assert accept(client, meta['uploadId'], True).status_code == 409


def test_a_new_analysis_config_is_checked_and_then_replaces_the_one_in_settings(client, data):
    config = (data / 'config' / 'analysis_config.json').read_text(encoding='utf-8')
    meta = upload(client, 'analysis-config', config.replace('IQR Thresholds', '3sigma')).json()
    assert meta['report']['ok'] is True and meta['target'] == 'config/analysis_config.json'
    assert accept(client, meta['uploadId'], True).status_code == 200
    assert '3sigma' in (data / 'config' / 'analysis_config.json').read_text(encoding='utf-8')


def test_nothing_is_staged_for_a_bad_kind_an_empty_file_or_one_over_the_size_limit(client, data, monkeypatch):
    assert upload(client, 'passwords', 'x').status_code == 422
    assert upload(client, 'ng-code', b'').status_code == 422
    monkeypatch.setattr(uploads_module, 'MAX_BYTES', 10)
    assert upload(client, 'ng-code', 'x' * 50).status_code == 413
    assert not (data / 'uploads').exists() or list((data / 'uploads').iterdir()) == []  # no half-staged folders


def test_the_client_filename_is_only_a_label_and_never_a_path(client, data):
    meta = upload(client, 'ng-code', seed_ng(data), '..\\..\\..\\windows\\evil.json').json()
    assert meta['filename'] == 'evil.json' and meta['target'] == 'config/ng_code.json'
    assert not (data.parent / 'windows').exists()
    for bad in ['../x', '0123456789abcdeg', 'short']:
        assert client.get(f'{API}/uploads/{bad}').status_code == 404


def test_accepting_is_refused_while_an_analysis_is_running(client, data):
    from app.api import routes_analytical_four as routes
    meta = upload(client, 'ng-code', seed_ng(data)).json()
    routes.store().active = '20260101T000000Z-aaaaaaaa'
    try:
        assert accept(client, meta['uploadId'], True).status_code == 409
    finally:
        routes.store().active = None
    assert accept(client, meta['uploadId'], True).status_code == 200


def test_replace_must_be_a_boolean(client, data):
    meta = upload(client, 'ng-code', seed_ng(data)).json()
    assert client.post(f'{API}/uploads/{meta["uploadId"]}/accept', json={'replace': 'yes'}).status_code == 422


def test_case_files_cannot_be_swapped_once_the_library_has_versions(client, data):
    # The next publish builds from the newest version, so a swapped-in file would silently disappear.
    record = {'event_id': 'e-1', 'summary': {'anomaly_features': [], 'sop_keys': [], 'categorical': {}},
              'diagnosis_results': {'suggested_ng_code': 'NG-A', 'score_breakdown': {'anomaly': 1, 'metrics': 1, 'env': 1}},
              'conclusion': {'final_ng': 'NG-A'}, 'feedback': {'confirmed_ng': 'NG-A'}}
    first = upload(client, 'case-records', json.dumps(record) + '\n', 'cases.jsonl').json()
    assert first['report']['ok'] is True and accept(client, first['uploadId'], True).status_code == 200  # no versions yet: it becomes the starting point
    imported = client.post(f'{API}/feedback/import', headers={'x-test-role': 'manager'}, json={'records': [{**record, 'event_id': 'e-2'}]})
    assert imported.status_code == 201
    assert client.post(f'{API}/library/publish', headers={'x-test-role': 'manager'}).status_code == 201
    second = upload(client, 'case-records', json.dumps(record) + '\n').json()
    refused = accept(client, second['uploadId'], True)
    assert refused.status_code == 409 and '匯入回饋' in refused.json()['detail']


def test_a_discarded_upload_loses_its_content_and_cannot_be_accepted(client, data):
    meta = upload(client, 'ng-code', seed_ng(data)).json()
    discarded = client.delete(f'{API}/uploads/{meta["uploadId"]}')
    assert discarded.status_code == 200 and discarded.json()['status'] == 'discarded'
    assert not (data / 'uploads' / meta['uploadId'] / 'content').exists() and (data / 'uploads' / meta['uploadId'] / 'meta.json').is_file()
    assert accept(client, meta['uploadId'], True).status_code == 409
    assert client.delete(f'{API}/uploads/{meta["uploadId"]}').status_code == 409


def test_the_list_is_newest_first_and_leaves_the_reports_to_the_detail_view(client, data):
    first = upload(client, 'ng-code', seed_ng(data)).json()
    second = upload(client, 'ng-code', '[]').json()
    listed = client.get(f'{API}/uploads').json()['uploads']
    assert [u['uploadId'] for u in listed] == [second['uploadId'], first['uploadId']]
    assert (listed[0]['ok'], listed[0]['errorCount'], 'report' in listed[0]) == (False, 1, False)
    assert client.get(f'{API}/uploads/{second["uploadId"]}').json()['report']['errors'][0]['code'] == 'ng-format'


def test_upload_routes_need_an_actor(client):
    anonymous = {'x-test-user': ''}
    assert client.post(f'{API}/uploads', params={'kind': 'ng-code'}, content=b'x', headers=anonymous).status_code == 401
    assert client.get(f'{API}/uploads', headers=anonymous).status_code == 401
    assert client.get(f'{API}/uploads/0123456789abcdef', headers=anonymous).status_code == 401
    assert client.post(f'{API}/uploads/0123456789abcdef/accept', json={}, headers=anonymous).status_code == 401
    assert client.delete(f'{API}/uploads/0123456789abcdef', headers=anonymous).status_code == 401
