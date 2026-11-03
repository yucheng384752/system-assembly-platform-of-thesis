"""The form registry core: what an upload must prove, and that Python hashes a form exactly as Composer does."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixtures import EVALUATOR, FORM_UPLOAD, KITS, NOW, load, register_forms
from factory_core.canonical import content_sha256, parse_json
from factory_core.forms import plan_forms, receive_form
from factory_core.plan import PlanRejected
from factory_core.store import MemoryStore
from factory_core.workorder import FactoryState

UPLOAD = parse_json(FORM_UPLOAD)


def codes(call):
    try:
        call()
    except PlanRejected as error:
        return {e['code'] for e in error.errors}
    return set()


class FormReceiveTests(unittest.TestCase):
    def receive(self, body):
        return receive_form(body, uploaded_by='eng', uploaded_at=NOW)

    def test_the_fixture_hash_is_what_the_factory_computes_and_the_plan_names_it(self):
        # forms.json is also recomputed in TypeScript (libs/aov-integration/executablePlan.test.ts): two implementations, one hash.
        record = self.receive(FORM_UPLOAD)
        self.assertEqual(record.content_sha256, UPLOAD['contentSha256'])
        self.assertEqual(content_sha256(UPLOAD['definition']), UPLOAD['contentSha256'])
        self.assertEqual(plan_forms(load('valid.json')), {('mix-record', UPLOAD['contentSha256'])})

    def test_key_order_and_whitespace_do_not_change_the_hash_but_content_does(self):
        reordered = json.dumps({'definition': dict(reversed(UPLOAD['definition'].items())), 'contentSha256': UPLOAD['contentSha256']}, indent=7)
        self.assertEqual(self.receive(reordered).content_sha256, UPLOAD['contentSha256'])
        edited = copy.deepcopy(UPLOAD)
        edited['definition']['fields']['mix_minutes']['default'] = 13
        self.assertEqual(codes(lambda: self.receive(edited)), {'form-hash-mismatch'})

    def test_a_form_must_prove_its_own_hash_so_a_wrong_claim_is_never_filed_under_it(self):
        wrong = {**UPLOAD, 'contentSha256': '0' * 64}
        self.assertEqual(codes(lambda: self.receive(wrong)), {'form-hash-mismatch'})

    def test_shape_errors_are_located_and_reported_together(self):
        bad = copy.deepcopy(UPLOAD)
        bad['definition'].update(id='', subject='x', extends=3)
        bad['definition']['fields'] = {'a': {'type': 'integer'}, 'b': 'not an object'}
        with self.assertRaises(PlanRejected) as caught:
            self.receive(bad)
        paths = {e['path'] for e in caught.exception.errors}
        self.assertEqual(paths, {'/definition/id', '/definition/subject', '/definition/extends', '/definition/fields/a/type', '/definition/fields/b'})

    def test_only_contentsha256_and_definition_are_accepted(self):
        for body in ({**UPLOAD, 'formId': 'x'}, {'definition': UPLOAD['definition']}, [], 'not json', '{"a":'):
            with self.subTest(str(body)[:40]):
                self.assertEqual(codes(lambda: self.receive(body)), {'broken-structure'})

    def test_a_value_with_no_single_canonical_form_is_refused(self):
        too_big = copy.deepcopy(UPLOAD)
        too_big['definition']['fields']['mix_minutes']['default'] = 2 ** 60
        self.assertEqual(codes(lambda: self.receive(too_big)), {'not-canonical'})

    def test_every_attr_type_of_the_model_is_accepted(self):
        for kind in ('number', 'string', 'bool', 'datetime', 'enum', 'quantity', 'string[]', 'json'):
            body = copy.deepcopy(UPLOAD)
            body['definition']['fields'] = {'f': {'type': kind}}
            body['contentSha256'] = content_sha256(body['definition'])
            self.assertEqual(self.receive(body).form_id, 'mix-record', kind)


class FormRegistryTests(unittest.TestCase):
    def test_a_registered_form_is_found_only_under_its_id_and_hash(self):
        state = FactoryState(MemoryStore())
        record = register_forms(state)
        store = state.store
        self.assertTrue(store.has_form('mix-record', record.content_sha256))
        self.assertFalse(store.has_form('other-form', record.content_sha256))
        self.assertFalse(store.has_form('mix-record', '0' * 64))

    def test_re_uploading_returns_the_first_record_and_changes_nothing(self):
        state = FactoryState(MemoryStore())
        first = register_forms(state, by='mia')
        second = state.store_form(FORM_UPLOAD, uploaded_by='later', now='2030-01-01T00:00:00Z')
        self.assertEqual((second, state.store.form_hashes()), (first, [first.content_sha256]))

    def test_a_refused_upload_stores_nothing(self):
        state = FactoryState(MemoryStore())
        with self.assertRaises(PlanRejected):
            state.store_form({**UPLOAD, 'contentSha256': '1' * 64}, uploaded_by='eng', now=NOW)
        self.assertEqual(state.store.form_hashes(), [])

    def test_no_order_without_the_form_and_one_with_it(self):
        state = FactoryState(MemoryStore())
        plan_id = state.store_plan(load('valid.json')).plan_id

        def make():
            return state.create_order('wo-1', plan_id, created_by='a', now=NOW, active_kits=KITS, evaluator_commit=EVALUATOR)
        self.assertEqual(codes(make), {'form-unavailable'})
        self.assertIsNone(state.store.get_order('wo-1'))  # a refusal leaves no order behind
        register_forms(state)
        self.assertEqual(make().order_id, 'wo-1')


if __name__ == '__main__':
    unittest.main()
