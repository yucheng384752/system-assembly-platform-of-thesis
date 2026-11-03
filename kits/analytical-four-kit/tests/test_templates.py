"""The templates a client downloads must be things the Kit actually accepts."""
import json

from app.analytical_four.data_checks import CONTEXT_COLUMNS, inspect, ng_code_column
from app.analytical_four.settings import Settings, save_settings

API = '/api/analytical-four'
EXAMPLES = {'analysis_config.template.json': 'config/analysis_config.json', 'ng_code.template.json': 'config/ng_code.json',
            'topology.template.json': 'config/topology.json', 'knowledge.template.csv': 'config/knowledge.csv',
            'current-data.example.csv': 'data/current_daily.csv', 'baseline.example.csv': 'data/baseline.csv'}


def test_every_listed_template_downloads_with_its_declared_type(client):
    listed = client.get(f'{API}/templates').json()['templates']
    assert {t['name'] for t in listed} >= {'requirements-form.md', 'column-dictionary.csv', 'column-mapping.template.json', *EXAMPLES}
    for item in listed:
        answer = client.get(f'{API}/templates/{item["name"]}')
        assert answer.status_code == 200 and answer.headers['content-type'].startswith(item['contentType']), item['name']
        assert len(answer.content) == item['bytes'] > 0
        assert f'filename="{item["name"]}"' in answer.headers['content-disposition']


def test_only_catalog_names_are_served(client):
    for name in ['nope', '..%2Fsettings.json', '%2e%2e%2f%2e%2e%2fsettings.json', 'requirements-form.md%00', 'C%3A%5Cwindows%5Cwin.ini']:
        assert client.get(f'{API}/templates/{name}').status_code == 404, name


def test_template_routes_need_an_actor(client):
    for path in ('/templates', '/templates/requirements-form.md'):
        assert client.get(API + path, headers={'x-test-user': ''}).status_code == 401


def test_the_mapping_template_targets_exactly_the_columns_the_engine_reads_by_name(client):
    mapping = client.get(f'{API}/templates/column-mapping.template.json').json()
    # If the engine's fixed column list changes, the template that tells clients what to map must change with it.
    assert set(mapping.values()) == {*CONTEXT_COLUMNS, ng_code_column('All')}
    assert all(key.startswith('<') for key in mapping)  # placeholders, never a real site's column name


def test_the_column_dictionary_has_the_columns_the_guide_promises(client):
    header = client.get(f'{API}/templates/column-dictionary.csv').content.decode('utf-8-sig').splitlines()[0]
    assert header.split(',') == ['原始欄名', '分析欄名', '意義', '型別', '單位', '缺值意義', '角色']


def test_the_example_files_together_make_a_data_set_the_checks_accept(client, tmp_path, monkeypatch):
    root = tmp_path / 'from-templates'
    monkeypatch.setenv('ANALYTICAL_FOUR_DATA_DIR', str(root))
    for name, target in EXAMPLES.items():
        path = root / target
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(client.get(f'{API}/templates/{name}').content)
    (root / 'known_base.json').write_text(json.dumps({'NG-A': {}}), encoding='utf-8')
    settings = Settings.model_validate({'layers': {'a': True, 'b': True, 'c': True}, 'mode': 'daily'})
    save_settings(settings, root)
    report = inspect(settings, root)
    assert report.errors == [] and report.warnings == []
