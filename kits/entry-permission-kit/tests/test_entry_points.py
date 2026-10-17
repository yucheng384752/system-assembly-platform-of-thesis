"""入口目錄與登入鎖定的行為測試。

執行（不需第三方套件）：
  PYTHONPATH=kits/entry-permission-kit/src/backend python -m unittest discover -s kits/entry-permission-kit/tests
"""

import unittest
from datetime import datetime, timedelta, timezone

from app.core.entry_points import (
    USER_DIRECTORY_TAG,
    USER_MANAGE,
    EntryPoint,
    EntryPointError,
    EntryPointRegistry,
    registry,
)
from app.core.login_guard import LoginGuard, LoginLockedError
from app.core.roles import Role


def _ep(key: str, roles=(Role.manager,), **kw) -> EntryPoint:
    return EntryPoint(key=key, label="測試入口", roles=roles, owner_kit="test-kit", **kw)


class EntryPointRegistryTest(unittest.TestCase):
    def test_business_kit_can_register_its_own_entry_without_editing_this_kit(self):
        reg = EntryPointRegistry()
        reg.register(_ep("batch_manage", tags=frozenset({USER_DIRECTORY_TAG})))
        self.assertEqual(reg.get("batch_manage").owner_kit, "test-kit")

    def test_duplicate_key_is_rejected_so_two_kits_cannot_silently_share_a_gate(self):
        reg = EntryPointRegistry()
        reg.register(_ep("batch_manage"))
        with self.assertRaises(EntryPointError):
            reg.register(_ep("batch_manage"))

    def test_read_only_role_can_never_be_granted_by_an_entry(self):
        reg = EntryPointRegistry()
        with self.assertRaises(EntryPointError):
            reg.register(_ep("report_export", roles=(Role.manager, Role.audit)))

    def test_entry_without_roles_is_rejected(self):
        with self.assertRaises(EntryPointError):
            EntryPointRegistry().register(_ep("empty_gate", roles=()))

    def test_malformed_key_is_rejected(self):
        with self.assertRaises(EntryPointError):
            EntryPointRegistry().register(_ep("Batch-Manage"))

    def test_non_overridable_entry_is_hidden_from_override_catalog(self):
        reg = EntryPointRegistry()
        reg.register(_ep("approve_deviation", roles=(Role.admin,), overridable=False))
        reg.register(_ep("batch_manage"))
        self.assertEqual([ep.key for ep in reg.overridable()], ["batch_manage"])

    def test_user_directory_tag_lets_other_kits_grant_list_access_without_imports(self):
        reg = EntryPointRegistry()
        reg.register(_ep("batch_manage", tags=frozenset({USER_DIRECTORY_TAG})))
        reg.register(_ep("alarm_manage"))
        self.assertEqual([ep.key for ep in reg.with_tag(USER_DIRECTORY_TAG)], ["batch_manage"])

    def test_unknown_key_lookup_fails_loudly(self):
        with self.assertRaises(EntryPointError):
            EntryPointRegistry().get("missing")

    def test_kit_registers_only_its_own_entry_by_default(self):
        self.assertEqual([ep.key for ep in registry.all()], [USER_MANAGE.key])
        self.assertNotIn(Role.audit, USER_MANAGE.roles)


class LoginGuardTest(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.guard = LoginGuard(3, timedelta(minutes=15), clock=lambda: self.now)

    def test_locks_after_configured_failures(self):
        for _ in range(3):
            self.guard.record_failure("op01")
        with self.assertRaises(LoginLockedError):
            self.guard.ensure_not_locked("op01")

    def test_failures_outside_window_no_longer_count(self):
        for _ in range(3):
            self.guard.record_failure("op01")
        self.now += timedelta(minutes=16)
        self.guard.ensure_not_locked("op01")

    def test_successful_login_resets_counter(self):
        for _ in range(2):
            self.guard.record_failure("op01")
        self.guard.reset("op01")
        self.guard.record_failure("op01")
        self.guard.ensure_not_locked("op01")

    def test_lock_is_per_account(self):
        for _ in range(3):
            self.guard.record_failure("op01")
        self.guard.ensure_not_locked("op02")

    def test_invalid_configuration_is_rejected(self):
        with self.assertRaises(ValueError):
            LoginGuard(0, timedelta(minutes=15))
        with self.assertRaises(ValueError):
            LoginGuard(3, timedelta(0))


if __name__ == "__main__":
    unittest.main()
