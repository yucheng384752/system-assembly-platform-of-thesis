"""End to end: a run does what the layers promise, and every way it can go wrong ends in a recorded, explained state."""
import json

import pytest

from app.analytical_four import seed_demo
from app.analytical_four.runs import RunStore
from conftest import COMPLAIN_CONFIG, run_and_wait, settings, wait_for

API = '/api/analytical-four'
PLANTED = ['NG-A', 'NG-B', 'NG-C', 'NG-D', 'NG-A', 'NG-C']  # the defect behind each demo complaint row, in file order


def put(client, **override):
    response = client.put(f'{API}/settings', json=settings(**override))
    assert response.status_code == 200, response.text
    return response.json()


def stages(record):
    return {s['id']: s['state'] for s in record['stages']}


def test_every_route_refuses_a_caller_without_an_actor(client):
    # The entry-permission middleware is what authenticates; a route reached without it must not answer.
    anonymous = {'x-test-user': ''}
    for method, path in [('get', '/settings'), ('put', '/settings'), ('get', '/status'), ('post', '/demo'), ('post', '/runs'),
                         ('get', '/runs'), ('get', '/runs/20260101T000000Z-aaaaaaaa'), ('get', '/runs/20260101T000000Z-aaaaaaaa/results'),
                         ('get', '/runs/20260101T000000Z-aaaaaaaa/result?name=x')]:
        kwargs = {'json': settings()} if method == 'put' else {}
        assert getattr(client, method)(API + path, headers=anonymous, **kwargs).status_code == 401, path


def test_daily_run_diagnoses_the_ng_rows_and_trains_the_known_base(client, data, monkeypatch):
    scratch = data.parent / 'cwd'
    scratch.mkdir()
    monkeypatch.chdir(scratch)  # the server's working directory is not writable and is not ours to litter
    put(client, layers={'a': True, 'b': True, 'c': True})
    known = data / 'known_base.json'
    known.unlink()  # prove the daily run writes it, instead of finding the shipped copy
    record = run_and_wait(client)
    assert record['state'] == 'succeeded', record['error']
    assert stages(record) == {'read-data': 'done', 'descriptive': 'done', 'diagnostic': 'done', 'ng-code': 'done', 'topology': 'done',
                              'rag': 'done', 'compile': 'skipped', 'search-key': 'skipped', 'similarity': 'skipped', 'llm': 'skipped'}
    base = json.loads(known.read_text(encoding='utf-8'))
    assert set(base) == {'NG-A', 'NG-B', 'NG-C', 'NG-D'}
    # the library shipped with the demo must be what a daily run produces from the shipped data; if the engine or the
    # generator changes, regenerate it (docs/analytical-four-kit.md, section 5)
    assert base == json.loads((seed_demo.DEMO / 'known_base.json').read_text(encoding='utf-8'))
    # nothing may be written relative to the working directory: not the distribution library, not debug output
    assert list(scratch.iterdir()) == []
    names = client.get(f'{API}/runs/{record["runId"]}/results').json()['results']
    assert 'known_base.json' in names and 'rag_analysis.json' in names and 'LLM_responses.json' not in names


def test_a_layer_alone_stops_after_the_diagnosis(client):
    put(client, layers={'a': True, 'b': False, 'c': False})
    record = run_and_wait(client)
    assert record['state'] == 'succeeded'
    assert set(stages(record)) == {'read-data', 'descriptive', 'diagnostic'}
    names = client.get(f'{API}/runs/{record["runId"]}/results').json()['results']
    assert not any(n.startswith('topology/') for n in names) and 'ng_code_analysis.json' not in names


def test_complaint_run_names_the_planted_defect_and_sends_each_event_to_the_llm(client, llm, monkeypatch):
    monkeypatch.setenv('LLM_API_KEY', 'test-token')
    put(client, layers={'a': True, 'b': True, 'c': True}, mode='complain', analysisConfig=COMPLAIN_CONFIG,
        llm={'endpoint': llm.url, 'timeoutSeconds': 30, 'apiKeyEnv': 'LLM_API_KEY'})
    record = run_and_wait(client)
    assert record['state'] == 'succeeded', record['error']
    assert all(state == 'done' for state in stages(record).values())
    run_id = record['runId']
    compiled = client.get(f'{API}/runs/{run_id}/result', params={'name': 'compilation_events.json'}).json()
    predictions = client.get(f'{API}/runs/{run_id}/result', params={'name': 'ng_code_analysis.json'}).json()
    got = [(e['context']['P3.NG_code'], predictions[e['event_id']]['prediction']['suggested_ng_code']) for e in compiled]
    assert [g[1] for g in got] == PLANTED  # the diagnosis names the defect that was planted in the data
    assert len(llm.calls) == 6 and all(c['authorization'] == 'Bearer test-token' for c in llm.calls)
    # the run record says whether an address was set, never what it was
    assert record['llm'] == {'endpointSet': True, 'apiKeyEnv': 'LLM_API_KEY'}
    assert llm.url not in json.dumps(record) and 'test-token' not in json.dumps(record)


def test_rag_retrieves_the_sop_for_the_anomalous_feature(client):
    put(client, layers={'a': True, 'b': True, 'c': True})
    record = run_and_wait(client)
    rag = client.get(f'{API}/runs/{record["runId"]}/result', params={'name': 'rag_analysis.json'}).json()
    hits = {feature: docs[0] for event in rag.values() for feature, docs in event.items() if docs}
    assert 'Paste iron temperature' in hits['pasteirontemp'] and 'Heat gun' in hits['Heat gun temperature']


def test_a_run_is_refused_while_a_layer_is_not_ready(client):
    put(client, layers={'a': True, 'b': True, 'c': True}, mode='complain', analysisConfig=COMPLAIN_CONFIG)
    response = client.post(f'{API}/runs')
    assert response.status_code == 409 and '尚未填寫 LLM 服務位址' in response.json()['detail']
    assert client.get(f'{API}/runs').json()['runs'] == []  # nothing was started


def test_complaint_run_with_an_empty_known_base_is_refused_before_it_starts(client, data, llm):
    # An empty library would otherwise produce an error dict per event and a confident-looking but empty result.
    put(client, layers={'a': True, 'b': True, 'c': False}, mode='complain', analysisConfig=COMPLAIN_CONFIG)
    (data / 'known_base.json').write_text('{}', encoding='utf-8')
    answer = client.post(f'{API}/runs')
    assert answer.status_code == 409 and '不良特徵分布庫' in answer.json()['detail']
    assert client.get(f'{API}/runs').json()['runs'] == []


def test_llm_error_status_fails_the_llm_stage_without_hiding_earlier_results(client, llm):
    llm.status = 500
    put(client, layers={'a': True, 'b': True, 'c': True}, mode='complain', analysisConfig=COMPLAIN_CONFIG,
        llm={'endpoint': llm.url, 'timeoutSeconds': 30, 'apiKeyEnv': ''})
    record = run_and_wait(client)
    assert record['state'] == 'failed' and record['error']['stage'] == 'llm'
    assert record['error']['message'] == 'LLM 服務回應 HTTP 500'  # the status code is what tells an operator the service, not the network, said no
    assert stages(record)['similarity'] == 'done'
    assert 'LLM_responses.json' not in client.get(f'{API}/runs/{record["runId"]}/results').json()['results']


def test_data_without_the_target_column_is_refused_and_names_it(client, data):
    put(client)
    (data / 'data' / 'current_daily.csv').write_text('a,b\n1,2\n', encoding='utf-8')
    answer = client.post(f'{API}/runs')
    assert answer.status_code == 409 and 'Finish' in answer.json()['detail']


def test_a_configured_feature_missing_from_the_data_is_reported_not_silently_dropped(client, data):
    put(client, layers={'a': True, 'b': False, 'c': False})
    path = data / 'data' / 'current_daily.csv'
    import pandas as pd
    pd.read_csv(path).drop(columns=['Burr']).to_csv(path, index=False)
    record = run_and_wait(client)
    assert record['state'] == 'succeeded'
    detail = next(s['detail'] for s in record['stages'] if s['id'] == 'read-data')
    assert '1 個設定的數值特徵在資料中找不到' in detail


def test_only_one_run_at_a_time(client):
    put(client)
    first = client.post(f'{API}/runs')
    assert first.status_code == 202
    second = client.post(f'{API}/runs')
    assert second.status_code == 409 and first.json()['runId'] in second.json()['detail']
    assert wait_for(client, first.json()['runId'])['state'] == 'succeeded'
    again = client.post(f'{API}/runs')  # free again once the first one ended
    assert again.status_code == 202
    wait_for(client, again.json()['runId'])


def test_result_names_come_only_from_the_run_folder(client):
    put(client, layers={'a': True, 'b': False, 'c': False})
    record = run_and_wait(client)
    run_id = record['runId']
    assert client.get(f'{API}/runs/{run_id}/result', params={'name': 'baseline.json'}).status_code == 200
    for name in ['../settings.snapshot.json', '../../settings.json', 'results/baseline.json', 'C:/Windows/win.ini', 'serialized_events']:
        assert client.get(f'{API}/runs/{run_id}/result', params={'name': name}).status_code == 404, name
    assert client.get(f'{API}/runs/..%2F..%2Fsettings/results').status_code in (404, 422)
    assert client.get(f'{API}/runs/not-a-run-id').status_code == 404


def test_a_run_left_running_by_a_dead_process_is_marked_failed(data):
    # Status lives in files, so a crash would otherwise leave a run that looks alive forever and blocks a new one.
    store = RunStore(data)
    directory = data / 'runs' / '20260101T000000Z-deadbeef'
    directory.mkdir(parents=True)
    (directory / 'status.json').write_text(json.dumps({
        'runId': '20260101T000000Z-deadbeef', 'state': 'running', 'finishedAt': None, 'error': None,
        'stages': [{'id': 'read-data', 'state': 'done'}, {'id': 'descriptive', 'state': 'running'}, {'id': 'diagnostic', 'state': 'pending'}]}), encoding='utf-8')
    listed = RunStore(data).list()
    assert listed[0]['state'] == 'failed' and '中斷' in listed[0]['error']['message']
    assert [s['state'] for s in listed[0]['stages']] == ['done', 'interrupted', 'interrupted']
    assert store.active is None


def test_demo_load_never_overwrites_an_operators_file(client, data):
    config = data / 'config' / 'topology.json'
    config.write_text('{"mine": true}', encoding='utf-8')
    response = client.post(f'{API}/demo')
    assert response.status_code == 201 and 'config/topology.json' not in response.json()['copied']
    assert json.loads(config.read_text(encoding='utf-8')) == {'mine': True}


def test_settings_put_rejects_an_unusable_combination_and_keeps_the_old_file(client, data):
    put(client)
    before = (data / 'settings.json').read_text(encoding='utf-8')
    bad = client.put(f'{API}/settings', json=settings(layers={'a': False, 'b': True, 'c': False}))
    assert bad.status_code == 422 and 'A 層' in json.dumps(bad.json(), ensure_ascii=False)
    assert (data / 'settings.json').read_text(encoding='utf-8') == before
