"""The local LLM adapter must say so when the model could not answer, and must not listen on the network by default."""
import importlib.util
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests

from app.analytical_four.pipeline import Analytical_Four_System, PipelineError

TOOL = Path(__file__).resolve().parents[1] / 'tools' / 'local_llm_adapter.py'


def load_adapter():
    spec = importlib.util.spec_from_file_location('local_llm_adapter_under_test', TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeOllama:
    def __init__(self, status=200, content=None):
        self.status, self.content, self.requests = status, content, []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                outer.requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                body = json.dumps({'message': {'content': outer.content}}).encode()
                self.send_response(outer.status)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_port}/api/chat'


@pytest.fixture
def adapter():
    started = []

    def start(ollama):
        module = load_adapter()
        module.OLLAMA_CHAT_URL = ollama.url
        server = ThreadingHTTPServer(('127.0.0.1', 0), module.DiagnoseHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        started.append(server)
        return f'http://127.0.0.1:{server.server_port}/diagnose'

    yield start
    for server in started:
        server.shutdown()


GOOD = json.dumps({'evidence_for': ['a'], 'evidence_against': [], 'uncertainty': 'u', 'case_agreement': True,
                   'similar_cases': ['c-1', 'invented'],
                   'conclusion': {'final_ng': 'NG-A', 'source': 's', 'confidence': 'high', 'action': 'x', 'needs_human': False}})
EVENT = {'event_id': 'e-1', 'summary': {'k': 1}, 'diagnosis_results': {'suggested_ng_code': 'NG-A'}}


def test_a_model_answer_keeps_the_event_and_only_trusts_case_ids_that_were_offered(adapter):
    url = adapter(FakeOllama(content=GOOD))
    answer = requests.post(url, json={'new_event': EVENT, 'top3_cases': [{'event_id': 'c-1'}]}, timeout=10)
    assert answer.status_code == 200
    body = answer.json()
    assert body['summary'] == {'k': 1} and body['conclusion']['final_ng'] == 'NG-A'
    assert body['llm_analysis']['similar_cases'] == ['c-1']  # the model's invented id is dropped


@pytest.mark.parametrize('ollama', [FakeOllama(status=500, content='x'), FakeOllama(content='not json'), FakeOllama(content=None)])
def test_when_the_model_cannot_answer_the_caller_gets_502_not_a_placeholder_result(adapter, ollama):
    url = adapter(ollama)
    answer = requests.post(url, json={'new_event': EVENT, 'top3_cases': []}, timeout=10)
    assert answer.status_code == 502 and answer.json()['error'] == 'llm_unavailable'
    assert 'llm_analysis' not in answer.json() and 'conclusion' not in answer.json()


def test_the_kit_marks_its_llm_step_failed_with_the_status_when_the_adapter_says_502(adapter):
    url = adapter(FakeOllama(status=500, content='x'))
    stub = SimpleNamespace(llm_api=url, llm_api_key=None, llm_timeout=10)
    with pytest.raises(PipelineError, match='HTTP 502'):
        Analytical_Four_System._post_llm(stub, {'new_event': EVENT, 'top3_cases': []})


def test_bad_requests_are_refused(adapter):
    url = adapter(FakeOllama(content=GOOD))
    assert requests.post(url.replace('/diagnose', '/other'), json={}, timeout=10).status_code == 404
    assert requests.post(url, data=b'not json', timeout=10).status_code == 400
    assert requests.post(url, json={'no_event': 1}, timeout=10).status_code == 400


def test_by_default_it_listens_on_the_loopback_only(monkeypatch):
    for name in ('ADAPTER_HOST', 'ADAPTER_PORT', 'OLLAMA_URL', 'OLLAMA_MODEL'):
        monkeypatch.delenv(name, raising=False)
    module = load_adapter()
    assert (module.LISTEN_HOST, module.LISTEN_PORT, module.MODEL_NAME) == ('127.0.0.1', 8001, 'qwen3:14b')
    monkeypatch.setenv('ADAPTER_HOST', '0.0.0.0')  # exposing it is a decision, made explicitly
    assert load_adapter().LISTEN_HOST == '0.0.0.0'
