"""Cross-language canonical JSON: Python must reproduce the vectors the TypeScript side is tested with."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from factory_core.canonical import CanonicalError, canonical_json, content_sha256, parse_json

ROOT = Path(__file__).resolve().parents[3]
VECTORS = parse_json((ROOT / 'fixtures/executable-plan/canonical-vectors.json').read_text(encoding='utf-8'))['vectors']


class CanonicalTests(unittest.TestCase):
    def test_every_shared_vector(self):
        for vector in VECTORS:
            with self.subTest(vector['name']):
                self.assertEqual(canonical_json(vector['input']), vector['canonical'])
                self.assertEqual(content_sha256(vector['input']), vector['sha256'])

    def test_python_default_sort_would_get_the_astral_key_wrong(self):
        value = {'\U0001F600': 2, '￿': 1}
        self.assertEqual(canonical_json(value), '{"\U0001F600":2,"￿":1}')
        self.assertEqual(sorted(value), ['￿', '\U0001F600'])  # code point order differs, which is why the key function exists

    def test_integral_floats_and_negative_zero(self):
        self.assertEqual(canonical_json([12.0, -0.0, 1e21, 1e-7, 0.000001, 100.5]), '[12,0,1e+21,1e-7,0.000001,100.5]')

    def test_values_without_a_single_form_are_rejected(self):
        for bad in (float('nan'), float('inf'), 2 ** 60, '\ud800', {1: 'x'}, {'a': {1, 2}}, b'x'):
            with self.subTest(repr(bad)):
                with self.assertRaises(CanonicalError):
                    canonical_json(bad)

    def test_integers_beyond_2_53_read_as_doubles_like_javascript(self):
        self.assertEqual(canonical_json(parse_json('{"n":123456789012345678901}')), '{"n":123456789012345680000}')
        self.assertEqual(canonical_json(parse_json('{"n":9007199254740993}')), '{"n":9007199254740992}')

    def test_bool_is_not_a_number(self):
        self.assertEqual(canonical_json({'a': True, 'b': 1}), '{"a":true,"b":1}')


if __name__ == '__main__':
    unittest.main()
