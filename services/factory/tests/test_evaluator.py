"""The evaluator client: parity with the TypeScript evaluator through the real bundle, and every way the child can fail.

Failures use small Python stand-ins so they happen on purpose and need no node. Parity needs node (see evaluator_support).
"""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from evaluator_support import NODE, ROOT, fake, real_command
from fixtures import EVALUATOR, KITS, NOW, load, register_forms
from factory_core.evaluator import Evaluator, EvaluatorError, EvaluatorRefused
from factory_core.plan import PlanRejected
from factory_core.store import MemoryStore
from factory_core.workorder import FactoryState

VECTORS = json.loads((ROOT / 'fixtures/evaluator/vectors.json').read_text(encoding='utf-8'))
CLOCK = '2026-10-29T00:00:00Z'

CHILD = """
import json, os, sys, time
state, mode, hello = {state!r}, {mode!r}, {hello!r}
for raw in sys.stdin:
    request = json.loads(raw)
    if request['op'] == 'hello':
        if hello == 'silent':
            time.sleep(60)
        if hello == 'exit':
            sys.exit(3)
        protocol = 2 if hello == 'protocol' else 1
        print(json.dumps({{'id': request['id'], 'ok': True, 'commit': 'abc123', 'protocol': protocol}}), flush=True)
        continue
    first = not os.path.exists(state)
    open(state, 'a').close()
    if mode == 'die' or (mode == 'die-once' and first):
        sys.exit(1)
    if mode == 'hang' or (mode == 'hang-once' and first):
        time.sleep(60)
    if mode == 'garbage':
        print('this is not json', flush=True)
    elif mode == 'wrong-id':
        print(json.dumps({{'id': request['id'] + 100, 'ok': True, 'status': 'true'}}), flush=True)
    elif mode == 'no-ok':
        print(json.dumps({{'id': request['id'], 'status': 'true'}}), flush=True)
    elif mode == 'refuse':
        print(json.dumps({{'id': request['id'], 'ok': False, 'error': {{'code': 'bad-value', 'message': 'nope'}}}}), flush=True)
    else:
        print(json.dumps({{'id': request['id'], 'ok': True, 'status': 'true'}}), flush=True)
"""


class FailureTests(unittest.TestCase):
    def evaluator(self, mode='ok', hello='ok', timeout=1.5, startup=1.5):
        directory = tempfile.mkdtemp(prefix='fake-evaluator-')
        self.addCleanup(lambda: [p.unlink() for p in Path(directory).glob('*')] and Path(directory).rmdir())
        ev = Evaluator(fake(CHILD.format(state=str(Path(directory, 'state')), mode=mode, hello=hello)), timeout=timeout, startup_timeout=startup)
        self.addCleanup(ev.close)
        return ev

    def ask(self, ev):
        return ev.evaluate_guard('true', now=CLOCK)

    def test_a_working_child_answers_and_reports_its_commit(self):
        ev = self.evaluator()
        self.assertEqual(ev.commit(), 'abc123')
        self.assertEqual(self.ask(ev).status, 'true')

    def test_no_command_means_no_answer_never_true(self):
        ev = Evaluator(['/no/such/evaluator-binary'])
        with self.assertRaises(EvaluatorError):
            ev.commit()
        with self.assertRaises(EvaluatorError):
            self.ask(ev)

    def test_a_child_that_dies_mid_request_is_restarted_once_and_the_request_repeated(self):
        ev = self.evaluator('die-once')
        self.assertEqual(self.ask(ev).status, 'true')

    def test_a_child_that_keeps_dying_is_an_error(self):
        with self.assertRaises(EvaluatorError):
            self.ask(self.evaluator('die'))

    def test_a_timeout_kills_the_child_and_the_next_call_starts_a_fresh_one(self):
        ev = self.evaluator('hang-once', timeout=1.0)
        ev.commit()
        hung = ev._child
        with self.assertRaisesRegex(EvaluatorError, 'did not answer'):
            self.ask(ev)
        self.assertIsNotNone(hung.process.poll(), 'a child that timed out must not be left running')
        self.assertEqual(self.ask(ev).status, 'true')
        self.assertIsNot(ev._child, hung)

    def test_garbage_and_out_of_protocol_answers_are_errors_and_the_child_is_not_trusted_again(self):
        for mode in ('garbage', 'wrong-id', 'no-ok'):
            with self.subTest(mode):
                ev = self.evaluator(mode)
                with self.assertRaises(EvaluatorError):
                    self.ask(ev)
                self.assertIsNone(ev._child)

    def test_a_refusal_is_reported_with_its_code_and_does_not_restart_the_child(self):
        ev = self.evaluator('refuse')
        ev.commit()
        child = ev._child
        with self.assertRaises(EvaluatorRefused) as caught:
            self.ask(ev)
        self.assertEqual(caught.exception.code, 'bad-value')
        self.assertIs(ev._child, child)

    def test_a_bad_hello_means_the_evaluator_is_unusable(self):
        for hello in ('protocol', 'exit', 'silent'):
            with self.subTest(hello):
                with self.assertRaises(EvaluatorError):
                    self.evaluator(hello=hello, startup=1.0).commit()

    def test_a_request_that_is_not_json_or_too_large_never_reaches_the_child(self):
        ev = self.evaluator()
        with self.assertRaises(EvaluatorRefused) as caught:
            ev.evaluate_guard('true', now=CLOCK, params={'x': float('nan')})
        self.assertEqual(caught.exception.code, 'bad-request')
        with self.assertRaises(EvaluatorRefused) as caught:
            ev.evaluate_guard('true', now=CLOCK, params={'x': 'y' * (4 * 1024 * 1024)})
        self.assertEqual(caught.exception.code, 'too-large')
        self.assertEqual(self.ask(ev).status, 'true')  # and the child is still usable

    def test_close_stops_the_child_and_a_later_call_starts_again(self):
        ev = self.evaluator()
        ev.commit()
        child = ev._child
        ev.close()
        self.assertIsNotNone(child.process.poll())
        self.assertEqual(self.ask(ev).status, 'true')


@unittest.skipUnless(NODE, 'node is not available: the real evaluator was not exercised')
class RealEvaluatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ev = Evaluator(real_command())
        cls.addClassCleanup(cls.ev.close)

    def test_it_reports_the_commit_the_plans_are_built_with(self):
        self.assertEqual(self.ev.commit(), VECTORS['aovCommit'])
        self.assertEqual(self.ev.commit(), EVALUATOR)  # the contract fixture was built with this same core

    def test_every_shared_vector_gets_the_same_answer_as_in_typescript(self):
        for vector in VECTORS['vectors']:
            with self.subTest(vector['name']):
                request = {k: v for k, v in vector['request'].items() if k != 'id'}
                expected = vector['response']
                if expected['ok']:
                    answer = self.ev._call(request)
                    self.assertEqual({k: v for k, v in answer.items() if k not in ('id', 'ok')}, {k: v for k, v in expected.items() if k not in ('id', 'ok')})
                else:
                    with self.assertRaises(EvaluatorRefused) as caught:
                        self.ev._call(request)
                    self.assertEqual(caught.exception.code, expected['error']['code'])

    def test_the_contract_fixtures_own_guard_is_evaluated_with_the_plans_artifact_types_and_effective_parameters(self):
        plan = load('valid.json')
        node = next(n for n in plan['nodes'] if n.get('guard'))
        params = {p['id']: p['default'] for p in plan['params'] if 'default' in p}
        dough = lambda t: {'in': {'in': {'$artifact': {'id': 'A1', 'type': 'lot.dough', 'version': 1, 'attrs': {'temperature_c': t}, 'createdAt': 0}}}}
        cold = self.ev.evaluate_guards(node['guard'], now=CLOCK, params=params, vars=dough(12), artifact_types=plan['artifactTypes'], rules=plan['rules'])
        warm = self.ev.evaluate_guards(node['guard'], now=CLOCK, params=params, vars=dough(18), artifact_types=plan['artifactTypes'], rules=plan['rules'])
        self.assertEqual([(label, r.status) for label, r in cold], [('temperature in range', 'false')])
        self.assertIn('12 >= 15', cold[0][1].message)
        self.assertEqual([(label, r.status) for label, r in warm], [('temperature in range', 'true')])

    def test_units_are_converted_not_compared_as_bare_numbers(self):
        self.assertEqual(self.ev.evaluate_guard('params.w >= 1 kg', now=CLOCK, params={'w': {'value': 900, 'unit': 'g'}}).status, 'false')
        self.assertEqual(self.ev.evaluate_guard('params.w >= 1 kg', now=CLOCK, params={'w': {'value': 1100, 'unit': 'g'}}).status, 'true')

    def test_a_value_expression_returns_a_typed_value(self):
        self.assertEqual(self.ev.evaluate_value('params.a + 500 g', now=CLOCK, params={'a': {'value': 1, 'unit': 'kg'}})['value'], {'$qty': {'value': 1.5, 'unit': 'kg'}})
        self.assertIn('error', self.ev.evaluate_value('params.a + 1 degC', now=CLOCK, params={'a': {'value': 1, 'unit': 'degC'}}))

    def test_an_expression_that_cannot_be_evaluated_is_an_error_status_not_false(self):
        self.assertEqual(self.ev.evaluate_guard('nothing_here > 1', now=CLOCK).status, 'error')


@unittest.skipUnless(NODE, 'node is not available: the real evaluator was not exercised')
class OrderWithGuardsTests(unittest.TestCase):
    """The reason the sidecar exists: a plan with a guard can start work orders once the deployed evaluator matches its commit."""

    def order(self, commit):
        state = FactoryState(MemoryStore())
        plan_id = state.store_plan(load('valid.json')).plan_id
        register_forms(state)
        return state.create_order('wo-1', plan_id, created_by='a', now=NOW, active_kits=KITS, evaluator_commit=commit)

    def test_the_commit_reported_by_the_real_evaluator_lets_the_order_through(self):
        ev = Evaluator(real_command())
        self.addCleanup(ev.close)
        self.assertEqual(self.order(ev.commit()).order_id, 'wo-1')

    def test_an_evaluator_that_is_missing_or_from_another_core_blocks_it(self):
        for commit in (None, '0' * 40):
            with self.subTest(commit):
                with self.assertRaises(PlanRejected) as caught:
                    self.order(commit)
                self.assertEqual({e['code'] for e in caught.exception.errors}, {'evaluator-mismatch'})


if __name__ == '__main__':
    unittest.main()
