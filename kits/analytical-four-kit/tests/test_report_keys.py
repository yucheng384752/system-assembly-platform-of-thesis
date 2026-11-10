"""A report sentence can be said in the page's language only if the finding says which sentence it is and with what values."""
import ast
import json
from pathlib import Path


from app.analytical_four import data_checks, format_checks
from conftest import COMPLAIN_CONFIG, settings
from test_data_checks import edit_csv

API = '/api/analytical-four'
SOURCES = [Path(data_checks.__file__), Path(format_checks.__file__)]


def finding_calls():
    for path in SOURCES:
        for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'Finding' and len(node.args) >= 4:
                yield path.name, node


def test_every_finding_the_checks_build_carries_a_key_unless_its_text_comes_from_elsewhere():
    # The one sentence without a key is the settings error text of the `config` finding, which settings.py words itself.
    missing = [f'{name}:{node.lineno}' for name, node in finding_calls()
               if not any(k.arg == 'key' for k in node.keywords) and not (isinstance(node.args[3], ast.Call))]
    assert missing == [], 'give these findings a key= and params=, and an English sentence in labels.ts: ' + ', '.join(missing)


def test_keys_are_unique_so_each_english_sentence_says_one_thing():
    keys = [k.value.value for _, node in finding_calls() for k in node.keywords if k.arg == 'key']
    assert len(keys) == len(set(keys)) and len(keys) > 50


def test_the_data_check_route_sends_the_key_and_the_values_a_page_needs(client, data):
    client.put(f'{API}/settings', json=settings(mode='complain', analysisConfig=COMPLAIN_CONFIG))
    edit_csv(data, 'data/baseline.csv', lambda f: f.assign(Burr=['abc'] + list(f['Burr'][1:])))
    error = client.get(f'{API}/data-check').json()['errors'][0]
    assert error['code'] == 'not-numeric' and 'Burr' in error['message']  # the Chinese sentence is still there
    assert error['key'] == 'not-numeric.1'
    assert error['params'] == {'label': {'term': 'baseline-data'}, 'column': 'Burr', 'count_text': 1, 'items': {'items': ['abc'], 'total': 1}}


def test_a_case_record_problem_says_which_problem_and_where(client, data):
    client.put(f'{API}/settings', json=settings(mode='complain', analysisConfig=COMPLAIN_CONFIG, layers={'a': True, 'b': True, 'c': True}))
    (data / 'cases' / 'llm_records.jsonl').write_text('{"ok": 1}'+chr(10), encoding='utf-8')
    error = next(e for e in client.get(f'{API}/data-check').json()['errors'] if e['code'] == 'case-record')
    assert error['key'] == 'case-record.1'
    assert error['params'] == {'label': {'term': 'case-records'}, 'number': 1, 'problem': {'key': 'event-id', 'params': {}}}


def test_a_term_travels_as_its_key_and_a_problem_as_its_key_and_values():
    term = format_checks.Term('current-data', '待分析資料')
    problem = format_checks.Problem('x：超過 5 位元組', 'too-big', {'bytes': 5})
    finding = format_checks.Finding('error', 'a', 'c', f'{term}壞了', key='k.1', params={'label': term, 'problem': problem, 'n': 3,
                                    'names': format_checks.names_param(['a', 'b', 'c'], 2)})
    body = finding.as_json()
    assert body['message'] == '待分析資料壞了'  # the Chinese sentence is untouched
    assert body['params'] == {'label': {'term': 'current-data'}, 'problem': {'key': 'too-big', 'params': {'bytes': 5}}, 'n': 3,
                              'names': {'items': ['a', 'b'], 'total': 3}}
    assert 'key' not in format_checks.Finding('error', 'a', 'c', 'plain').as_json()
