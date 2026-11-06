"""audit-edit-kit: who may change what, and what an edit must record.

Every change to a saved record needs an active reason, must validate against the form's field types, and must leave a trail.
Only the platform administrator may read audit events, and a failure to write an audit event must never undo the edit
that triggered it. No database is used.
"""
from __future__ import annotations

import asyncio
import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from app.api import routes_audit_events as audit_routes
from app.api import routes_edit as edit
from app.api.routes_generic_forms import _coerce
from app.core.database import get_db
from app.services import audit_events

FIELDS = [
    {"name": "qty", "type": "integer", "required": True},
    {"name": "note", "type": "string"},
    {"name": "weight", "type": "decimal"},
    {"name": "day", "type": "date"},
    {"name": "ok", "type": "boolean"},
]


def request(**state):
    return SimpleNamespace(state=SimpleNamespace(**state))


def coerce(changes):
    return edit._coerce_changes(changes, FIELDS, _coerce)


# ---- what a change may contain -----------------------------------------------------------------------------------

def test_a_valid_change_is_converted_to_the_declared_field_types():
    assert coerce({"qty": "12", "weight": "1.5", "note": "x"}) == {"qty": 12, "weight": 1.5, "note": "x"}


@pytest.mark.parametrize("changes,status,needle", [
    ({}, 422, "must not be empty"),
    ({"nope": "1"}, 422, "invalid_fields"),
    ({"qty": ["1"]}, 422, "scalar"),
    ({"qty": "abc"}, 422, "not a valid integer"),
    ({"qty": None}, 422, "required"),
    ({"day": "not-a-date"}, 422, "not a valid date"),
])
def test_a_change_that_would_corrupt_a_record_is_refused_with_the_reason(changes, status, needle):
    with pytest.raises(HTTPException) as caught:
        coerce(changes)
    assert caught.value.status_code == status and needle in str(caught.value.detail)


def test_an_optional_field_may_be_cleared_but_a_required_one_may_not():
    assert coerce({"note": None}) == {"note": None}
    with pytest.raises(HTTPException):
        coerce({"qty": None})


# ---- who may do what ---------------------------------------------------------------------------------------------

def test_only_an_administrator_or_a_manager_may_change_the_reason_catalog():
    edit._require_tenant_manager(request(is_admin=True))
    edit._require_tenant_manager(request(actor_role="manager"))
    for role in ("operator", "audit", None):
        with pytest.raises(HTTPException) as caught:
            edit._require_tenant_manager(request(actor_role=role))
        assert caught.value.status_code == 403


def test_only_the_platform_administrator_reads_audit_events():
    audit_routes._require_system_admin(request(is_admin=True))
    for state in ({}, {"actor_role": "manager"}, {"is_admin": False}):
        with pytest.raises(HTTPException) as caught:
            audit_routes._require_system_admin(request(**state))
        assert caught.value.status_code == 403


def test_the_actor_recorded_with_an_edit_is_the_first_identity_available_and_is_capped():
    assert edit._actor(request(auth_api_key_label="key-a", actor_user_id="u1")) == "key-a"
    assert edit._actor(request(actor_user_id="u1")) == "u1"
    assert edit._actor(request()) is None
    assert len(edit._actor(request(actor_user_id="x" * 500))) == 100


# ---- the reason catalog ---------------------------------------------------------------------------------------------

class Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class Session:
    def __init__(self, value=None, fail_commit=False):
        self.value, self.fail_commit, self.added, self.rolled_back = value, fail_commit, [], False

    async def execute(self, _statement):
        return Result(self.value)

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        if self.fail_commit:
            raise IntegrityError("insert", {}, Exception("duplicate"))

    async def rollback(self):
        self.rolled_back = True

    async def refresh(self, _item):
        pass


def client(session, tenant_state):
    app = FastAPI()

    @app.middleware("http")
    async def actor(http_request, call_next):
        for key, value in tenant_state.items():
            setattr(http_request.state, key, value)
        return await call_next(http_request)

    app.include_router(edit.router)

    async def db():
        yield session

    app.dependency_overrides[get_db] = db
    app.dependency_overrides[edit.get_current_tenant] = lambda: SimpleNamespace(id=uuid.uuid4())
    return TestClient(app)


def test_an_inactive_or_foreign_reason_cannot_be_used_for_an_edit():
    with pytest.raises(HTTPException) as caught:
        asyncio.run(edit._active_reason(Session(None), uuid.uuid4(), uuid.uuid4()))
    assert caught.value.status_code == 422


def test_an_operator_cannot_create_a_reason_and_a_manager_can():
    body = {"code": "typo", "label": "Typing mistake"}
    assert client(Session(), {"actor_role": "operator"}).post("/reasons", json=body).status_code == 403
    session = Session()
    created = client(session, {"actor_role": "manager"}).post("/reasons", json=body)
    assert created.status_code == 201 and created.json()["code"] == "typo" and created.json()["is_active"] is True
    assert len(session.added) == 1


def test_a_duplicate_reason_code_is_a_409_and_the_transaction_is_rolled_back():
    session = Session(fail_commit=True)
    response = client(session, {"actor_role": "manager"}).post("/reasons", json={"code": "typo", "label": "x"})
    assert response.status_code == 409 and session.rolled_back


@pytest.mark.parametrize("body", [{"code": " ", "label": "x"}, {"code": "x", "label": "  "}, {"code": "c" * 101, "label": "x"}, {"code": "x", "label": "l" * 256}])
def test_empty_or_oversized_reason_fields_are_refused(body):
    assert client(Session(), {"actor_role": "manager"}).post("/reasons", json=body).status_code == 422


def test_editing_a_reason_needs_at_least_one_change_and_rejects_unknown_fields():
    reason = SimpleNamespace(id=uuid.uuid4(), code="c", label="old", is_active=True, created_at=None)
    http = client(Session(reason), {"actor_role": "manager"})
    rid = uuid.uuid4()
    assert http.patch(f"/reasons/{rid}", json={}).status_code == 422
    assert http.patch(f"/reasons/{rid}", json={"code": "new"}).status_code == 422
    assert http.patch(f"/reasons/{rid}", json={"label": "  "}).status_code == 422
    done = http.patch(f"/reasons/{rid}", json={"label": " new ", "is_active": False})
    assert done.status_code == 200 and reason.label == "new" and reason.is_active is False


def test_a_missing_reason_is_a_404():
    assert client(Session(None), {"actor_role": "manager"}).patch(f"/reasons/{uuid.uuid4()}", json={"label": "x"}).status_code == 404


# ---- the audit trail never breaks the caller ---------------------------------------------------------------------

def test_an_audit_write_failure_is_swallowed_so_the_edit_it_follows_still_succeeds(monkeypatch):
    class Broken:
        def __call__(self):
            raise RuntimeError("database is down")

    monkeypatch.setattr("app.core.database.async_session_factory", Broken(), raising=False)
    assert asyncio.run(audit_events.write_audit_event_best_effort(action="records.edit", tenant_id=None)) is None


def test_with_no_database_session_factory_nothing_is_written_and_nothing_fails(monkeypatch):
    monkeypatch.setattr("app.core.database.async_session_factory", None, raising=False)
    assert asyncio.run(audit_events.write_audit_event_best_effort(action="x")) is None


def test_an_audit_event_is_stored_with_the_values_it_was_given(monkeypatch):
    saved = []

    class Db:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        def add(self, row):
            saved.append(row)

        async def commit(self):
            pass

    monkeypatch.setattr("app.core.database.async_session_factory", lambda: Db(), raising=False)
    asyncio.run(audit_events.write_audit_event_best_effort(action="forms.create", method="POST", path="/api/forms", status_code=201, metadata={"k": "v"}))
    assert len(saved) == 1
    row = saved[0]
    assert (row.action, row.method, row.path, row.status_code, row.metadata_json) == ("forms.create", "POST", "/api/forms", 201, {"k": "v"})


def test_an_audit_event_without_a_method_is_recorded_as_internal():
    saved = []

    class Db:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return False

        def add(self, row):
            saved.append(row)

        async def commit(self):
            pass

    import app.core.database as database

    original = database.async_session_factory
    database.async_session_factory = lambda: Db()
    try:
        asyncio.run(audit_events.write_audit_event_best_effort(action="x"))
    finally:
        database.async_session_factory = original
    assert saved[0].method == "INTERNAL" and saved[0].status_code == 0
