"""Requires assembled backend + FastAPI/SQLAlchemy/PyJWT. 由 Claude 在 Docker 內執行.

Uses the real EP middleware and unchanged platform-core endpoint middleware;
only the database lookup and deployed endpoint configuration are substituted.
"""
import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from app.core.endpoint_permission_middleware import endpoint_permission_middleware
from app.entry_permission.directory import Directory
from app.entry_permission.middleware import admin_actor, configure_entry_permission, entry_permission_middleware
from app.entry_permission.security import issue_token

SECRET = "integration-only-secret-32-characters-minimum"
TENANT = "00000000-0000-0000-0000-000000000001"


class Session:
    def __init__(self, actor):
        self.actor = actor

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def get(self, model, subject):
        return self.actor if self.actor and self.actor.id == subject else None


class MiddlewareTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.actor = SimpleNamespace(id=uuid4(), role_id=uuid4(), is_active=True, must_change_password=False,
                                     role=SimpleNamespace(name="operator", is_builtin=True, is_readonly=False))
        self.app = FastAPI()
        self.app.state.ep_secret = SECRET
        self.app.state.ep_tenant_id = TENANT
        self.app.state.ep_directory = Directory({"format": "composer-entry-points", "version": 1,
            "publicPaths": ["/healthz", "/api/auth/login"], "entryPoints": [
                {"key": "records.edit", "label": "Edit", "access": "write", "kitId": "test-kit",
                 "defaultRoles": [], "routes": [{"method": "PATCH", "path": "/api/records/{id}", "capability": "records.edit"}]}]})
        self.endpoint_calls = 0

    async def invoke(self, *, tenant_headers=(), role_required=None, path="/api/records/7",
                     method="PATCH", token=None, extra_headers=(), allow_override=True, bearer=True):
        headers = [(b"authorization", ("Bearer " + (token or issue_token(self.actor.id, SECRET))).encode())] if bearer else []
        headers.extend((b"x-tenant-id", value.encode()) for value in tenant_headers)
        headers.extend(extra_headers)
        request = Request({"type": "http", "app": self.app, "method": method, "path": path,
                           "headers": headers, "query_string": b"", "scheme": "http",
                           "server": ("test", 80), "client": ("test", 123)})

        async def endpoint(req):
            self.endpoint_calls += 1
            return JSONResponse({"role": req.state.actor_role})

        async def old_gate(req):
            return await endpoint_permission_middleware(req, endpoint)

        with patch("app.entry_permission.middleware.database.async_session_factory", return_value=Session(self.actor)), \
             patch("app.entry_permission.middleware.grants_for", new=AsyncMock(return_value=({}, {"records.edit": allow_override}))), \
             patch("app.core.endpoint_permission_middleware.get_required_role", return_value=role_required):
            response = await entry_permission_middleware(request, old_gate)
        return response, request

    async def test_override_allow_does_not_bypass_old_role_veto(self):
        response, request = await self.invoke(role_required="manager")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.body), {"detail": "Forbidden"})
        self.assertEqual(self.endpoint_calls, 0)
        self.assertEqual(request.state.actor_role, "operator")
        self.assertFalse(request.state.is_admin)

    async def test_both_layers_allow(self):
        response, request = await self.invoke(role_required="operator")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.endpoint_calls, 1)
        self.assertEqual(request.state.auth_tenant_id, TENANT)

    async def test_entry_deny_cannot_be_undone_by_old_layer(self):
        response, _ = await self.invoke(role_required="operator", allow_override=False)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.endpoint_calls, 0)

    async def test_admin_tenant_rejection_is_generic_and_logged(self):
        self.actor.role.name = "admin"
        for headers in (("different-tenant",), ("",), (TENANT, TENANT), (TENANT, "other")):
            with self.subTest(headers=headers), self.assertLogs("app.entry_permission.middleware", level="WARNING") as logs:
                response, _ = await self.invoke(tenant_headers=headers)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(json.loads(response.body), {"detail": "Forbidden"})
            self.assertNotIn(TENANT, str(logs.output))
        self.assertEqual(self.endpoint_calls, 0)

    async def test_absent_and_exact_tenant_allowed_for_admin_and_operator(self):
        for name in ("admin", "operator"):
            self.actor.role.name = name
            for headers in ((), (TENANT,)):
                response, _ = await self.invoke(tenant_headers=headers)
                self.assertEqual(response.status_code, 200)

    async def test_inactive_and_readonly_deny(self):
        self.actor.is_active = False
        response, _ = await self.invoke()
        self.assertEqual(response.status_code, 401)
        self.actor.is_active = True
        self.actor.role.is_readonly = True
        response, _ = await self.invoke()
        self.assertEqual(response.status_code, 403)

    async def test_forced_password_change(self):
        self.actor.must_change_password = True
        for method, path, expected in (("PATCH", "/api/records/7", 403),
                                      ("GET", "/api/entry-points/me", 403),
                                      ("PATCH", "/api/auth/me", 403),
                                      ("GET", "/api/auth/me", 200),
                                      ("POST", "/api/auth/change-password", 200)):
            response, _ = await self.invoke(method=method, path=path)
            self.assertEqual(response.status_code, expected)

    async def test_expired_tampered_and_missing_subject_tokens(self):
        import jwt
        expired = jwt.encode({"sub": str(self.actor.id), "iat": datetime.now(timezone.utc) - timedelta(hours=9),
                              "exp": datetime.now(timezone.utc) - timedelta(seconds=1)}, SECRET, algorithm="HS256")
        wrong_secret = issue_token(self.actor.id, "another-secret-with-at-least-32-characters")
        missing = jwt.encode({"exp": datetime.now(timezone.utc) + timedelta(hours=1)}, SECRET, algorithm="HS256")
        for token in (expired, wrong_secret, missing, "not-a-token"):
            response, _ = await self.invoke(token=token)
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.endpoint_calls, 0)

    async def test_admin_only_dependency_does_not_trust_grants(self):
        with self.assertRaises(HTTPException) as error:
            await admin_actor(self.actor)
        self.assertEqual(error.exception.status_code, 403)
        self.actor.role.name = "admin"
        self.actor.role.is_builtin = False
        with self.assertRaises(HTTPException):
            await admin_actor(self.actor)
        self.actor.role.is_builtin = True
        self.assertIs(await admin_actor(self.actor), self.actor)

    async def test_startup_rejects_missing_or_short_key_before_loading_directory(self):
        for secret in (None, "x" * 31):
            with patch.dict(os.environ, {}, clear=True):
                if secret is not None:
                    os.environ["ENTRY_PERMISSION_JWT_SECRET"] = secret
                with self.assertRaisesRegex(ValueError, "ENTRY_PERMISSION_JWT_SECRET"):
                    configure_entry_permission(self.app, directory_path="must-not-be-read.json",
                                               default_tenant_id=TENANT, machine_auth=AsyncMock())

    async def test_machine_key_presence_does_not_authenticate(self):
        async def unchecked(req, next_call):
            return await next_call(req)
        self.app.state.ep_machine_auth = unchecked
        response, _ = await self.invoke(bearer=False, extra_headers=[(b"x-admin-api-key", b"invalid")])
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.endpoint_calls, 0)

    async def test_authenticated_machine_still_checks_tenant(self):
        async def authenticated(req, next_call):
            req.state.is_admin = True
            req.state.actor_role = "machine"
            return await next_call(req)
        self.app.state.ep_machine_auth = authenticated
        for values, expected in (((), 200), ((TENANT,), 200), (("other",), 403)):
            response, _ = await self.invoke(bearer=False, tenant_headers=values,
                                            extra_headers=[(b"x-admin-api-key", b"test")])
            self.assertEqual(response.status_code, expected)

    async def test_me_reports_entry_layer_even_when_old_layer_denies(self):
        from app.api.routes_ep_entry_points import available
        response, request = await self.invoke(role_required="manager")
        self.assertEqual(response.status_code, 403)
        with patch("app.api.routes_ep_entry_points.grants_for", new=AsyncMock(return_value=({}, {"records.edit": True}))):
            keys = await available(request, self.actor, object())
        self.assertEqual(keys, ["records.edit"])


if __name__ == "__main__":
    unittest.main()
