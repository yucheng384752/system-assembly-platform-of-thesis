"""Work orders: plan pinned at creation, parameter set pinned at start, later changes never reach existing orders."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures import EVALUATOR, KITS, NOW, load, register_forms, resealed
from factory_core.plan import PlanRejected
from factory_core.store import MemoryStore
from factory_core.workorder import FactoryState

LATER = '2026-10-28T13:00:00Z'


class WorkOrderTests(unittest.TestCase):
    def setUp(self):
        self.state = FactoryState(self.make_store())
        self.plan_id = self.state.store_plan(load('valid.json')).plan_id
        register_forms(self.state)

    def make_store(self):
        return MemoryStore()

    def create(self, order_id='wo-1', plan_id=None, **over):
        args = dict(created_by='alice', now=NOW, active_kits=KITS, evaluator_commit=EVALUATOR) | over
        return self.state.create_order(order_id, plan_id or self.plan_id, **args)

    def approve_set(self, values, proposer='alice', approver='bob'):
        record = self.state.params.propose(self.plan_id, values=values, proposed_by=proposer, reason='r', now=NOW)
        self.state.params.decide(self.plan_id, record.set_version, approve=True, by=approver, role='manager', now=NOW)
        return record

    def test_an_order_stores_only_the_plan_id(self):
        order = self.create()
        self.assertEqual((order.plan_id, order.set_version, order.started), (self.plan_id, None, False))

    def test_creation_is_refused_for_non_executable_plans_inactive_kits_and_unknown_plans(self):
        bad = self.state.store_plan(load('not-executable.json')).plan_id
        with self.assertRaises(PlanRejected) as caught:
            self.create('wo-x', bad)
        self.assertIn('not-executable', {e['code'] for e in caught.exception.errors})
        with self.assertRaises(PlanRejected):
            self.create('wo-y', active_kits=set())
        with self.assertRaises(PlanRejected):
            self.create('wo-z', '0' * 64)
        self.assertEqual(self.state.orders, {})

    def test_a_plan_that_fails_verification_is_not_stored(self):
        with self.assertRaises(PlanRejected):
            self.state.store_plan(load('content-tampered.json'))
        self.assertEqual(set(self.state.plans), {self.plan_id})

    def test_duplicate_order_ids_are_refused(self):
        self.create()
        with self.assertRaises(PlanRejected):
            self.create()

    def test_start_pins_the_latest_approved_set(self):
        self.approve_set({'mix_minutes': 12})
        self.approve_set({'mix_minutes': 14})
        self.create()
        started = self.state.start_order('wo-1', now=LATER)
        self.assertEqual((started.set_version, started.using_defaults), (2, False))
        self.assertEqual(self.state.effective_params('wo-1')['mix_minutes'], 14)

    def test_start_without_an_approved_set_uses_defaults_and_says_so(self):
        self.state.params.propose(self.plan_id, values={'mix_minutes': 12}, proposed_by='alice', reason='r', now=NOW)  # pending: must not apply
        self.create()
        started = self.state.start_order('wo-1', now=LATER)
        self.assertEqual((started.set_version, started.using_defaults), (None, True))
        self.assertEqual(self.state.effective_params('wo-1')['mix_minutes'], 10)

    def test_a_set_approved_after_start_never_changes_a_started_order(self):
        self.approve_set({'mix_minutes': 12})
        self.create()
        self.state.start_order('wo-1', now=LATER)
        self.approve_set({'mix_minutes': 18})
        self.assertEqual(self.state.start_order('wo-1', now=LATER).set_version, 1)
        self.assertEqual(self.state.effective_params('wo-1')['mix_minutes'], 12)

    def test_an_order_not_yet_started_takes_the_set_approved_before_it_starts(self):
        self.create()
        self.approve_set({'mix_minutes': 18})
        self.assertEqual(self.state.start_order('wo-1', now=LATER).set_version, 1)

    def test_changing_the_plan_changes_new_orders_and_leaves_old_ones_alone(self):
        old = self.create('wo-old')
        changed = load('valid.json')
        changed['nodes'][1]['name'] = 'Mix (revised)'
        new_plan_id = self.state.store_plan(resealed(changed)).plan_id
        self.assertNotEqual(new_plan_id, self.plan_id)
        new = self.create('wo-new', new_plan_id)
        self.assertEqual((self.state.orders['wo-old'].plan_id, new.plan_id), (self.plan_id, new_plan_id))
        self.assertEqual(self.state.orders['wo-old'], old)
        self.assertEqual(self.state.plans[self.plan_id].plan['nodes'][1]['name'], load('valid.json')['nodes'][1]['name'])

    def test_parameter_sets_belong_to_one_plan_only(self):
        self.approve_set({'mix_minutes': 12})
        changed = load('valid.json')
        changed['nodes'][1]['name'] = 'Mix (revised)'
        other = self.state.store_plan(resealed(changed)).plan_id
        self.assertIsNone(self.state.params.latest_approved(other))


if __name__ == '__main__':
    unittest.main()
