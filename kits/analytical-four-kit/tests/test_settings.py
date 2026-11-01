"""Settings must refuse combinations that can only fail later, and must keep every file path inside the data directory."""
import pytest
from pydantic import ValidationError

from app.analytical_four.settings import (
    Settings, SettingsError, derive_config, load_settings, readiness, resolve_inside, save_settings,
)


def make(**override):
    base = {'layers': {'a': True, 'b': True, 'c': False}, 'mode': 'daily'}
    base.update(override)
    return Settings.model_validate(base)


def test_b_and_c_need_a():
    # Without A there is no serialized event for B or C to work on.
    with pytest.raises(ValidationError, match='A 層'):
        make(layers={'a': False, 'b': True, 'c': False})
    with pytest.raises(ValidationError, match='A 層'):
        make(layers={'a': False, 'b': False, 'c': True})


def test_complaint_mode_c_needs_b_but_daily_mode_does_not():
    # The compile step reads B's predictions; daily mode never gets that far.
    with pytest.raises(ValidationError, match='B 層'):
        make(layers={'a': True, 'b': False, 'c': True}, mode='complain')
    assert make(layers={'a': True, 'b': False, 'c': True}, mode='daily').enabled() == ['a', 'c']


@pytest.mark.parametrize('endpoint', ['ftp://host/x', 'host-without-scheme', 'http://user:pw@host/x', 'http://host/a b', 'file:///etc/passwd'])
def test_llm_endpoint_must_be_plain_http_without_credentials(endpoint):
    with pytest.raises(ValidationError):
        make(llm={'endpoint': endpoint})


def test_llm_endpoint_may_be_empty_or_http():
    assert make(llm={'endpoint': ''}).llm.endpoint == ''
    assert make(llm={'endpoint': 'http://10.0.0.5:8001/diagnose'}).llm.endpoint.endswith('/diagnose')


def test_api_key_is_a_variable_name_never_a_value():
    # A mixed-case value with punctuation is how a pasted secret looks; it must not be accepted as a name.
    with pytest.raises(ValidationError):
        make(llm={'apiKeyEnv': 'sk-abc.123'})
    assert make(llm={'apiKeyEnv': 'LLM_API_KEY'}).llm.apiKeyEnv == 'LLM_API_KEY'


@pytest.mark.parametrize('path', ['../outside.json', '/etc/passwd', 'C:/Windows/win.ini', 'a/../../b.json', ''])
def test_paths_cannot_leave_the_data_directory(tmp_path, path):
    with pytest.raises(SettingsError):
        resolve_inside(tmp_path, path, 'x')


def test_analysis_config_paths_are_confined(data):
    # A hand-edited analysis config must not be able to point the engine at files outside the data directory.
    config = data / 'config' / 'analysis_config.json'
    config.write_text(config.read_text(encoding='utf-8').replace('data/current_daily.csv', '../../secret.csv'), encoding='utf-8')
    problems = readiness(make())
    assert problems['a'] and problems['a'][0].code == 'config'
    with pytest.raises(SettingsError, match='資料目錄'):
        derive_config(make())


def test_empty_data_directory_reports_the_missing_analysis_config(tmp_path, monkeypatch):
    monkeypatch.setenv('ANALYTICAL_FOUR_DATA_DIR', str(tmp_path / 'empty'))
    problems = readiness(make())
    assert [p.code for p in problems['a']] == ['config'] and [p.code for p in problems['b']] == ['config']
    assert '找不到分析設定檔' in problems['a'][0].message


def test_demo_data_is_ready_for_every_layer_except_the_unset_llm_address(data):
    daily = readiness(make(layers={'a': True, 'b': True, 'c': True}))
    assert all(not items for items in daily.values())
    complaint = readiness(make(layers={'a': True, 'b': True, 'c': True}, mode='complain', analysisConfig='config/analysis_config_complaint.json'))
    assert [p.code for p in complaint['c']] == ['llm-endpoint']


def test_missing_api_key_variable_blocks_the_c_layer(data, monkeypatch):
    monkeypatch.delenv('LLM_API_KEY', raising=False)
    s = make(layers={'a': True, 'b': True, 'c': True}, mode='complain', analysisConfig='config/analysis_config_complaint.json',
             llm={'endpoint': 'http://127.0.0.1:9/x', 'apiKeyEnv': 'LLM_API_KEY'})
    assert [p.code for p in readiness(s)['c']] == ['llm-key']


def test_save_and_load_round_trip(tmp_path):
    s = make(llm={'endpoint': 'http://host/x', 'timeoutSeconds': 45})
    save_settings(s, tmp_path)
    assert load_settings(tmp_path) == s


def test_atomic_replace_waits_out_a_reader_instead_of_failing(tmp_path, monkeypatch):
    # On Windows a status poll that has the file open makes os.replace raise PermissionError for a moment.
    import os
    from app.analytical_four import settings as module
    real, attempts = os.replace, {'n': 0}

    def flaky(source, target):
        attempts['n'] += 1
        if attempts['n'] < 4:
            raise PermissionError('in use')
        return real(source, target)

    monkeypatch.setattr(module.os, 'replace', flaky)
    (tmp_path / 'a.tmp').write_text('new', encoding='utf-8')
    (tmp_path / 'a').write_text('old', encoding='utf-8')
    module.atomic_replace(tmp_path / 'a.tmp', tmp_path / 'a')
    assert (tmp_path / 'a').read_text(encoding='utf-8') == 'new' and attempts['n'] == 4
