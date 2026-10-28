"""Test harness for the HTTP API. The middleware here is a stand-in for the shared entry-permission middleware:
it sets the same request state from two test headers and decides nothing else."""
from fastapi import Request
from fastapi.testclient import TestClient

from fixtures import EVALUATOR, FORMS, KITS, load, text
from factory_api import Environment, create_app
from factory_core.workorder import FactoryState

PLAN = load('valid.json')


class Clock:
    def __init__(self, now='2026-10-28T12:00:00Z'):
        self.now = now

    def __call__(self):
        return self.now


def build(store, *, kits=KITS, authenticate=True, authorize=None):
    """An app on `store`. `authorize(method, path, role, user)` may refuse a request, like the entry layer does."""
    state = FactoryState(store)
    clock = Clock()
    environment = Environment(frozenset(kits), dict(FORMS), EVALUATOR)
    app = create_app(state, environment=lambda: environment, clock=clock)
    if authenticate:
        @app.middleware('http')
        async def stand_in(request: Request, call_next):
            user, role = request.headers.get('X-Test-User'), request.headers.get('X-Test-Role')
            if user and role:
                request.state.actor_user_id, request.state.actor_role = user, role
            if authorize is not None and not authorize(request.method, request.url.path, role, user):
                from fastapi.responses import JSONResponse
                return JSONResponse(status_code=403, content={'detail': 'Forbidden'})
            return await call_next(request)
    return app, state, clock


def as_user(app, user, role):
    return TestClient(app, headers={'X-Test-User': user, 'X-Test-Role': role}, raise_server_exceptions=True)


def plan_text(plan=None):
    return text(plan or PLAN)
