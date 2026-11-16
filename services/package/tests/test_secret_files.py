"""The optional subscription key uses the same loader as the required webhook secret."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('secret_files', Path(__file__).resolve().parents[1] / 'templates/secret_files.py')
secret_files = importlib.util.module_from_spec(spec)
spec.loader.exec_module(secret_files)


class ModSecretTests(unittest.TestCase):
    def test_omitted_key_does_not_require_a_file(self):
        env = {}
        secret_files.load_secret_files(env)
        self.assertEqual(env, {})

    def test_key_and_webhook_are_loaded_from_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secret'
            path.write_text('synthetic-mod-secret', encoding='utf-8')
            env = {name + '_FILE': str(path) for name in ('MOD_API_KEY', 'MOD_WEBHOOK_SECRET')}
            secret_files.load_secret_files(env)
            for name in ('MOD_API_KEY', 'MOD_WEBHOOK_SECRET'):
                self.assertEqual(env[name], 'synthetic-mod-secret')

    def test_bad_file_or_ambiguous_input_is_rejected_without_echoing_the_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'secret'
            for value in ('', ' \n', 'synthetic-mod-secret'):
                path.write_text(value, encoding='utf-8')
                env = {'MOD_API_KEY_FILE': str(path)}
                if value.strip():
                    env['MOD_API_KEY'] = value
                with self.assertRaises(RuntimeError) as caught:
                    secret_files.load_secret_files(env)
                self.assertNotIn('synthetic-mod-secret', str(caught.exception))
            with self.assertRaises(RuntimeError):
                secret_files.load_secret_files({'MOD_API_KEY_FILE': str(path / 'missing')})


if __name__ == '__main__':
    unittest.main()
