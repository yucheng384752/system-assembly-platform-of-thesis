"""HTTP behavior of the factory API, written once so memory and SQL stores are held to the same responses."""
import json

from fastapi.testclient import TestClient

from api_support import PLAN, as_user, build, plan_text
from factory_api.support import MAX_FORM_BYTES
from factory_core.canonical import content_sha256 as content_hash
from fixtures import FORM_UPLOAD, KITS, load, parse_json, resealed, text

PLANS = '/api/factory/plans'
FORMS = '/api/factory/forms'
FORM_SHA = parse_json(FORM_UPLOAD)['contentSha256']


class ApiCases:
    """Mixed into a TestCase that provides make_store()."""

    def setUp(self):
        self.app, self.state, self.clock = build(self.make_store())
        self.manager = as_user(self.app, 'mia', 'manager')
        self.operator = as_user(self.app, 'oscar', 'operator')
        self.plan_id = self.manager.post(PLANS, content=plan_text()).json()['planId']
        self.assertEqual(self.manager.post(FORMS, content=FORM_UPLOAD).status_code, 201)

    def propose(self, client=None, values=None, **over):
        body = {'values': {'mix_minutes': 12} if values is None else values, 'reason': 'cooler room'} | over
        return (client or self.operator).post(f'{PLANS}/{self.plan_id}/parameter-sets', json=body)

    def decide(self, version=1, client=None, approve=True, note=''):
        return (client or self.manager).post(f'{PLANS}/{self.plan_id}/parameter-sets/{version}/decision', json={'approve': approve, 'note': note})

    def order(self, order_id='wo-1', start=True):
        created = self.operator.post('/api/factory/work-orders', json={'orderId': order_id, 'planId': self.plan_id})
        assert created.status_code == 201, created.text
        return self.operator.post(f'/api/factory/work-orders/{order_id}/start') if start else created

    def test_without_the_entry_permission_middleware_every_route_refuses(self):
        bare, _, _ = build(self.make_store(), authenticate=False)
        client = TestClient(bare, raise_server_exceptions=True, headers={'X-Test-User': 'mia', 'X-Test-Role': 'admin'})  # headers mean nothing alone
        routes = [(r, m) for r in bare.routes if getattr(r, 'path', '').startswith('/api/factory') for m in r.methods]
        self.assertGreaterEqual(len(routes), 15)
        for route, method in routes:
            with self.subTest(f'{method} {route.path}'):
                path = route.path.replace('{plan_id}', 'x').replace('{order_id}', 'x').replace('{alarm_id}', 'x').replace('{set_version}', '1').replace('{content_sha256}', 'x')
                self.assertEqual(client.request(method, path, json={}).status_code, 401)

    def test_a_plan_is_received_idempotently_and_by_content_not_by_formatting(self):
        again = self.manager.post(PLANS, content=json.dumps(PLAN, indent=3, sort_keys=True, ensure_ascii=False))
        self.assertEqual((again.status_code, again.json()['planId']), (201, self.plan_id))
        self.assertEqual(self.manager.get(PLANS).json(), {'planIds': [self.plan_id]})
        got = self.manager.get(f'{PLANS}/{self.plan_id}').json()
        self.assertEqual((got['executable'], got['plan']['planId']), (True, self.plan_id))

    def test_a_non_executable_plan_is_stored_for_viewing_with_its_reasons(self):
        response = self.manager.post(PLANS, content=text(load('not-executable.json')))
        self.assertEqual((response.status_code, response.json()['executable']), (201, False))
        self.assertEqual([b['nodeId'] for b in response.json()['blockers']], ['mix'])

    def test_bad_plans_are_refused_with_located_errors_and_nothing_is_stored(self):
        for name, code in (('content-tampered.json', 'plan-id-mismatch'), ('unknown-version.json', 'unknown-version')):
            with self.subTest(name):
                response = self.manager.post(PLANS, content=text(load(name)))
                self.assertEqual(response.status_code, 422)
                self.assertIn(code, {e['code'] for e in response.json()['errors']})
        self.assertEqual(self.manager.post(PLANS, content='{not json').status_code, 422)
        self.assertEqual(self.manager.post(PLANS, content=b'\xff\xfe').status_code, 422)
        self.assertEqual(self.manager.get(PLANS).json(), {'planIds': [self.plan_id]})

    def test_an_oversized_plan_is_refused_before_it_is_read(self):
        self.assertEqual(self.manager.post(PLANS, content=b' ' * (8 * 1024 * 1024 + 1)).status_code, 413)

    def test_the_proposer_is_the_authenticated_user_never_a_body_field(self):
        spoof = self.propose(proposedBy='mia')
        self.assertEqual(spoof.status_code, 422)  # unknown field
        record = self.propose()
        self.assertEqual((record.status_code, record.json()['proposedBy'], record.json()['status']), (201, 'oscar', 'pending'))
        self.assertEqual(record.json()['proposedAt'], self.clock.now)

    def test_a_self_proposed_change_is_approved_only_by_a_manager_or_admin_or_another_person(self):
        self.propose(client=self.operator)
        own = self.decide(client=self.operator)
        self.assertEqual((own.status_code, own.json()['errors'][0]['code']), (403, 'same-person'))
        self.assertEqual(self.decide(client=self.manager).status_code, 200)  # a different person
        self.propose(client=self.manager)
        self.assertEqual(self.decide(2, client=self.manager).status_code, 200)  # manager approves their own proposal

    def test_decisions_conflicts_and_unknowns_use_distinct_statuses(self):
        self.propose()
        self.assertEqual(self.decide().status_code, 200)
        self.assertEqual(self.decide().status_code, 409)
        self.assertEqual(self.decide(9).status_code, 404)
        self.assertEqual(self.decide(note='', approve=False, version=1).status_code, 409)
        self.assertEqual(self.manager.post(f'{PLANS}/{"0" * 64}/parameter-sets/1/decision', json={'approve': True}).status_code, 404)
        self.assertEqual(self.manager.get(f'{PLANS}/{"0" * 64}').status_code, 404)
        self.assertEqual(self.propose(values={'mix_minutes': 99}).status_code, 422)
        self.assertEqual(self.manager.post(f'{PLANS}/{self.plan_id}/parameter-sets/one/decision', json={'approve': True}).status_code, 422)

    def test_numbers_beyond_what_both_languages_hash_identically_are_refused_not_a_server_error(self):
        response = self.propose(values={'mix_minutes': 10 ** 30})
        self.assertIn(response.status_code, (422,))

    def test_listing_shows_pending_approved_and_rejected_with_their_decisions(self):
        self.propose(), self.propose(values={'mix_minutes': 14}), self.propose(values={'mix_minutes': 9})
        self.decide(1), self.decide(2, approve=False, note='too long')
        sets = self.manager.get(f'{PLANS}/{self.plan_id}/parameter-sets').json()['parameterSets']
        self.assertEqual([s['status'] for s in sets], ['approved', 'rejected', 'pending'])
        self.assertEqual(sets[1]['decision']['note'], 'too long')
        self.assertIsNone(sets[2]['decision'])

    def test_orders_use_the_deployments_kits_and_never_what_the_client_claims(self):
        smaller, _, _ = build(self.make_store(), kits=KITS - {'quality-kit'})
        client = as_user(smaller, 'oscar', 'operator')
        client.post(PLANS, content=plan_text())
        client.post(FORMS, content=FORM_UPLOAD)
        refused = client.post('/api/factory/work-orders', json={'orderId': 'wo-x', 'planId': self.plan_id})
        self.assertEqual((refused.status_code, refused.json()['errors'][0]['code']), (409, 'kit-not-active'))
        claim = self.operator.post('/api/factory/work-orders', json={'orderId': 'wo-y', 'planId': self.plan_id, 'activeKits': ['quality-kit']})
        self.assertEqual(claim.status_code, 422)

    def test_an_order_waits_for_the_form_its_plan_names(self):
        bare, _, _ = build(self.make_store())
        client = as_user(bare, 'mia', 'manager')
        client.post(PLANS, content=plan_text())
        refused = client.post('/api/factory/work-orders', json={'orderId': 'wo-x', 'planId': self.plan_id})
        self.assertEqual((refused.status_code, refused.json()['errors'][0]['code']), (409, 'form-unavailable'))
        client.post(FORMS, content=FORM_UPLOAD)
        self.assertEqual(client.post('/api/factory/work-orders', json={'orderId': 'wo-x', 'planId': self.plan_id}).status_code, 201)

    def test_a_form_with_other_content_does_not_satisfy_the_plan(self):
        bare, _, _ = build(self.make_store())
        client = as_user(bare, 'mia', 'manager')
        client.post(PLANS, content=plan_text())
        variant = parse_json(FORM_UPLOAD)['definition']
        variant['fields']['water_temp']['default'] = 25  # same id, different content, so a different hash
        uploaded = client.post(FORMS, json={'contentSha256': content_hash(variant), 'definition': variant})
        self.assertEqual(uploaded.status_code, 201)
        self.assertNotEqual(uploaded.json()['contentSha256'], FORM_SHA)
        refused = client.post('/api/factory/work-orders', json={'orderId': 'wo-x', 'planId': self.plan_id})
        self.assertEqual((refused.status_code, refused.json()['errors'][0]['code']), (409, 'form-unavailable'))

    def test_a_form_is_stored_by_its_content_and_the_first_upload_stands(self):
        first = self.manager.get(f'{FORMS}/{FORM_SHA}').json()
        self.assertEqual((first['formId'], first['uploadedBy'], first['definition']['name']), ('mix-record', 'mia', '混合記錄'))
        again = as_user(self.app, 'admin', 'admin').post(FORMS, content=json.dumps(parse_json(FORM_UPLOAD), indent=4, sort_keys=True, ensure_ascii=False))
        self.assertEqual((again.status_code, again.json()['uploadedBy'], again.json()['contentSha256']), (201, 'mia', FORM_SHA))
        self.assertEqual(self.operator.get(f'{FORMS}/{FORM_SHA}').status_code, 200)
        self.assertEqual(self.operator.get(f'{FORMS}/{"0" * 64}').status_code, 404)

    def test_a_form_that_does_not_match_its_claimed_hash_or_shape_is_refused_and_not_stored(self):
        good = parse_json(FORM_UPLOAD)
        edited = {**good, 'definition': {**good['definition'], 'name': 'edited'}}
        no_type = {**good, 'definition': {**good['definition'], 'fields': {'x': {'label': 'no type'}}}}
        extra = {**good, 'note': 'x'}
        cases = [('form-hash-mismatch', edited), ('unknown-field-type', no_type), ('broken-structure', extra),
                 ('broken-structure', {'contentSha256': FORM_SHA, 'definition': []})]
        fresh, _, _ = build(self.make_store())
        client = as_user(fresh, 'mia', 'manager')
        for code, body in cases:
            with self.subTest(code, body=str(body)[:60]):
                response = client.post(FORMS, json=body)
                self.assertEqual(response.status_code, 422)
                self.assertIn(code, {e['code'] for e in response.json()['errors']})
        self.assertEqual(client.post(FORMS, content=bytes([255, 254])).status_code, 422)
        self.assertEqual(client.post(FORMS, content=b'{' * 10).status_code, 422)
        self.assertEqual(client.get(f'{FORMS}/{FORM_SHA}').status_code, 404)

    def test_an_oversized_form_is_refused(self):
        big = parse_json(FORM_UPLOAD)
        big['definition']['name'] = 'x' * (MAX_FORM_BYTES + 1)
        self.assertEqual(self.manager.post(FORMS, json=big).status_code, 413)

    def test_an_order_pins_the_plan_then_the_approved_set_and_later_approvals_do_not_reach_it(self):
        self.propose(), self.decide(1)
        self.assertEqual(self.order().json()['setVersion'], 1)
        self.propose(values={'mix_minutes': 18}), self.decide(2)
        shown = self.operator.get('/api/factory/work-orders/wo-1').json()
        self.assertEqual((shown['setVersion'], shown['effectiveParams']['mix_minutes'], shown['heldNodes']), (1, 12, []))
        self.assertEqual(self.operator.post('/api/factory/work-orders/wo-1/start').json()['setVersion'], 1)
        duplicate = self.operator.post('/api/factory/work-orders', json={'orderId': 'wo-1', 'planId': self.plan_id})
        self.assertEqual(duplicate.status_code, 409)

    def test_an_unstarted_order_has_no_effective_parameters_and_unknown_orders_are_404(self):
        self.order(start=False)
        self.assertIsNone(self.operator.get('/api/factory/work-orders/wo-1').json()['effectiveParams'])
        self.assertEqual(self.operator.get('/api/factory/work-orders/nope').status_code, 404)
        self.assertEqual(self.operator.post('/api/factory/work-orders/nope/start').status_code, 404)

    def test_an_alarm_holds_the_node_until_a_manager_acknowledges_and_reminders_follow_the_interval(self):
        self.propose(client=self.operator, values={}, alarmIntervals={'temp-out-of-range': 10}), self.decide(1)
        self.order()
        raised = self.operator.post('/api/factory/work-orders/wo-1/alarms', json={'ruleId': 'temp-out-of-range', 'detail': '31 C'})
        self.assertEqual((raised.status_code, raised.json()['status'], raised.json()['nodeId']), (201, 'open', 'qc'))
        self.assertEqual(self.operator.get('/api/factory/work-orders/wo-1').json()['heldNodes'], ['qc'])
        self.clock.now = '2026-10-28T12:09:00Z'
        self.assertEqual(self.manager.post('/api/factory/alarms/reminders').json()['due'], [])
        self.clock.now = '2026-10-28T12:10:00Z'
        self.assertEqual([a['alarmId'] for a in self.manager.post('/api/factory/alarms/reminders').json()['due']], [raised.json()['alarmId']])
        refused = self.operator.post(f"/api/factory/alarms/{raised.json()['alarmId']}/acknowledge", json={})
        self.assertEqual((refused.status_code, refused.json()['errors'][0]['code']), (403, 'role'))
        self.assertEqual(self.operator.get('/api/factory/work-orders/wo-1').json()['heldNodes'], ['qc'])
        ack = self.manager.post(f"/api/factory/alarms/{raised.json()['alarmId']}/acknowledge", json={'note': 'chiller checked'})
        self.assertEqual((ack.status_code, ack.json()['acknowledgedBy']), (200, 'mia'))
        self.assertEqual(self.operator.get('/api/factory/work-orders/wo-1').json()['heldNodes'], [])
        again = self.manager.post(f"/api/factory/alarms/{raised.json()['alarmId']}/acknowledge", json={})
        self.assertEqual(again.status_code, 409)
        self.assertEqual(self.manager.post('/api/factory/alarms/reminders').json()['due'], [])

    def test_alarm_requests_for_unknown_orders_rules_and_unstarted_orders_are_refused(self):
        self.order('wo-2', start=False)
        body = {'ruleId': 'temp-out-of-range'}
        self.assertEqual(self.operator.post('/api/factory/work-orders/ghost/alarms', json=body).status_code, 404)
        self.assertEqual(self.operator.post('/api/factory/work-orders/wo-2/alarms', json=body).status_code, 409)
        self.order()
        self.assertEqual(self.operator.post('/api/factory/work-orders/wo-1/alarms', json={'ruleId': 'nope'}).status_code, 404)
        self.assertEqual(self.manager.post('/api/factory/alarms/ghost/acknowledge', json={}).status_code, 404)

    def test_the_alarm_list_filters_by_order_and_by_open(self):
        self.order(), self.order('wo-2')
        for order in ('wo-1', 'wo-2'):
            self.operator.post(f'/api/factory/work-orders/{order}/alarms', json={'ruleId': 'temp-out-of-range'})
        self.manager.post('/api/factory/alarms/wo-1:temp-out-of-range:1/acknowledge', json={})
        listed = lambda query: [a['alarmId'] for a in self.manager.get('/api/factory/alarms' + query).json()['alarms']]
        self.assertEqual(listed(''), ['wo-1:temp-out-of-range:1', 'wo-2:temp-out-of-range:1'])
        self.assertEqual(listed('?orderId=wo-2'), ['wo-2:temp-out-of-range:1'])
        self.assertEqual(listed('?openOnly=true'), ['wo-2:temp-out-of-range:1'])
