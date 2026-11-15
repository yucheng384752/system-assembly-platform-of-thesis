"""Requires the assembled backend, like test_middleware_integration. 由 Claude 執行.

The real check_managed and Directory decide; only the database reads are substituted.
"""
from types import SimpleNamespace
from uuid import uuid4
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from app.api.routes_ep_users import check_managed
from app.entry_permission.directory import Directory


def entry(key, roles, access="read"):
    return {"key": key, "label": key, "access": access, "kitId": "test-kit", "defaultRoles": roles,
            "routes": [{"method": "GET", "path": "/api/" + key.replace(".", "/"), "capability": key}]}


DIRECTORY = Directory({"format": "composer-entry-points", "version": 1, "publicPaths": [], "entryPoints": [
    entry("forms.read", ["admin", "manager", "operator", "audit"]),
    entry("forms.design", ["admin", "manager"], "write"),
    entry("users.manage", ["admin", "manager"], "write"),
    entry("audit.events_read", ["admin"]),
]})


def role(name, readonly=False, builtin=True):
    return SimpleNamespace(id=uuid4(), name=name, is_readonly=readonly, is_builtin=builtin)


def user(of_role):
    return SimpleNamespace(id=uuid4(), role_id=of_role.id, role=of_role, is_active=True)


class Rows:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return list(self.rows.items())


class UserManagementTests(unittest.IsolatedAsyncioTestCase):
    """role_grants and overrides stand for what the database holds, keyed by role id and user id."""

    def setUp(self):
        self.role_grants, self.overrides = {}, {}
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(ep_directory=DIRECTORY)))

    async def decide(self, actor, target_role, target_user=None):
        async def actor_grants(db, who):
            return self.role_grants.get(who.role_id, {}), self.overrides.get(who.id, {})
        # check_managed reads the target role grants first, then the target user overrides.
        reads = [Rows(self.role_grants.get(target_role.id, {}))]
        if target_user is not None:
            reads.append(Rows(self.overrides.get(target_user.id, {})))
        db = SimpleNamespace(execute=AsyncMock(side_effect=reads))
        with patch("app.api.routes_ep_users.grants_for", new=actor_grants):
            try:
                await check_managed(self.request, db, actor, target_role, target_user)
            except HTTPException as error:
                return error.status_code
        return 200

    async def test_manager_still_manages_the_builtin_roles_below_it(self):
        manager = user(role("manager"))
        for name, readonly in (("operator", False), ("audit", True)):
            target = role(name, readonly)
            self.assertEqual(await self.decide(manager, target), 200)
            self.assertEqual(await self.decide(manager, target, user(target)), 200)

    async def test_manager_cannot_hand_out_a_custom_role_that_opens_more_than_manager(self):
        manager = user(role("manager"))
        supervisor = role("supervisor", builtin=False)
        self.assertEqual(await self.decide(manager, supervisor), 200)  # no grants yet: it opens nothing
        self.role_grants[supervisor.id] = {"audit.events_read": True}
        self.assertEqual(await self.decide(manager, supervisor), 403)

    async def test_manager_cannot_take_over_an_account_that_opens_more_than_manager(self):
        # Resetting a password is taking the account: the new password is known to whoever reset it.
        manager = user(role("manager"))
        supervisor = role("supervisor", builtin=False)
        self.role_grants[supervisor.id] = {"audit.events_read": True}
        self.assertEqual(await self.decide(manager, supervisor, user(supervisor)), 403)
        operator = user(role("operator"))
        self.assertEqual(await self.decide(manager, operator.role, operator), 200)
        self.overrides[operator.id] = {"audit.events_read": True}  # the administrator gave this one person more
        self.assertEqual(await self.decide(manager, operator.role, operator), 403)

    async def test_a_custom_user_manager_cannot_change_their_own_account(self):
        clerk_role = role("clerk", builtin=False)
        self.role_grants[clerk_role.id] = {"users.manage": True, "forms.read": True}
        clerk = user(clerk_role)
        self.assertEqual(await self.decide(clerk, clerk_role, clerk), 403)
        self.assertEqual(await self.decide(clerk, clerk_role, user(clerk_role)), 200)  # a colleague with the same access
        self.assertEqual(await self.decide(clerk, role("operator")), 200)
        self.assertEqual(await self.decide(clerk, role("manager")), 403)

    async def test_the_administrator_is_not_limited(self):
        admin = user(role("admin"))
        supervisor = role("supervisor", builtin=False)
        self.role_grants[supervisor.id] = {"audit.events_read": True}
        for target in (supervisor, role("manager"), role("admin")):
            self.assertEqual(await self.decide(admin, target, user(target)), 200)
        self.assertEqual(await self.decide(admin, admin.role, admin), 200)


if __name__ == "__main__":
    unittest.main()
