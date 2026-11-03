"""Licenses signed by the Node tools must verify in the backend module, and tampering must be named.

The backend (kits/platform-core-kit license.py, cryptography) and the installer (OpenSSL) are two
independent implementations of the same chain; this keeps them from drifting apart.
"""
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from common import read_json
from test_engine import fixture

ROOT = Path(os.environ.get('INSTALLER_REPO', str(Path(__file__).resolve().parents[3])))
NOW = datetime(2026, 10, 28, 10, tzinfo=timezone.utc)
BACKEND = None
try:
    import cryptography  # noqa: F401
    spec = importlib.util.spec_from_file_location('backend_license', ROOT / 'kits/platform-core-kit/src/backend/app/core/license.py')
    BACKEND = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = BACKEND
    spec.loader.exec_module(BACKEND)
except ImportError:
    pass


@unittest.skipUnless(BACKEND and shutil.which('node'), 'cryptography and Node required; 由 Claude 執行')
class BackendLicenseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='composer-backend-license-')
        cls.addClassCleanup(cls.tmp.cleanup)
        base = Path(cls.tmp.name)
        root, _, source = fixture(base)
        cls.keys = base / 'keys'
        result = subprocess.run(['node', str(ROOT / 'services/installer/tests/make-fixtures.mjs'), source['archive'],
                                 str(root / 'system-manifest.json'), str(cls.keys)], capture_output=True)
        if result.returncode:
            raise RuntimeError('Node fixture generation failed: ' + result.stderr.decode(errors='replace'))
        cls.data = read_json(cls.keys / 'licenses.json')
        cls.pem = (cls.keys / 'root.pem').read_text()

    def check(self, name, pem=None, manifest=None):
        return BACKEND.verify_license_text(json.dumps(self.data['cases'][name]), pem or self.pem,
                                           manifest or self.data['manifestSha256'], NOW)

    def test_node_signed_license_is_accepted_even_after_its_certificate_expired(self):
        result = self.check('valid')
        self.assertTrue(result.valid, result.reason)
        self.assertEqual(result.licensee, 'fixture-client')
        later = BACKEND.verify_license_text(json.dumps(self.data['cases']['valid']), self.pem, self.data['manifestSha256'],
                                            datetime(2027, 1, 1, tzinfo=timezone.utc))
        self.assertTrue(later.valid)

    def test_each_tampering_is_rejected_with_its_own_code(self):
        expected = {'certificateTampered': 'certificate', 'issuerMismatch': 'certificate', 'keyMismatch': 'certificate',
                    'licenseTampered': 'signature', 'issuedOutside': 'issued-outside-certificate',
                    'licenseeMismatch': 'licensee-mismatch', 'expired': 'expired', 'duplicateNames': 'malformed',
                    'extraField': 'malformed'}
        for name, code in expected.items():
            with self.subTest(name):
                self.assertEqual(self.check(name).code, code)
        self.assertEqual(self.check('manifestMismatch').code, 'manifest-mismatch')

    def test_wrong_root_key_is_rejected(self):
        self.assertEqual(self.check('valid', pem=(self.keys / 'other-root.pem').read_text()).code, 'certificate')

    def test_hardware_match_agrees_with_the_installer(self):
        result = self.check('valid')
        hashes = [s['sha256'] for s in self.data['sources']]
        self.assertEqual(BACKEND.fingerprint_matches(result, hashes[:2]), (True, 2))
        self.assertEqual(BACKEND.fingerprint_matches(result, hashes[:1]), (False, 1))
        duplicate = self.check('duplicateHashes')
        self.assertTrue(duplicate.valid)  # the chain is fine, but all three sources carry one hash
        # Repeating a hash in the license must never let one matching hardware value count as two.
        self.assertEqual(BACKEND.fingerprint_matches(duplicate, hashes), (False, 1))


if __name__ == '__main__':
    unittest.main()
