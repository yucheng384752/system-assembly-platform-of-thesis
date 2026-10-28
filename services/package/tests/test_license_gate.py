"""License gate and secret-file loader of the generated backend (D138, D142).

These run the real template modules and the real kit license module under Starlette's test client;
the generated system itself is exercised by the Docker end-to-end run. Needs starlette, httpx,
python-multipart and cryptography (the pinned runtime packages), so it runs in a venv, not with Node.
"""
import base64
import functools
import hashlib
import importlib
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

REPO = Path(__file__).resolve().parents[3]
TEMPLATES = REPO / 'services/package/templates'
KIT_LICENSE = REPO / 'kits/platform-core-kit/src/backend/app/core/license.py'
NOW = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
MANIFEST = b'{"systemId":"demo"}'
HARDWARE = [('product_uuid', '1' * 64), ('board_serial', '2' * 64), ('mac:eth0', '3' * 64)]

# Build the same package layout the generated backend has: app/core/license.py, app/license_gate.py, app/secret_files.py.
LAYOUT = Path(tempfile.mkdtemp(prefix='composer-gate-layout-'))
(LAYOUT / 'app/core').mkdir(parents=True)
(LAYOUT / 'app/__init__.py').write_text('')
(LAYOUT / 'app/core/__init__.py').write_text('')
shutil.copyfile(KIT_LICENSE, LAYOUT / 'app/core/license.py')
for name in ('license_gate.py', 'secret_files.py'):
    shutil.copyfile(TEMPLATES / name, LAYOUT / 'app' / name)
sys.path.insert(0, str(LAYOUT))
gate_module = importlib.import_module('app.license_gate')
secret_files = importlib.import_module('app.secret_files')


def pem(key):
    return key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()


def key_id(key):
    return hashlib.sha256(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)).hexdigest()


def sign(payload, key):
    text = json.dumps(payload, separators=(',', ':'))
    signature = key.sign(text.encode(), padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32), hashes.SHA256())
    return {'payload': text, 'signature': base64.b64encode(signature).decode(), 'algorithm': 'RSA-PSS-SHA256'}


def stamp(moment):
    return moment.strftime('%Y-%m-%dT%H:%M:%SZ')


class Keys:
    root = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    sub = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_license(manifest=MANIFEST, root=None, expires=None):
    certificate = sign({'schemaVersion': '1.0', 'keyId': key_id(Keys.sub), 'issuerKeyId': key_id(Keys.root),
                        'subjectPublicKey': pem(Keys.sub), 'licensee': {'name': 'demo-client'},
                        'notBefore': stamp(NOW - timedelta(hours=1)), 'notAfter': stamp(NOW + timedelta(hours=23))}, root or Keys.root)
    payload = {'schemaVersion': '3.0', 'issuedAt': stamp(NOW), 'expiresAt': stamp(expires or NOW + timedelta(days=30)),
               'licensee': {'name': 'demo-client'}, 'systemId': 'demo', 'recipe': 'demo', 'enabledKits': ['a'],
               'fingerprint': {'minMatch': 2, 'sources': [{'source': s, 'sha256': h} for s, h in HARDWARE]},
               'packageManifestSha256': hashlib.sha256(manifest).hexdigest()}
    return json.dumps({**sign(payload, Keys.sub), 'issuerCertificate': certificate})


class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        (base / 'license').mkdir()
        self.license = base / 'license/license.lic'
        (base / 'root.pem').write_text(pem(Keys.root))
        (base / 'manifest.json').write_bytes(MANIFEST)
        self.environ = {'LICENSE_FILE': str(self.license), 'LICENSE_ROOT_KEY_FILE': str(base / 'root.pem'),
                        'SYSTEM_MANIFEST_FILE': str(base / 'manifest.json')}
        self.clock = [0.0]
        self.now = [NOW]
        self.gate = gate_module.LicenseGate(self.environ, clock=lambda: self.clock[0], now=lambda: self.now[0])
        self.reached = []

        async def data(request):
            self.reached.append(request.url.path)
            return JSONResponse({'ok': True})
        app = Starlette(routes=[Route('/healthz', data), Route('/api/data', data), Route('/api/license/upload', data, methods=['POST']),
                                Route('/license', data)])
        app.add_middleware(BaseHTTPMiddleware, dispatch=functools.partial(gate_module.license_gate_middleware, gate=self.gate))
        self.client = TestClient(app, follow_redirects=False)

    def install(self, text=None):
        self.license.write_text(text or make_license())

    def test_nothing_is_served_without_a_license_except_health_and_the_status_routes(self):
        blocked = self.client.get('/api/data')
        self.assertEqual(blocked.status_code, 503)
        self.assertEqual(blocked.json()['code'], 'license-missing')
        self.assertEqual(blocked.json()['statusPage'], '/license')
        self.assertEqual(self.client.get('/healthz').status_code, 200)
        self.assertEqual(self.reached, ['/healthz'])  # the license routes never reach the application
        page = self.client.get('/license')
        self.assertEqual(page.status_code, 200)
        self.assertIn('找不到授權檔', page.text)
        status = self.client.get('/api/license/status').json()
        self.assertEqual((status['valid'], status['code'], status['hardwareCheck']), (False, 'license-missing', 'not-provided'))

    def test_a_valid_license_opens_the_system_and_the_page_states_hardware_is_not_checked(self):
        self.install()
        self.assertEqual(self.client.get('/api/data').status_code, 200)
        self.assertEqual(self.client.get('/license').text.count('尚未啟用'), 1)
        status = self.client.get('/api/license/status').json()
        self.assertEqual((status['valid'], status['licensee']), (True, 'demo-client'))

    def test_a_license_for_another_package_blocks_the_system(self):
        self.install(make_license(manifest=b'{"systemId":"other"}'))
        blocked = self.client.get('/api/data')
        self.assertEqual((blocked.status_code, blocked.json().get('code')), (503, 'manifest-mismatch'))

    def test_license_expiring_while_the_system_runs_is_noticed(self):
        self.install(make_license(expires=NOW + timedelta(days=1)))
        self.assertEqual(self.client.get('/api/data').status_code, 200)
        self.now[0] = NOW + timedelta(days=2)
        self.clock[0] += gate_module.RECHECK_SECONDS + 1
        blocked = self.client.get('/api/data')
        self.assertEqual((blocked.status_code, blocked.json().get('code')), (503, 'expired'))

    def test_replacing_the_license_file_takes_effect_without_waiting(self):
        self.install()
        self.assertEqual(self.client.get('/api/data').status_code, 200)
        self.install(make_license(manifest=b'{"systemId":"other"}'))
        self.assertEqual(self.client.get('/api/data').status_code, 503)

    def test_upload_installs_only_licenses_that_pass_the_full_check(self):
        for bad, code in ((make_license(root=Keys.other), 'certificate'), (make_license(manifest=b'x'), 'manifest-mismatch'),
                          ('not json', 'malformed'), (make_license(expires=NOW - timedelta(days=1)), 'expired')):
            response = self.client.post('/api/license/upload', content=bad, headers={'content-type': 'application/json'})
            self.assertEqual((response.status_code, response.json()['code']), (400, code))
            self.assertFalse(self.license.exists(), 'a rejected license must not be written')
        good = self.client.post('/api/license/upload', content=make_license(), headers={'content-type': 'application/json'})
        self.assertEqual((good.status_code, good.json()['code']), (200, 'ok'))
        self.assertTrue(self.license.exists())
        self.assertEqual(self.client.get('/api/data').status_code, 200)
        self.assertEqual([p for p in self.license.parent.iterdir() if p.name != 'license.lic'], [], 'no temporary files may remain')

    def test_a_rejected_upload_keeps_the_working_license(self):
        self.install()
        before = self.license.read_text()
        self.client.post('/api/license/upload', content=make_license(root=Keys.other), headers={'content-type': 'application/json'})
        self.assertEqual(self.license.read_text(), before)
        self.assertEqual(self.client.get('/api/data').status_code, 200)

    def test_browser_form_upload_redirects_to_the_status_page_with_the_outcome(self):
        bad = self.client.post('/api/license/upload', files={'license': ('license.lic', b'junk')})
        self.assertEqual((bad.status_code, bad.headers['location']), (303, '/license?result=malformed'))
        good = self.client.post('/api/license/upload', files={'license': ('license.lic', make_license().encode())})
        self.assertEqual((good.status_code, good.headers['location']), (303, '/license?result=ok'))
        self.assertIn('授權有效', self.client.get('/license?result=ok').text)

    def test_oversized_uploads_and_upload_floods_are_refused(self):
        big = self.client.post('/api/license/upload', content=b'x' * (gate_module.MAX_UPLOAD + 5000), headers={'content-type': 'application/json'})
        self.assertEqual((big.status_code, big.json()['code']), (400, 'too-large'))
        self.gate.attempts.clear()
        codes = [self.client.post('/api/license/upload', content='x', headers={'content-type': 'application/json'}).status_code for _ in range(12)]
        self.assertEqual(codes[:gate_module.ATTEMPTS], [400] * gate_module.ATTEMPTS)
        self.assertEqual(codes[gate_module.ATTEMPTS:], [429, 429])
        self.clock[0] += gate_module.WINDOW + 1
        self.assertEqual(self.client.post('/api/license/upload', content='x', headers={'content-type': 'application/json'}).status_code, 400)

    def test_the_page_never_reflects_query_text(self):
        page = self.client.get('/license?result=<script>alert(1)</script>')
        self.assertNotIn('<script>alert', page.text)
        self.assertEqual(page.headers['content-security-policy'].split(';')[0], "default-src 'none'")


class SecretFileTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def secret(self, text):
        self.count = getattr(self, 'count', 0) + 1
        path = Path(self.tmp.name) / f'secret{self.count}'
        path.write_bytes(text.encode('utf-8'))  # bytes: keep newlines exactly as written on every platform
        return str(path)

    def test_values_are_read_from_files_and_only_one_trailing_newline_is_removed(self):
        env = {'SECRET_KEY_FILE': self.secret('abc def\n\n'), 'DATABASE_URL_FILE': self.secret('postgresql+asyncpg://u:p%40@postgres:5432/db')}
        secret_files.load_secret_files(env)
        self.assertEqual(env['SECRET_KEY'], 'abc def\n')
        self.assertEqual(env['DATABASE_URL'], 'postgresql+asyncpg://u:p%40@postgres:5432/db')

    def test_ambiguous_missing_or_empty_sources_fail_loudly_without_echoing_values(self):
        for env in ({'SECRET_KEY': 'plain', 'SECRET_KEY_FILE': self.secret('x')},
                    {'SECRET_KEY_FILE': str(Path(self.tmp.name) / 'absent')}, {'SECRET_KEY_FILE': self.secret(' \n')}):
            with self.assertRaises(RuntimeError) as caught:
                secret_files.load_secret_files(env)
            self.assertNotIn('plain', str(caught.exception))

    def test_unrelated_file_variables_are_left_alone(self):
        env = {'LICENSE_FILE': '/system/license/license.lic'}
        secret_files.load_secret_files(env)
        self.assertEqual(env, {'LICENSE_FILE': '/system/license/license.lic'})


if __name__ == '__main__':
    unittest.main()
