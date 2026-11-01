"""Confirmed outcomes become cases only after approval, and the case library only ever grows by numbered versions."""
import copy
import json

import pytest

from conftest import COMPLAIN_CONFIG, run_and_wait, settings

API = '/api/analytical-four'
MANAGER = {'x-test-role': 'manager'}
OPERATOR = {'x-test-role': 'operator'}


@pytest.fixture
def complaint_run(client, llm):
    """A finished complaint-mode run with the fake LLM, and its events in file order."""
    response = client.put(f'{API}/settings', json=settings(layers={'a': True, 'b': True, 'c': True}, mode='complain', analysisConfig=COMPLAIN_CONFIG,
                                                          llm={'endpoint': llm.url, 'timeoutSeconds': 30, 'apiKeyEnv': ''}))
    assert response.status_code == 200, response.text
    record = run_and_wait(client)
    assert record['state'] == 'succeeded', record['error']
    keys = client.get(f'{API}/runs/{record["runId"]}/result', params={'name': 'search_key_results.json'}).json()
    return record['runId'], [k['event_id'] for k in keys]


def submit(client, run_id, event_id, code='NG-A', headers=MANAGER, **extra):
    return client.post(f'{API}/feedback', headers=headers, json={'runId': run_id, 'eventId': event_id, 'confirmedNg': code, 'actualCause': 'checked on the line', **extra})


def case_files(data):
    return [json.loads(x) for x in (data / 'cases' / 'llm_records.jsonl').read_text(encoding='utf-8').splitlines() if x.strip()]


def test_a_managers_feedback_is_approved_at_once_and_an_operators_waits(client, complaint_run):
    run_id, events = complaint_run
    by_manager = submit(client, run_id, events[0], headers=MANAGER)
    by_operator = submit(client, run_id, events[1], 'NG-B', headers=OPERATOR)
    assert by_manager.status_code == by_operator.status_code == 201
    assert by_manager.json()['status'] == 'approved' and by_manager.json()['decision']['note']  # the self-approval is on the record
    assert by_operator.json()['status'] == 'pending' and by_operator.json()['decision'] is None
    assert [f['status'] for f in client.get(f'{API}/feedback', params={'status': 'pending'}).json()['feedback']] == ['pending']


def test_pending_and_rejected_feedback_never_reach_the_case_library(client, data, complaint_run):
    run_id, events = complaint_run
    waiting = submit(client, run_id, events[0], headers=OPERATOR).json()
    refused = submit(client, run_id, events[1], 'NG-B', headers=OPERATOR).json()
    assert client.post(f'{API}/feedback/{refused["feedbackId"]}/decision', headers=MANAGER, json={'approve': False, 'note': 'not the cause'}).status_code == 200
    nothing = client.post(f'{API}/library/publish', headers=MANAGER)
    assert nothing.status_code == 409 and '沒有新的已核可回饋' in nothing.json()['detail']
    assert case_files(data) == [] and client.get(f'{API}/library/versions').json()['versions'] == []
    assert client.post(f'{API}/feedback/{waiting["feedbackId"]}/decision', headers=MANAGER, json={'approve': True}).status_code == 200
    assert client.post(f'{API}/library/publish', headers=MANAGER).status_code == 201
    assert [c['event_id'] for c in case_files(data)] == [events[0]]  # the rejected one is not in it


def test_every_version_is_kept_and_the_analysis_reads_the_newest(client, data, complaint_run):
    run_id, events = complaint_run
    submit(client, run_id, events[0])
    first = client.post(f'{API}/library/publish', headers=MANAGER).json()
    v1_bytes = (data / 'feedback' / 'library' / 'v0001' / 'llm_records.jsonl').read_bytes()
    submit(client, run_id, events[1], 'NG-B')
    second = client.post(f'{API}/library/publish', headers=MANAGER).json()
    assert (first['version'], second['version'], second['baseVersion']) == (1, 2, 1)
    assert second['recordCount'] == 2 and first['recordCount'] == 1
    assert (data / 'feedback' / 'library' / 'v0001' / 'llm_records.jsonl').read_bytes() == v1_bytes  # history is not rewritten
    assert (data / 'cases' / 'llm_records.jsonl').read_bytes() == (data / 'feedback' / 'library' / 'v0002' / 'llm_records.jsonl').read_bytes()
    assert [v['version'] for v in client.get(f'{API}/library/versions').json()['versions']] == [2, 1]
    assert client.post(f'{API}/library/publish', headers=MANAGER).status_code == 409  # nothing new since v2


def test_a_corrected_feedback_replaces_the_case_in_the_next_version_only(client, data, complaint_run):
    run_id, events = complaint_run
    submit(client, run_id, events[0], 'NG-A')
    client.post(f'{API}/library/publish', headers=MANAGER)
    submit(client, run_id, events[0], 'NG-C')
    second = client.post(f'{API}/library/publish', headers=MANAGER).json()
    assert second['replacedEventIds'] == [events[0]] and second['recordCount'] == 1
    old = json.loads((data / 'feedback' / 'library' / 'v0001' / 'llm_records.jsonl').read_text(encoding='utf-8').splitlines()[0])
    assert old['feedback']['confirmed_ng'] == 'NG-A' and case_files(data)[0]['feedback']['confirmed_ng'] == 'NG-C'


def test_the_next_analysis_finds_the_published_case_for_a_different_product(client, data, llm, complaint_run):
    # The reason the loop exists: a confirmed case must change what the LLM is shown next time.
    run_id, events = complaint_run
    assert all(c['body']['top3_cases'] == [] for c in llm.calls)
    for event in events:
        submit(client, run_id, event)
    assert client.post(f'{API}/library/publish', headers=MANAGER).status_code == 201
    llm.calls.clear()
    # A real complaint is a different product, not a re-run of the same one: give every row a new product number.
    complaint = data / 'data' / 'complaint.csv'
    complaint.write_text(complaint.read_text(encoding='utf-8').replace('CMP-', 'NEW-'), encoding='utf-8')
    again = run_and_wait(client)
    assert again['state'] == 'succeeded'
    assert len(llm.calls) == len(events) and all(c['body']['top3_cases'] for c in llm.calls)
    assert llm.calls[0]['body']['top3_cases'][0]['confirmed_ng'] == 'NG-A'


def test_a_wrong_prediction_lands_in_the_error_file_too(client, data, complaint_run):
    run_id, events = complaint_run
    predictions = client.get(f'{API}/runs/{run_id}/result', params={'name': 'ng_code_analysis.json'}).json()
    predicted = predictions[events[0]]['prediction']['suggested_ng_code']
    wrong = 'NG-D' if predicted != 'NG-D' else 'NG-C'
    entry = submit(client, run_id, events[0], wrong).json()
    right = submit(client, run_id, events[1], predictions[events[1]]['prediction']['suggested_ng_code']).json()
    assert entry['status'] == right['status'] == 'approved'
    manifest = client.post(f'{API}/library/publish', headers=MANAGER).json()
    assert (manifest['recordCount'], manifest['errorRecordCount']) == (2, 1)
    errors = [json.loads(x) for x in (data / 'cases' / 'llm_error_records.jsonl').read_text(encoding='utf-8').splitlines()]
    assert [e['event_id'] for e in errors] == [events[0]] and errors[0]['error_analysis']['was_correct'] is False


def test_a_new_defect_code_is_accepted_and_marked_new(client, complaint_run):
    run_id, events = complaint_run
    new = submit(client, run_id, events[0], 'NG-Z').json()
    known = submit(client, run_id, events[1], 'NG-A').json()
    assert (new['isNewCode'], known['isNewCode']) == (True, False)
    for bad in ['', 'has space', 'x' * 51, 'NG/1', None]:
        assert submit(client, run_id, events[2], bad).status_code == 422, bad


def test_feedback_needs_a_successful_complaint_run_and_a_real_event(client, data):
    client.put(f'{API}/settings', json=settings())
    daily = run_and_wait(client)
    answer = submit(client, daily['runId'], 'anything')
    assert answer.status_code == 409 and '沒有客訴診斷結果' in answer.json()['detail']
    assert submit(client, '20260101T000000Z-aaaaaaaa', 'x').status_code == 404


def test_unknown_event_is_404(client, complaint_run):
    run_id, _ = complaint_run
    assert submit(client, run_id, 'no-such-event').status_code == 404


def record_for(event_id, confirmed='NG-A'):
    return {'event_id': event_id, 'summary': {'anomaly_features': ['PasteIronTemp'], 'sop_keys': ['K-P3-001'], 'categorical': {'P3.Machine_No.': 'P22'}},
            'diagnosis_results': {'suggested_ng_code': 'NG-A', 'score_breakdown': {'anomaly': 20, 'metrics': 10, 'env': 10}},
            'conclusion': {'final_ng': 'NG-A'}, 'feedback': {'confirmed_ng': confirmed, 'actual_cause': 'imported', 'confirmed_by': 'someone-else'}}


def test_import_adds_pending_entries_for_an_operator_and_ignores_the_files_own_claim_of_who_confirmed(client):
    response = client.post(f'{API}/feedback/import', headers=OPERATOR, json={'records': [record_for('e-1'), record_for('e-2', 'NG-Q')]})
    assert response.status_code == 201
    items = response.json()['feedback']
    assert [i['status'] for i in items] == ['pending', 'pending'] and [i['isNewCode'] for i in items] == [False, True]
    assert all(i['submittedBy'] == 'u-1' and i['source'] == 'import' for i in items)


def test_a_bad_record_stops_the_whole_import(client, data):
    good, broken = record_for('e-1'), copy.deepcopy(record_for('e-2'))
    del broken['summary']['sop_keys']
    for records, message in [([good, broken], '第 2 筆'), ([good, record_for('e-1')], '重複'), ([], '非空'), ('x', '非空')]:
        answer = client.post(f'{API}/feedback/import', headers=MANAGER, json={'records': records})
        assert answer.status_code == 422 and message in answer.json()['detail'], records
    assert not (data / 'feedback' / 'entries.jsonl').exists()  # all or nothing


def test_import_size_limits(client):
    many = [record_for(f'e-{i}') for i in range(501)]
    assert client.post(f'{API}/feedback/import', headers=MANAGER, json={'records': many}).status_code == 422
    huge = record_for('e-big')
    huge['summary']['anomaly_features'] = ['x' * 1000] * 200
    assert client.post(f'{API}/feedback/import', headers=MANAGER, json={'records': [huge]}).status_code == 422


def test_each_entry_gets_one_decision(client):
    entry = client.post(f'{API}/feedback/import', headers=OPERATOR, json={'records': [record_for('e-1')]}).json()['feedback'][0]
    url = f'{API}/feedback/{entry["feedbackId"]}/decision'
    assert client.post(url, headers=MANAGER, json={'approve': 'yes'}).status_code == 422
    assert client.post(url, headers=MANAGER, json={'approve': True}).status_code == 200
    assert client.post(url, headers=MANAGER, json={'approve': False}).status_code == 409
    assert client.post(f'{API}/feedback/0123456789abcdef/decision', headers=MANAGER, json={'approve': True}).status_code == 404
    assert client.post(f'{API}/feedback/not-an-id/decision', headers=MANAGER, json={'approve': True}).status_code == 404


def test_publishing_is_refused_while_an_analysis_is_running(client, complaint_run):
    from app.api import routes_analytical_four as routes
    run_id, events = complaint_run
    submit(client, run_id, events[0])
    routes.store().active = '20260101T000000Z-aaaaaaaa'
    try:
        assert client.post(f'{API}/library/publish', headers=MANAGER).status_code == 409
    finally:
        routes.store().active = None
    assert client.post(f'{API}/library/publish', headers=MANAGER).status_code == 201


def test_the_first_version_starts_from_the_case_file_the_operator_already_had(client, data):
    existing = record_for('legacy-1')
    (data / 'cases' / 'llm_records.jsonl').write_text(json.dumps(existing) + '\n', encoding='utf-8')
    client.post(f'{API}/feedback/import', headers=MANAGER, json={'records': [record_for('e-1')]})
    manifest = client.post(f'{API}/library/publish', headers=MANAGER).json()
    assert manifest['startedFromExistingFile'] is True and manifest['recordCount'] == 2
    assert [c['event_id'] for c in case_files(data)] == ['legacy-1', 'e-1']


def test_a_damaged_history_file_is_reported_not_skipped(client, data):
    client.post(f'{API}/feedback/import', headers=MANAGER, json={'records': [record_for('e-1')]})
    with (data / 'feedback' / 'entries.jsonl').open('a', encoding='utf-8') as handle:
        handle.write('{broken\n')
    answer = client.get(f'{API}/feedback')
    assert answer.status_code == 500 and '第 2 行' in answer.json()['detail']


def test_feedback_routes_refuse_a_caller_without_identity(client):
    anonymous = {'x-test-user': ''}
    for method, path in [('post', '/feedback'), ('post', '/feedback/import'), ('get', '/feedback'), ('post', '/feedback/0123456789abcdef/decision'),
                         ('post', '/library/publish'), ('get', '/library/versions')]:
        kwargs = {'json': {}} if method == 'post' and 'publish' not in path else {}
        assert getattr(client, method)(API + path, headers=anonymous, **kwargs).status_code == 401, path
