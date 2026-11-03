"""ParameterSet service: validation against the plan, append-only history, and the proposer/approver rule."""
import dataclasses
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures import NOW, load
from factory_core.params import ParameterSetError
from factory_core.store import MemoryStore
from factory_core.workorder import FactoryState

GOOD = {'mix_minutes': 12, 'temp_max': 28}


def failed(case: unittest.TestCase, call, code: str):
    with case.assertRaises(ParameterSetError) as caught:
        call()
    case.assertIn(code, {e['code'] for e in caught.exception.errors})
    return caught.exception


class ParameterSetTests(unittest.TestCase):
    def setUp(self):
        self.state = FactoryState(self.make_store())
        self.plan_id = self.state.store_plan(load('valid.json')).plan_id
        self.service = self.state.params

    def make_store(self):
        return MemoryStore()

    def propose(self, values=None, **over):
        args = dict(values=GOOD if values is None else values, proposed_by='alice', reason='cooler room', now=NOW) | over
        return self.service.propose(self.plan_id, **args)

    def test_valid_proposal_is_pending_with_a_content_hash_and_version_1(self):
        record = self.propose()
        self.assertEqual((record.set_version, self.service.status(self.plan_id, 1)), (1, 'pending'))
        self.assertRegex(record.content_sha256, r'^[0-9a-f]{64}$')

    def test_content_hash_covers_values_tables_and_alarm_intervals(self):
        base = self.propose().content_sha256
        self.assertEqual(self.propose().content_sha256, base)
        self.assertNotEqual(self.propose({'mix_minutes': 13}).content_sha256, base)
        table = [{'item': 'core_temp', 'limit': 24}]
        with_table = self.propose(tables={'dough_checks': table}).content_sha256
        self.assertNotEqual(with_table, base)
        self.assertNotEqual(self.propose(alarm_intervals={'temp-out-of-range': 15}).content_sha256, base)

    def test_values_are_checked_against_what_the_plan_declares(self):
        failed(self, lambda: self.propose({'ghost': 1}), 'unknown-param')
        failed(self, lambda: self.propose({'plant_name': 'x'}), 'not-tunable')
        failed(self, lambda: self.propose({'mix_minutes': 21}), 'range')
        failed(self, lambda: self.propose({'mix_minutes': 4}), 'range')
        failed(self, lambda: self.propose({'mix_minutes': '12'}), 'type')
        failed(self, lambda: self.propose({'mix_minutes': True}), 'type')  # a bool is not a number
        failed(self, lambda: self.propose({'mix_minutes': float('nan')}), 'type')

    def test_range_bounds_are_inclusive(self):
        self.propose({'mix_minutes': 5})
        self.propose({'mix_minutes': 20})

    def test_one_bad_value_refuses_the_whole_set_and_records_nothing(self):
        error = failed(self, lambda: self.propose({'mix_minutes': 12, 'temp_max': 99, 'ghost': 1}), 'range')
        self.assertEqual({e['code'] for e in error.errors}, {'range', 'unknown-param'})
        self.assertEqual(self.service.history(self.plan_id), ())

    def test_tables_follow_the_declared_columns(self):
        ok = [{'item': 'core_temp', 'limit': 24}]
        self.propose(tables={'dough_checks': ok})
        failed(self, lambda: self.propose(tables={'nope': ok}), 'unknown-table')
        failed(self, lambda: self.propose(tables={'dough_checks': [{'item': 'x'}]}), 'required')
        failed(self, lambda: self.propose(tables={'dough_checks': [{'item': 'x', 'limit': 'hot'}]}), 'type')
        failed(self, lambda: self.propose(tables={'dough_checks': [{'item': 'x', 'limit': 1, 'extra': 1}]}), 'unknown-column')
        failed(self, lambda: self.propose(tables={'dough_checks': {'item': 'x'}}), 'type')

    def test_alarm_intervals_need_a_declared_rule_and_a_positive_number(self):
        self.propose(alarm_intervals={'temp-out-of-range': 30})
        failed(self, lambda: self.propose(alarm_intervals={'ghost': 5}), 'unknown-rule')
        failed(self, lambda: self.propose(alarm_intervals={'temp-out-of-range': 0}), 'range')

    def test_an_upload_records_the_file_hash_and_a_reason_is_required(self):
        failed(self, lambda: self.propose(source='upload'), 'source')
        self.assertEqual(self.propose(source='upload', source_sha256='a' * 64).source_sha256, 'a' * 64)
        failed(self, lambda: self.propose(source='email'), 'source')
        failed(self, lambda: self.propose(reason='  '), 'required')

    def test_unknown_plan_is_refused(self):
        failed(self, lambda: self.service.propose('0' * 64, values={}, proposed_by='a', reason='r', now=NOW), 'unknown-plan')

    def test_versions_count_up_per_plan(self):
        self.assertEqual([self.propose().set_version for _ in range(3)], [1, 2, 3])


class ApprovalRuleTests(unittest.TestCase):
    def make_store(self):
        return MemoryStore()

    def setUp(self):
        self.state = FactoryState(self.make_store())
        self.plan_id = self.state.store_plan(load('valid.json')).plan_id
        self.service = self.state.params
        self.service.propose(self.plan_id, values=GOOD, proposed_by='alice', reason='r', now=NOW)

    def approve(self, by, role, version=1):
        return self.service.decide(self.plan_id, version, approve=True, by=by, role=role, now=NOW)

    def test_the_proposer_cannot_approve_their_own_change_unless_manager_or_admin(self):
        failed(self, lambda: self.approve('alice', 'operator'), 'same-person')
        failed(self, lambda: self.approve('alice', 'audit'), 'same-person')
        self.assertEqual(self.service.status(self.plan_id, 1), 'pending')

    def test_manager_and_admin_may_approve_their_own_proposal(self):
        self.assertEqual(self.approve('alice', 'manager').status, 'approved')
        self.service.propose(self.plan_id, values=GOOD, proposed_by='root', reason='r', now=NOW)
        self.assertEqual(self.approve('root', 'admin', 2).status, 'approved')

    def test_a_different_person_may_approve(self):
        self.assertEqual(self.approve('bob', 'operator').status, 'approved')
        self.assertEqual(self.service.decision(self.plan_id, 1).decided_by, 'bob')

    def test_a_rejection_needs_a_reason_and_is_kept(self):
        failed(self, lambda: self.service.decide(self.plan_id, 1, approve=False, by='bob', role='manager', now=NOW), 'required')
        self.service.decide(self.plan_id, 1, approve=False, by='bob', role='manager', now=NOW, note='too hot')
        self.assertEqual(self.service.status(self.plan_id, 1), 'rejected')
        self.assertEqual(len(self.service.history(self.plan_id)), 1)

    def test_a_decided_version_cannot_be_decided_again(self):
        self.approve('bob', 'manager')
        failed(self, lambda: self.approve('carol', 'manager'), 'already-decided')
        failed(self, lambda: self.service.decide(self.plan_id, 1, approve=False, by='carol', role='manager', now=NOW, note='x'), 'already-decided')

    def test_unknown_version_is_refused(self):
        failed(self, lambda: self.approve('bob', 'manager', 5), 'unknown-set')

    def test_records_cannot_be_edited(self):
        record = self.service.get(self.plan_id, 1)
        with self.assertRaises(dataclasses.FrozenInstanceError):
            record.reason = 'changed'  # type: ignore[misc]

    def test_only_approved_versions_are_used_and_the_latest_wins(self):
        self.assertIsNone(self.service.latest_approved(self.plan_id))
        self.approve('bob', 'manager')
        self.service.propose(self.plan_id, values={'mix_minutes': 9}, proposed_by='alice', reason='r', now=NOW)  # v2 stays pending
        self.assertEqual(self.service.latest_approved(self.plan_id).set_version, 1)
        self.service.propose(self.plan_id, values={'mix_minutes': 8}, proposed_by='alice', reason='r', now=NOW)
        self.service.decide(self.plan_id, 3, approve=False, by='bob', role='manager', now=NOW, note='no')
        self.assertEqual(self.service.latest_approved(self.plan_id).set_version, 1)
        self.approve('bob', 'manager', 2)
        self.assertEqual(self.service.latest_approved(self.plan_id).set_version, 2)


if __name__ == '__main__':
    unittest.main()
