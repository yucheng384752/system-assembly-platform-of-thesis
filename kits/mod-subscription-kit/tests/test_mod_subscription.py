"""mod-subscription-kit: what a tenant is entitled to, and who may change a subscription.

A subscription decides what a customer may use, and the webhook is the one endpoint with no user token, so these tests
guard two business rules: a plan grants only what it lists (an unknown or inactive plan grants nothing), and a webhook
call is accepted only with the shared secret. No database and no network are used.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import routes_mod_subscription as routes
from app.api.deps import get_current_tenant, get_db
from app.models.mod_subscription import ModSubscription, ModSubscriptionEvent
from app.services import mod_subscription as service

SECRET = "webhook-secret-for-tests-only-0123456789"


class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class FakeSession:
    """Answers every query with one prepared row and records what the service writes."""

    def __init__(self, row=None):
        self.row = row
        self.added = []
        self.committed = 0

    async def execute(self, _statement):
        return FakeResult(self.row)

    def add(self, item):
        self.added.append(item)

    async def flush(self):
        pass

    async def commit(self):
        self.committed += 1

    async def refresh(self, _item):
        pass


def subscription(plan="standard", status="active", external_id="ext-1"):
    return ModSubscription(tenant_id="t1", external_subscription_id=external_id, plan_code=plan, status=status,
                           expires_at=None, synced_at=datetime(2026, 11, 1, tzinfo=timezone.utc), raw_payload={})


def client(session, monkeypatch, secret=SECRET):
    if secret is None:
        monkeypatch.delenv("MOD_WEBHOOK_SECRET", raising=False)
    else:
        monkeypatch.setenv("MOD_WEBHOOK_SECRET", secret)
    app = FastAPI()
    app.include_router(routes.router)

    async def db():
        yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[get_current_tenant] = lambda: SimpleNamespace(id="t1")
    return TestClient(app)


@pytest.mark.parametrize("plan,expected", [
    ("basic", ["upload", "query"]),
    ("standard", ["upload", "query", "analytics", "export"]),
    ("enterprise", ["upload", "query", "analytics", "export", "admin", "api_access"]),
])
def test_each_plan_grants_exactly_its_own_list(plan, expected):
    assert service.get_entitlements(subscription(plan=plan)) == expected


def test_a_higher_plan_never_grants_less_than_a_lower_one():
    basic, standard, enterprise = (set(service.get_entitlements(subscription(plan=p))) for p in ("basic", "standard", "enterprise"))
    assert basic < standard < enterprise


@pytest.mark.parametrize("status", ["cancelled", "expired", "suspended", ""])
def test_a_subscription_that_is_not_active_grants_nothing(status):
    assert service.get_entitlements(subscription(plan="enterprise", status=status)) == []


def test_an_unknown_plan_grants_nothing_rather_than_a_default():
    assert service.get_entitlements(subscription(plan="platinum")) == []


def test_the_returned_list_is_a_copy_so_a_caller_cannot_widen_a_plan():
    first = service.get_entitlements(subscription(plan="basic"))
    first.append("admin")
    assert service.get_entitlements(subscription(plan="basic")) == ["upload", "query"]


def test_webhook_without_the_secret_is_refused_and_changes_nothing(monkeypatch):
    session = FakeSession(subscription())
    body = {"external_subscription_id": "ext-1", "event": "plan_changed", "plan_code": "enterprise"}
    assert client(session, monkeypatch).post("/api/mod/subscriptions/webhook", json=body).status_code == 401
    wrong = client(session, monkeypatch).post("/api/mod/subscriptions/webhook", json=body, headers={"X-Mod-Webhook-Secret": "nope"})
    assert wrong.status_code == 401
    assert session.added == [] and session.committed == 0


def test_webhook_with_the_secret_updates_plan_and_status_and_leaves_an_event_trail(monkeypatch):
    row = subscription(plan="basic")
    session = FakeSession(row)
    body = {"external_subscription_id": "ext-1", "event": "plan_changed", "plan_code": "enterprise", "status": "active"}
    response = client(session, monkeypatch).post("/api/mod/subscriptions/webhook", json=body, headers={"X-Mod-Webhook-Secret": SECRET})
    assert response.status_code == 200
    assert (row.plan_code, row.status) == ("enterprise", "active")
    events = [item for item in session.added if isinstance(item, ModSubscriptionEvent)]
    assert len(events) == 1 and events[0].event_type == "webhook" and events[0].detail["event"] == "plan_changed"
    assert session.committed == 1


def test_webhook_for_an_unknown_subscription_is_a_404_not_a_server_error(monkeypatch):
    session = FakeSession(None)
    body = {"external_subscription_id": "missing", "event": "cancelled", "status": "cancelled"}
    response = client(session, monkeypatch).post("/api/mod/subscriptions/webhook", json=body, headers={"X-Mod-Webhook-Secret": SECRET})
    assert response.status_code == 404


def test_webhook_cancel_keeps_the_plan_but_removes_the_entitlements():
    row = subscription(plan="enterprise")
    asyncio.run(service.process_webhook(FakeSession(row), "ext-1", "cancelled", None, "cancelled"))
    assert row.plan_code == "enterprise"
    assert service.get_entitlements(row) == []


def test_entitlement_query_reports_the_plan_and_what_it_grants(monkeypatch):
    session = FakeSession(subscription(plan="basic"))
    response = client(session, monkeypatch).get("/api/mod/subscriptions/ext-1/entitlements")
    assert response.status_code == 200
    assert response.json()["entitlements"] == ["upload", "query"]


def test_entitlement_query_for_a_missing_subscription_is_a_404(monkeypatch):
    assert client(FakeSession(None), monkeypatch).get("/api/mod/subscriptions/none/entitlements").status_code == 404


def test_sync_refuses_to_run_when_the_provider_address_is_not_configured(monkeypatch):
    monkeypatch.delenv("MOD_API_BASE_URL", raising=False)
    response = client(FakeSession(None), monkeypatch).post("/api/mod/subscriptions/sync", json={"external_subscription_id": "ext-1"})
    assert response.status_code == 503
