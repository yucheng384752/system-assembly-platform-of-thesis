"""Entry-permission wiring: kit.contract.json is assembled into an entry directory and enforced with the real Directory and
policy code from entry-permission-kit, in front of the real API. Only the credential check (JWT and user lookup) is replaced
by two test headers; the allow/deny decision is the production one.
"""
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / 'kits' / 'entry-permission-kit' / 'src' / 'backend'))
from api_support import as_user, build, plan_text
from app.entry_permission.directory import Directory  # the production entry-directory reader and policy
from jsonschema import Draft202012Validator

from factory_core.store import MemoryStore

CONTRACT = json.loads((Path(__file__).resolve().parents[1] / 'kit.contract.json').read_text(encoding='utf-8'))
SCHEMA = json.loads((ROOT / 'schemas' / 'entry-points.schema.json').read_text(encoding='utf-8'))


def assembled(contract=CONTRACT) -> dict:
    """What services/package/deployment.mjs entryDirectory builds for a selection that includes this kit."""
    entries = [{**entry, 'kitId': contract['kit']} for entry in contract['entryPoints']]
    return {'format': 'composer-entry-points', 'version': 1, 'entryPoints': entries, 'publicPaths': ['/healthz', '/api/auth/login']}


def pattern(path: str) -> str:
    return re.sub(r'\{[^}]+\}', '{}', path)


def actor(role, *, active=True):
    return SimpleNamespace(is_active=active, role=SimpleNamespace(name=role, is_readonly=role == 'audit', is_builtin=True))


def enforcing_app(*, grants=None, overrides=None, active=True, directory=None):
    """The API behind the production decision. `grants` and `overrides` are what the database would hold."""
    directory = directory or Directory(assembled())

    def authorize(method, path, role, user):
        if not role:
            return True  # no identity: the API itself answers 401
        return directory.request_allowed(method, path, actor(role, active=active), grants or {}, overrides or {})
    app, state, _ = build(MemoryStore(), authorize=authorize)
    return app, state


class ContractTests(unittest.TestCase):
    def test_the_assembled_directory_satisfies_the_published_schema_and_the_production_reader(self):
        document = assembled()
        errors = list(Draft202012Validator(SCHEMA).iter_errors(document))
        self.assertEqual([e.message for e in errors], [])
        Directory(document)

    def test_every_api_route_is_covered_by_exactly_one_entry_point_and_every_declared_route_exists(self):
        app, _, _ = build(MemoryStore())
        real = {(m, pattern(r.path)) for r in app.routes if getattr(r, 'path', '').startswith('/api/factory') for m in r.methods}
        declared = [(r['method'], pattern(r['path'])) for e in CONTRACT['entryPoints'] for r in e['routes']]
        self.assertEqual(len(declared), len(set(declared)), 'a route is declared by two entry points')
        self.assertEqual(real - set(declared), set(), 'routes without an entry point')
        self.assertEqual(set(declared) - real, set(), 'entry points naming routes that do not exist')
        provided = {(a['method'], pattern(a['path'])) for a in CONTRACT['provides']['api']}
        self.assertEqual(provided, real)

    def test_entry_rules_the_directory_assembler_also_enforces(self):
        keys = [e['key'] for e in CONTRACT['entryPoints']]
        self.assertEqual(len(keys), len(set(keys)))
        for entry in CONTRACT['entryPoints']:
            with self.subTest(entry['key']):
                self.assertIn('admin', entry['defaultRoles'])  # an admin must never be locked out of the factory
                if entry['access'] == 'write':
                    self.assertNotIn('audit', entry['defaultRoles'])
                if entry['access'] == 'read':
                    self.assertTrue(all(r['method'] == 'GET' for r in entry['routes']))

    def test_the_approval_and_acknowledgement_entries_are_narrower_than_proposing_and_raising(self):
        roles = {e['key']: set(e['defaultRoles']) for e in CONTRACT['entryPoints']}
        self.assertEqual(roles['factory.params_approve'], {'admin', 'manager'})
        self.assertEqual(roles['factory.alarm_acknowledge'], {'admin', 'manager'})
        self.assertIn('operator', roles['factory.params_propose'])


class EnforcementTests(unittest.TestCase):
    PLANS = '/api/factory/plans'

    def client(self, role, user=None, **kwargs):
        app, state = enforcing_app(**kwargs)
        self.state = state
        return app, as_user(app, user or role, role)

    def seeded(self):
        """An app with the plan stored by an admin."""
        app, admin = self.client('admin')
        self.assertEqual(admin.post(self.PLANS, content=plan_text()).status_code, 201)
        return app, admin

    def test_each_role_gets_exactly_the_entries_the_contract_gives_it(self):
        app, admin = self.seeded()
        plan_id = admin.get(self.PLANS).json()['planIds'][0]
        calls = {
            'view': lambda c: c.get(self.PLANS),
            'publish': lambda c: c.post(self.PLANS, content=plan_text()),
            'propose': lambda c: c.post(f'{self.PLANS}/{plan_id}/parameter-sets', json={'values': {'mix_minutes': 12}, 'reason': 'r'}),
            'approve': lambda c: c.post(f'{self.PLANS}/{plan_id}/parameter-sets/1/decision', json={'approve': True}),
            'order': lambda c: c.post('/api/factory/work-orders', json={'orderId': 'wo-1', 'planId': plan_id}),
            'remind': lambda c: c.post('/api/factory/alarms/reminders'),
        }
        expected = {
            'admin': dict.fromkeys(calls, True),
            'manager': dict.fromkeys(calls, True),
            'operator': {'view': True, 'publish': False, 'propose': True, 'approve': False, 'order': True, 'remind': False},
            'audit': {'view': True, 'publish': False, 'propose': False, 'approve': False, 'order': False, 'remind': False},
            'qc': dict.fromkeys(calls, False),  # a role the contract does not name gets nothing by default
        }
        for role, allowed in expected.items():
            client = as_user(app, f'{role}-user', role)
            for name in ('view', 'propose', 'order', 'publish', 'remind', 'approve'):
                with self.subTest(role=role, call=name):
                    status = calls[name](client).status_code
                    if allowed[name]:
                        self.assertNotEqual(status, 403, 'an allowed role must reach the handler')
                    else:
                        self.assertEqual(status, 403)

    def test_a_refused_request_changes_nothing(self):
        app, admin = self.seeded()
        plan_id = admin.get(self.PLANS).json()['planIds'][0]
        operator = as_user(app, 'oscar', 'operator')
        self.assertEqual(operator.post(f'{self.PLANS}/{plan_id}/parameter-sets/1/decision', json={'approve': True}).status_code, 403)
        self.assertEqual(self.state.params.history(plan_id), ())
        audit = as_user(app, 'ada', 'audit')
        self.assertEqual(audit.post(f'{self.PLANS}/{plan_id}/parameter-sets', json={'values': {}, 'reason': 'r'}).status_code, 403)
        self.assertEqual(self.state.params.history(plan_id), ())

    def test_a_route_outside_every_entry_is_open_to_the_builtin_admin_only(self):
        app, _ = self.seeded()
        self.assertEqual(as_user(app, 'mia', 'manager').get('/api/factory/unlisted').status_code, 403)
        self.assertEqual(as_user(app, 'root', 'admin').get('/api/factory/unlisted').status_code, 404)

    def test_an_inactive_account_is_refused_everywhere(self):
        app, _ = enforcing_app(active=False)
        self.assertEqual(as_user(app, 'root', 'admin').get(self.PLANS).status_code, 403)

    def test_an_individual_override_removes_or_grants_access_in_both_directions(self):
        app, _ = enforcing_app(overrides={'factory.params_approve': False})
        self.assertEqual(as_user(app, 'mia', 'manager').post(f'{self.PLANS}/{"0" * 64}/parameter-sets/1/decision', json={'approve': True}).status_code, 403)
        app, _ = enforcing_app(overrides={'factory.params_approve': True})
        self.assertNotEqual(as_user(app, 'oscar', 'operator').post(f'{self.PLANS}/{"0" * 64}/parameter-sets/1/decision', json={'approve': True}).status_code, 403)

    def test_a_role_grant_cannot_make_an_audit_account_write(self):
        app, _ = enforcing_app(grants={'factory.params_propose': True, 'factory.plan_publish': True})
        audit = as_user(app, 'ada', 'audit')
        self.assertEqual(audit.post(self.PLANS, content=plan_text()).status_code, 403)

    def test_the_domain_rules_still_hold_when_the_entry_layer_grants_more_than_the_defaults(self):
        # The operator is granted the acknowledge entry. The handler's own role rule is a second lock: only manager or admin acknowledge.
        app, _ = enforcing_app(grants={'factory.alarm_acknowledge': True, 'factory.params_approve': True})
        admin = as_user(app, 'root', 'admin')
        plan_id = admin.post(self.PLANS, content=plan_text()).json()['planId']
        operator = as_user(app, 'oscar', 'operator')
        operator.post(f'{self.PLANS}/{plan_id}/parameter-sets', json={'values': {'mix_minutes': 12}, 'reason': 'r'})
        own = operator.post(f'{self.PLANS}/{plan_id}/parameter-sets/1/decision', json={'approve': True})
        self.assertEqual((own.status_code, own.json()['errors'][0]['code']), (403, 'same-person'))  # entry allowed it; the same-person rule refused
        operator.post('/api/factory/work-orders', json={'orderId': 'wo-1', 'planId': plan_id})
        operator.post('/api/factory/work-orders/wo-1/start')
        raised = operator.post('/api/factory/work-orders/wo-1/alarms', json={'ruleId': 'temp-out-of-range'}).json()
        refused = operator.post(f"/api/factory/alarms/{raised['alarmId']}/acknowledge", json={})
        self.assertEqual((refused.status_code, refused.json()['errors'][0]['code']), (403, 'role'))


if __name__ == '__main__':
    unittest.main()
