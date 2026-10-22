"""Standard-library unittest only. Execution and results: 由 Claude 執行."""
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "backend"))

from app.entry_permission import policy
from app.entry_permission.create_admin import read_input
from app.entry_permission.directory import Directory
from app.entry_permission.lockout import failed_attempt, is_locked
from app.entry_permission.passwords import validate_password
from app.entry_permission.security import load_secret


def document():
    return {"format": "composer-entry-points", "version": 1,
            "publicPaths": ["/healthz", "/api/auth/login"],
            "entryPoints": [{"key": "records.edit", "label": "Edit", "access": "write",
                             "defaultRoles": ["manager"], "kitId": "example-kit",
                             "routes": [{"capability": "records.edit", "method": "PATCH",
                                         "path": "/api/records/{id}"}]}]}


def actor(name="operator", readonly=False, active=True, builtin=True):
    return SimpleNamespace(is_active=active, role=SimpleNamespace(name=name, is_readonly=readonly, is_builtin=builtin))


class PolicyTests(unittest.TestCase):
    def decision(self, **changes):
        args = dict(active=True, readonly=False, role_name="operator", access="write",
                    default_roles=["operator"], override=None, role_grant=None)
        args.update(changes)
        return policy.allows(**args)

    def test_inactive_before_every_allow(self):
        self.assertFalse(self.decision(active=False, override=True, role_grant=True))

    def test_readonly_before_every_allow(self):
        for override in (None, False, True):
            for grant in (None, False, True):
                with self.subTest(override=override, grant=grant):
                    self.assertFalse(self.decision(readonly=True, override=override, role_grant=grant))
        self.assertTrue(self.decision(readonly=True, access="read"))

    def test_bidirectional_override_precedence(self):
        self.assertTrue(self.decision(override=True, role_grant=False, default_roles=[]))
        self.assertFalse(self.decision(override=False, role_grant=True))

    def test_role_grant_precedence_and_fallback(self):
        self.assertTrue(self.decision(role_grant=True, default_roles=[]))
        self.assertFalse(self.decision(role_grant=False))
        self.assertTrue(self.decision())
        self.assertFalse(self.decision(default_roles=[]))

    def test_admin_is_not_an_override_bypass(self):
        self.assertFalse(self.decision(role_name="admin", default_roles=["admin"], override=False))
        self.assertFalse(policy.builtin_admin("admin", False))
        self.assertTrue(policy.builtin_admin("admin", True))

    def test_override_assignment_cannot_elevate(self):
        for is_admin, readonly, expected in ((False, False, False), (False, True, False),
                                             (True, True, False), (True, False, True)):
            self.assertEqual(policy.may_set_overrides(actor_admin=is_admin, target_readonly=readonly), expected)

    def test_manager_cannot_manage_or_assign_privileged_roles(self):
        for role in ("admin", "manager"):
            self.assertFalse(policy.may_manage_role(actor_admin=False, target_role=role))
            self.assertTrue(policy.may_manage_role(actor_admin=True, target_role=role))
        self.assertTrue(policy.may_manage_role(actor_admin=False, target_role="custom"))


class DirectoryTests(unittest.TestCase):
    def test_method_path_and_segment_matching(self):
        directory = Directory(document())
        self.assertEqual(set(directory.matching("PATCH", "/api/records/abc")), {"records.edit"})
        for method, path in (("GET", "/api/records/abc"), ("PATCH", "/api/records/abc/extra"),
                             ("PATCH", "/api/records/"), ("PATCH", "/api/records/abc/"),
                             ("PATCH", "/api/recordsX/abc")):
            self.assertEqual(directory.matching(method, path), {})

    def test_default_deny_only_builtin_active_admin_passes(self):
        directory = Directory(document())
        for who, expected in ((actor(), False), (actor("manager"), False),
                              (actor("admin"), True), (actor("admin", builtin=False), False),
                              (actor("admin", active=False), False)):
            self.assertEqual(directory.request_allowed("GET", "/api/unknown", who, {}, {}), expected)

    def test_visibility_and_request_share_policy(self):
        directory = Directory(document())
        entry = directory.entries["records.edit"]
        for who in (actor(), actor("manager"), actor("audit", readonly=True)):
            for overrides in ({}, {"records.edit": True}, {"records.edit": False}):
                self.assertEqual(directory.entry_allowed(entry, who, {}, overrides),
                                 directory.request_allowed("PATCH", "/api/records/7", who, {}, overrides))

    def test_duplicate_entry_key_rejected(self):
        data = document()
        data["entryPoints"].append(copy.deepcopy(data["entryPoints"][0]))
        with self.assertRaises(ValueError):
            Directory(data)

    def test_duplicate_json_member_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "entry_points.json"
            path.write_text('{"format":"composer-entry-points","format":"evil"}', encoding="utf-8")
            with self.assertRaises(ValueError):
                Directory.load(path)
            path.write_text(json.dumps(document()), encoding="utf-8")
            self.assertIn("records.edit", Directory.load(path).entries)

    def test_public_exceptions_exact_method_and_path(self):
        directory = Directory(document())
        self.assertTrue(directory.is_public("POST", "/api/auth/login"))
        self.assertFalse(directory.is_public("GET", "/api/auth/login"))
        self.assertFalse(directory.is_public("POST", "/api/auth/login/extra"))
        data = document()
        data["publicPaths"].append("/api/users")
        with self.assertRaises(ValueError):
            Directory(data)

    def test_invalid_directory_fails_closed(self):
        mutations = [lambda d: d.update(version=True), lambda d: d.update(unexpected=True),
                     lambda d: d["entryPoints"][0].update(access="anything"),
                     lambda d: d["entryPoints"][0].update(defaultRoles=["manager", "manager"]),
                     lambda d: d["entryPoints"][0]["routes"][0].update(method="OPTIONS"),
                     lambda d: d["entryPoints"][0]["routes"][0].update(path="/api/{broken")]
        for mutation in mutations:
            data = document()
            mutation(data)
            with self.assertRaises(ValueError):
                Directory(data)

    def test_overlapping_route_cannot_weaken_readonly(self):
        data = document()
        other = copy.deepcopy(data["entryPoints"][0])
        other.update(key="records.read", access="read", defaultRoles=["audit"])
        data["entryPoints"].append(other)
        directory = Directory(data)
        self.assertFalse(directory.request_allowed("PATCH", "/api/records/7", actor("audit", readonly=True), {}, {}))


class PasswordTests(unittest.TestCase):
    def test_character_minimum(self):
        with self.assertRaises(ValueError):
            validate_password("12345678")
        self.assertEqual(validate_password("123456789"), b"123456789")

    def test_byte_boundary(self):
        for text in ("a" * 72, "密" * 24):
            self.assertEqual(len(validate_password(text)), 72)
        for text in ("a" * 73, "密" * 24 + "a", "密" * 25, "\ud800" * 9):
            with self.assertRaises(ValueError):
                validate_password(text)

    def test_no_added_complexity_policy(self):
        self.assertEqual(validate_password("a" * 9), b"a" * 9)


class LockoutTests(unittest.TestCase):
    def test_fifth_failure_locks_and_exact_expiry_unlocks(self):
        now = datetime(2026, 10, 22, tzinfo=timezone.utc)
        count, until = 0, None
        for expected in range(1, 6):
            count, until = failed_attempt(count, until, now)
            self.assertEqual(count, expected)
            self.assertEqual(is_locked(until, now), expected == 5)
        self.assertEqual(until, now + timedelta(minutes=15))
        self.assertTrue(is_locked(until, until - timedelta(microseconds=1)))
        self.assertFalse(is_locked(until, until))
        self.assertEqual(failed_attempt(count, until, now + timedelta(minutes=1)), (5, until))
        self.assertEqual(failed_attempt(count, until, until), (1, None))


class ConfigurationTests(unittest.TestCase):
    def test_secret_missing_short_exact_boundary(self):
        for env in ({}, {"ENTRY_PERMISSION_JWT_SECRET": ""}, {"ENTRY_PERMISSION_JWT_SECRET": "x" * 31}):
            with self.assertRaises(ValueError):
                load_secret(env)
        self.assertEqual(load_secret({"ENTRY_PERMISSION_JWT_SECRET": "x" * 32}), "x" * 32)

    def test_fixed_tenant_header_rule(self):
        tenant = "00000000-0000-0000-0000-000000000001"
        self.assertTrue(policy.tenant_header_allowed([], tenant))
        self.assertTrue(policy.tenant_header_allowed([tenant], tenant))
        for values in ([""], ["other"], [tenant + " "], [tenant, tenant], [tenant, "other"], [tenant + ",other"]):
            self.assertFalse(policy.tenant_header_allowed(values, tenant))

    def test_bootstrap_only_strict_json(self):
        data = {"username": "admin", "password": "ninechars", "display_name": "Administrator"}
        self.assertEqual(read_input(io.StringIO(json.dumps(data))), data)
        for raw in ('{"username":"one","username":"two"}', '[]', '"secret"',
                    json.dumps({**data, "extra": True}), json.dumps({**data, "password": "short"})):
            with self.assertRaises(ValueError):
                read_input(io.StringIO(raw))


if __name__ == "__main__":
    unittest.main()
