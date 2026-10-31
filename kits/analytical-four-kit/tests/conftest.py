import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1] / 'src' / 'backend'
sys.path.insert(0, str(BACKEND))

from app.analytical_four import seed_demo  # noqa: E402
from app.api import routes_analytical_four  # noqa: E402

COMPLAIN_CONFIG = 'config/analysis_config_complaint.json'


@pytest.fixture
def data(tmp_path, monkeypatch):
    """A data directory holding the synthetic demo data set."""
    root = tmp_path / 'analytical-four'
    monkeypatch.setenv('ANALYTICAL_FOUR_DATA_DIR', str(root))
    seed_demo.seed(root)
    return root


@pytest.fixture
def client(data):
    app = FastAPI()

    @app.middleware('http')
    async def actor(request, call_next):
        user = request.headers.get('x-test-user')
        if user:
            request.state.actor_user_id = user
            request.state.actor_role = request.headers.get('x-test-role', 'operator')
        return await call_next(request)

    app.include_router(routes_analytical_four.router)
    routes_analytical_four._store.cache_clear()
    http = TestClient(app, headers={'x-test-user': 'u-1'})
    yield http
    routes_analytical_four._store.cache_clear()


class FakeLlm:
    """A stand-in diagnosis service that records what it was sent."""

    def __init__(self, status: int = 200):
        self.status, self.calls = status, []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                outer.calls.append({'body': body, 'authorization': self.headers.get('Authorization')})
                payload = json.dumps({'event_id': body['new_event']['event_id'],
                                      'llm_analysis': {'similar_cases': len(body['top3_cases'])}}).encode()
                self.send_response(outer.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f'http://127.0.0.1:{self.server.server_port}/diagnose'

    def close(self):
        self.server.shutdown()


@pytest.fixture
def llm():
    service = FakeLlm()
    yield service
    service.close()


def settings(**override):
    base = {'schemaVersion': 1, 'layers': {'a': True, 'b': True, 'c': False}, 'mode': 'daily',
            'analysisConfig': 'config/analysis_config.json', 'llm': {'endpoint': '', 'timeoutSeconds': 30, 'apiKeyEnv': ''}}
    base.update(override)
    return base


def wait_for(client: TestClient, run_id: str, timeout: float = 180.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        record = client.get(f'/api/analytical-four/runs/{run_id}').json()
        if record['state'] in ('succeeded', 'failed'):
            return record
        time.sleep(0.3)
    raise AssertionError('the run did not finish in time')


def run_and_wait(client: TestClient, timeout: float = 180.0) -> dict:
    created = client.post('/api/analytical-four/runs')
    assert created.status_code == 202, created.text
    return wait_for(client, created.json()['runId'], timeout)
