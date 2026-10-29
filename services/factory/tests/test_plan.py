"""Plan receiver: the Python side must accept what the TypeScript builder produces and refuse what contract section 6 lists."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures import EVALUATOR, FORMS, KITS, load, resealed, text
from factory_core.schema_check import schema_errors
from factory_core.plan import PlanRejected, _check_structure, plan_id_of, receive_plan, work_order_blockers


def codes(error: PlanRejected) -> set[str]:
    return {e['code'] for e in error.errors}


def rejected(case: unittest.TestCase, document, code: str) -> PlanRejected:
    with case.assertRaises(PlanRejected) as caught:
        receive_plan(document)
    case.assertIn(code, codes(caught.exception))
    return caught.exception


class ReceivePlanTests(unittest.TestCase):
    def test_python_recomputes_the_planid_the_typescript_side_declared(self):
        for name in ('valid.json', 'timing-missing.json', 'not-executable.json'):
            with self.subTest(name):
                plan = load(name)
                self.assertEqual(plan_id_of(plan), plan['planId'])
                self.assertEqual(receive_plan(plan).plan_id, plan['planId'])

    def test_text_and_object_input_give_the_same_plan(self):
        plan = load('valid.json')
        self.assertEqual(receive_plan(text(plan)).plan, receive_plan(plan).plan)

    def test_declared_id_that_does_not_match_the_content_is_refused(self):
        rejected(self, load('plan-id-mismatch.json'), 'plan-id-mismatch')
        rejected(self, load('content-tampered.json'), 'plan-id-mismatch')

    def test_unknown_format_or_version_is_refused_without_guessing(self):
        rejected(self, load('unknown-version.json'), 'unknown-version')
        other = load('valid.json')
        other['format'] = 'something-else'
        rejected(self, other, 'unknown-format')

    def test_input_that_is_not_a_plan_is_refused_with_a_located_error(self):
        rejected(self, '{not json', 'broken-structure')
        rejected(self, '[]', 'broken-structure')
        incomplete = load('valid.json')
        del incomplete['order']
        self.assertEqual(rejected(self, incomplete, 'broken-structure').errors[0]['path'], '/order')

    def test_malformed_inner_shape_is_an_error_not_a_crash(self):
        plan = load('valid.json')
        del plan['flows'][0]['from']
        rejected(self, resealed(plan), 'schema')  # the schema locates it before any structural code can crash

    def test_a_non_executable_plan_is_stored_for_viewing_but_cannot_make_orders(self):
        received = receive_plan(load('not-executable.json'))
        self.assertFalse(received.executable)
        self.assertEqual([b['nodeId'] for b in received.blockers], ['mix'])
        errors = work_order_blockers(received, active_kits=KITS, registered_forms=FORMS, evaluator_commit=EVALUATOR)
        self.assertIn('not-executable', {e['code'] for e in errors})

    def test_structural_faults_are_refused_even_when_the_id_matches(self):
        def with_change(change):
            plan = load('valid.json')
            change(plan)
            return resealed(plan)
        cases = {
            'dangling-flow': lambda p: p['flows'][0]['to'].update(node='ghost'),
            'port-flow-mismatch': lambda p: p['nodes'][1]['inputs'][0]['flows'].clear(),
            'duplicate-node': lambda p: p['nodes'].append(copy.deepcopy(p['nodes'][0])),
            'order-mismatch': lambda p: p['order'].pop(),
            'order-violation': lambda p: p['order'].reverse(),
            'missing-binding': lambda p: p['nodes'][1].pop('binding'),
            'missing-executor': lambda p: p['nodes'][1].pop('executor'),
            'missing-reason': lambda p: p['nodes'][1].update(executable=False),
            'contradiction': lambda p: p['nodes'][1].update(reason='x'),
            'missing-default': lambda p: p['params'][0].pop('default'),
        }
        for code, change in cases.items():
            with self.subTest(code):
                changed = with_change(change)
                # Whatever the schema already refuses is refused as 'schema'; the factory's own structural check
                # must still name the fault itself, because it also guards plans that reach it another way.
                self.assertTrue(codes(rejected(self, changed, 'schema' if schema_errors(changed) else code)))
                self.assertIn(code, {e['code'] for e in _check_structure(changed)})


class WorkOrderBlockerTests(unittest.TestCase):
    def setUp(self):
        self.received = receive_plan(load('valid.json'))

    def blockers(self, **over):
        args = dict(active_kits=KITS, registered_forms=FORMS, evaluator_commit=EVALUATOR) | over
        return {e['code'] for e in work_order_blockers(self.received, **args)}

    def test_an_executable_plan_with_everything_available_has_no_blockers(self):
        self.assertEqual(self.blockers(), set())

    def test_a_kit_outside_the_current_selection_blocks(self):
        self.assertEqual(self.blockers(active_kits=KITS - {'quality-kit'}), {'kit-not-active'})

    def test_a_form_the_factory_does_not_hold_blocks(self):
        # Registered under another hash is the same as not registered: the plan names one exact content.
        self.assertEqual(self.blockers(registered_forms={('mix-record', 'f' * 64)}), {'form-unavailable'})
        self.assertEqual(self.blockers(registered_forms=set()), {'form-unavailable'})
        self.assertEqual(self.blockers(registered_forms={('other-form', next(iter(FORMS))[1])}), {'form-unavailable'})

    def test_a_different_evaluator_blocks_because_a_guard_could_mean_something_else(self):
        self.assertTrue(self.received.needs_evaluator)
        self.assertEqual(self.blockers(evaluator_commit='0' * 40), {'evaluator-mismatch'})
        self.assertEqual(self.blockers(evaluator_commit=None), {'evaluator-mismatch'})

    def test_a_plan_without_guards_or_judges_does_not_need_the_evaluator(self):
        plan = load('valid.json')
        for node in plan['nodes']:
            node.pop('guard', None)
            if node['category'] == 'judge':
                node['category'] = 'transform'
        received = receive_plan(resealed(plan))
        self.assertFalse(received.needs_evaluator)
        self.assertEqual(work_order_blockers(received, active_kits=KITS, registered_forms=FORMS, evaluator_commit=None), [])


if __name__ == '__main__':
    unittest.main()
