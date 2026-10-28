"""License gate, hardware policy and secret-file loader of the generated backend (D138, D142, D143).

These run the real template modules and the real kit license module under Starlette's test client;
the generated system itself is exercised by the Docker end-to-end run. Needs starlette, httpx,
python-multipart and cryptography (the pinned runtime packages), so it runs in a venv, not with Node.
"""
import base64
import functools
import hashlib
import importlib
import json
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
# A Wednesday, 12:00 UTC: inside the default block window when the site time zone is UTC.
NOW = datetime(2026, 10, 28, 12, tzinfo=timezone.utc)
MANIFEST = b'{"systemId":"demo"}'
HARDWARE = [('product_uuid', '1' * 64), ('board_serial', '2' * 64), ('mac:eth0', '3' * 64)]

# Build the same package layout the generated backend has: app/core/license.py and the template modules.
LAYOUT = Path(tempfile.mkdtemp(prefix='composer-gate-layout-'))
(LAYOUT / 'app/core').mkdir(parents=True)
(LAYOUT / 'app/__init__.py').write_text('')
(LAYOUT / 'app/core/__init__.py').write_text('')
shutil.copyfile(KIT_LICENSE, LAYOUT / 'app/core/license.py')
for name in ('license_gate.py', 'license_hardware.py', 'secret_files.py'):
    shutil.copyfile(TEMPLATES / name, LAYOUT / 'app' / name)
sys.path.insert(0, str(LAYOUT))
gate_module = importlib.import_module('app.license_gate')
hw = importlib.import_module('app.license_hardware')
secret_files = importlib.import_module('app.secret_files')
lic = importlib.import_module('app.core.license')


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


def make_license(manifest=MANIFEST, root=None, expires=None, hardware=HARDWARE):
    certificate = sign({'schemaVersion': '1.0', 'keyId': key_id(Keys.sub), 'issuerKeyId': key_id(Keys.root),
                        'subjectPublicKey': pem(Keys.sub), 'licensee': {'name': 'demo-client'},
                        'notBefore': stamp(NOW - timedelta(hours=1)), 'notAfter': stamp(NOW + timedelta(hours=23))}, root or Keys.root)
    payload = {'schemaVersion': '3.0', 'issuedAt': stamp(NOW), 'expiresAt': stamp(expires or NOW + timedelta(days=30)),
               'licensee': {'name': 'demo-client'}, 'systemId': 'demo', 'recipe': 'demo', 'enabledKits': ['a'],
               'fingerprint': {'minMatch': 2, 'sources': [{'source': s, 'sha256': h} for s, h in hardware]},
               'packageManifestSha256': hashlib.sha256(manifest).hexdigest()}
    return json.dumps({**sign(payload, Keys.sub), 'issuerCertificate': certificate})


def guard_report(sources, at=NOW):
    return json.dumps({'schemaVersion': '1.0', 'generatedAt': stamp(at), 'startedAt': stamp(at - timedelta(hours=1)),
                       'sources': [{'source': s, 'sha256': h} for s, h in sources]})


class GateBase(unittest.TestCase):
    timezone = 'UTC'

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        (base / 'license').mkdir()
        (base / 'data').mkdir()
        self.license = base / 'license/license.lic'
        self.guard = base / 'result.json'
        self.state = base / 'data/license-state.json'
        (base / 'root.pem').write_text(pem(Keys.root))
        (base / 'manifest.json').write_bytes(MANIFEST)
        self.environ = {'LICENSE_FILE': str(self.license), 'LICENSE_ROOT_KEY_FILE': str(base / 'root.pem'),
                        'SYSTEM_MANIFEST_FILE': str(base / 'manifest.json'), 'GUARD_RESULT_FILE': str(self.guard),
                        'LICENSE_STATE_FILE': str(self.state), 'LICENSE_TIMEZONE': self.timezone}
        self.clock = [0.0]
        self.now = [NOW]
        self.build()

    def build(self):
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

    def report(self, sources=HARDWARE, at=None):
        self.guard.write_text(guard_report(sources, at or self.now[0]))

    def advance(self, **delta):
        self.now[0] += timedelta(**delta)
        self.clock[0] += timedelta(**delta).total_seconds() + 1  # past every cache interval

    def status(self):
        return self.client.get('/api/license/status').json()

    def api(self):
        return self.client.get('/api/data')


class GateTests(GateBase):
    def test_nothing_is_served_without_a_license_except_health_and_the_status_routes(self):
        blocked = self.api()
        self.assertEqual(blocked.status_code, 503)
        self.assertEqual(blocked.json().get('code'), 'license-missing')
        self.assertEqual(blocked.json()['statusPage'], '/license')
        self.assertEqual(self.client.get('/healthz').status_code, 200)
        self.assertEqual(self.reached, ['/healthz'])  # the license routes never reach the application
        page = self.client.get('/license')
        self.assertEqual(page.status_code, 200)
        self.assertIn('找不到授權檔', page.text)
        status = self.status()
        self.assertEqual((status['valid'], status['code'], status['hardware']['status']), (False, 'license-missing', 'unchecked'))

    def test_a_valid_license_with_matching_hardware_opens_the_system(self):
        self.install()
        self.report()
        self.assertEqual(self.api().status_code, 200)
        status = self.status()
        self.assertEqual((status['valid'], status['licensee'], status['hardware']['status'], status['hardware']['matched']),
                         (True, 'demo-client', 'match', 3))
        self.assertNotIn('X-License-Warning', self.api().headers)

    def test_a_license_for_another_package_blocks_the_system(self):
        self.install(make_license(manifest=b'{"systemId":"other"}'))
        blocked = self.api()
        self.assertEqual((blocked.status_code, blocked.json().get('code')), (503, 'manifest-mismatch'))

    def test_license_expiring_while_the_system_runs_is_noticed(self):
        self.install(make_license(expires=NOW + timedelta(days=1)))
        self.report()
        self.assertEqual(self.api().status_code, 200)
        self.advance(days=2)
        self.report()
        blocked = self.api()
        self.assertEqual((blocked.status_code, blocked.json().get('code')), (503, 'expired'))

    def test_replacing_the_license_file_takes_effect_without_waiting(self):
        self.install()
        self.report()
        self.assertEqual(self.api().status_code, 200)
        self.install(make_license(manifest=b'{"systemId":"other"}'))
        self.assertEqual(self.api().status_code, 503)

    def test_upload_installs_only_licenses_that_pass_the_full_check(self):
        self.report()
        for bad, code in ((make_license(root=Keys.other), 'certificate'), (make_license(manifest=b'x'), 'manifest-mismatch'),
                          ('not json', 'malformed'), (make_license(expires=NOW - timedelta(days=1)), 'expired'),
                          (make_license(hardware=[('product_uuid', '7' * 64), ('board_serial', '8' * 64), ('mac:eth0', '9' * 64)]),
                           'hardware-mismatch')):
            response = self.client.post('/api/license/upload', content=bad, headers={'content-type': 'application/json'})
            self.assertEqual((response.status_code, response.json()['code']), (400, code))
            self.assertFalse(self.license.exists(), 'a rejected license must not be written')
        good = self.client.post('/api/license/upload', content=make_license(), headers={'content-type': 'application/json'})
        self.assertEqual((good.status_code, good.json()['code']), (200, 'ok'))
        self.assertEqual(self.api().status_code, 200)
        self.assertEqual([p for p in self.license.parent.iterdir() if p.name != 'license.lic'], [], 'no temporary files may remain')

    def test_upload_needs_a_recent_guard_report_to_know_which_hardware_this_is(self):
        response = self.client.post('/api/license/upload', content=make_license(), headers={'content-type': 'application/json'})
        self.assertEqual((response.status_code, response.json()['code']), (400, 'guard-unreachable'))
        self.report(at=NOW - timedelta(hours=25))
        response = self.client.post('/api/license/upload', content=make_license(), headers={'content-type': 'application/json'})
        self.assertEqual(response.json()['code'], 'guard-unreachable')
        self.assertFalse(self.license.exists())

    def test_a_rejected_upload_keeps_the_working_license(self):
        self.install()
        self.report()
        before = self.license.read_text()
        self.client.post('/api/license/upload', content=make_license(root=Keys.other), headers={'content-type': 'application/json'})
        self.assertEqual(self.license.read_text(), before)
        self.assertEqual(self.api().status_code, 200)

    def test_browser_form_upload_redirects_to_the_status_page_with_the_outcome(self):
        self.report()
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

    def test_rebind_request_carries_only_hashes_and_needs_a_guard_report(self):
        self.install()
        self.assertEqual(self.client.get('/api/license/rebind-request').status_code, 503)
        self.report([('product_uuid', 'a' * 64), ('mac:eth0', 'b' * 64)])
        response = self.client.get('/api/license/rebind-request')
        value = response.json()
        self.assertEqual((response.status_code, value['format'], value['systemId'], value['licensee']), (200, 'composer-rebind-request', 'demo', 'demo-client'))
        self.assertEqual(value['manifestSha256'], hashlib.sha256(MANIFEST).hexdigest())
        self.assertEqual(value['sources'], [{'source': 'product_uuid', 'sha256': 'a' * 64}, {'source': 'mac:eth0', 'sha256': 'b' * 64}])
        self.assertIn('attachment', response.headers['content-disposition'])
        self.assertIn('rebind-request', self.client.get('/license').text)

    def test_rebind_request_matches_what_the_license_issue_tool_accepts(self):
        self.report()
        for item in self.client.get('/api/license/rebind-request').json()['sources']:
            self.assertEqual(set(item), {'source', 'sha256'})  # same shape as the sources.json of issue-license


class HardwareTests(GateBase):
    """D136 and D137: warning, 24 hour grace, blocking only once the block window is open."""

    def setUp(self):
        super().setUp()
        self.install()

    def mismatch(self):
        self.report([('product_uuid', '7' * 64), ('board_serial', '8' * 64), ('mac:eth0', '9' * 64)])

    def test_a_mismatch_starts_a_visible_grace_period_and_keeps_serving(self):
        self.mismatch()
        response = self.api()
        self.assertEqual(response.status_code, 200)
        self.assertIn('hardware-mismatch; grace-ends=2026-10-29T12:00:00Z', response.headers.get('X-License-Warning', ''))
        hardware = self.status()['hardware']
        self.assertEqual((hardware['status'], hardware['reason'], hardware['matched'], hardware['since']),
                         ('grace', 'mismatch', 0, '2026-10-28T12:00:00Z'))
        self.assertIn('寬限期內', self.client.get('/license').text)
        self.assertEqual(json.loads(self.state.read_text())['mismatchSince'], '2026-10-28T12:00:00Z')

    def test_one_matching_source_is_not_enough(self):
        self.report([('product_uuid', '1' * 64), ('board_serial', '8' * 64), ('mac:eth0', '9' * 64)])
        self.assertEqual(self.status()['hardware']['status'], 'grace')
        self.assertEqual(self.status()['hardware']['matched'], 1)

    def test_grace_expiry_inside_the_window_blocks_and_the_block_persists_after_the_window_closes(self):
        self.mismatch()
        self.assertEqual(self.status()['hardware']['status'], 'grace')
        self.advance(hours=23, minutes=59)
        self.mismatch()
        self.assertEqual(self.api().status_code, 200)
        self.advance(minutes=2)  # Thursday 12:01, inside 09:00-15:00
        self.mismatch()
        blocked = self.api()
        self.assertEqual((blocked.status_code, blocked.json().get('code')), (503, 'hardware-mismatch'))
        self.assertEqual(self.client.get('/healthz').status_code, 200)
        self.assertEqual(self.client.get('/license').status_code, 200)
        self.advance(hours=4)  # 16:01, the window is closed again, yet the block stays
        self.mismatch()
        self.assertEqual(self.api().status_code, 503)

    def test_grace_expiry_outside_the_window_waits_for_the_next_window_start(self):
        self.now[0] = NOW + timedelta(hours=7)  # Wednesday 19:00
        self.mismatch()
        self.assertEqual(self.status()['hardware']['status'], 'grace')
        self.advance(hours=24)  # Thursday 19:00: grace is over, window closed
        self.mismatch()
        hardware = self.status()['hardware']
        self.assertEqual((hardware['status'], hardware['blockFrom']), ('awaiting-window', '2026-10-29T09:00:00Z'.replace('29', '30')))
        self.assertEqual(self.api().status_code, 200, 'still served until the window opens')
        self.assertIn('block-from=2026-10-30T09:00:00Z', self.api().headers.get('X-License-Warning', ''))
        self.advance(hours=14)  # Friday 09:00
        self.mismatch()
        self.assertEqual(self.api().status_code, 503)

    def test_grace_ending_on_a_weekend_blocks_on_monday_morning(self):
        self.now[0] = datetime(2026, 10, 30, 20, tzinfo=timezone.utc)  # Friday evening
        self.install(make_license(expires=NOW + timedelta(days=60)))
        self.mismatch()
        self.status()
        self.advance(hours=24)  # Saturday 20:00
        self.mismatch()
        hardware = self.status()['hardware']
        self.assertEqual((hardware['status'], hardware['blockFrom']), ('awaiting-window', '2026-11-02T09:00:00Z'))
        self.advance(hours=37)  # Monday 09:00
        self.mismatch()
        self.assertEqual(self.api().status_code, 503)

    def test_the_site_time_zone_decides_when_the_window_is_open(self):
        self.environ['LICENSE_TIMEZONE'] = 'Asia/Taipei'  # 12:00 UTC is 20:00 in Taipei, outside 09:00-15:00
        self.build()
        self.mismatch()
        self.status()
        self.advance(hours=24)
        self.mismatch()
        hardware = self.status()['hardware']
        self.assertEqual((hardware['status'], hardware['blockFrom']), ('awaiting-window', '2026-10-30T01:00:00Z'))

    def test_matching_hardware_again_clears_the_warning_and_the_block(self):
        self.mismatch()
        self.status()
        self.advance(hours=25)
        self.mismatch()
        self.assertEqual(self.api().status_code, 503)
        self.report()
        self.advance(minutes=1)
        self.assertEqual(self.api().status_code, 200)
        self.assertEqual(self.status()['hardware']['status'], 'match')
        self.assertEqual(json.loads(self.state.read_text()), {})

    def test_installing_a_license_for_the_new_hardware_resolves_the_block(self):
        self.mismatch()
        self.status()
        self.advance(hours=25)
        self.mismatch()
        self.assertEqual(self.api().status_code, 503)
        new = [('product_uuid', '7' * 64), ('board_serial', '8' * 64), ('mac:eth0', '9' * 64)]
        response = self.client.post('/api/license/upload', content=make_license(hardware=new), headers={'content-type': 'application/json'})
        self.assertEqual(response.json()['code'], 'ok')
        self.advance(minutes=1)
        self.mismatch()
        self.assertEqual(self.api().status_code, 200)
        self.assertEqual(self.status()['hardware']['status'], 'match')

    def test_grace_survives_a_backend_restart(self):
        self.mismatch()
        self.status()
        self.advance(hours=12)
        self.build()  # a new process reads the persisted state
        self.mismatch()
        hardware = self.status()['hardware']
        self.assertEqual((hardware['status'], hardware['since']), ('grace', '2026-10-28T12:00:00Z'))

    def test_a_guard_that_has_not_reported_yet_is_pending_not_a_mismatch(self):
        hardware = self.status()['hardware']
        self.assertEqual((hardware['status'], hardware['reason']), ('pending', 'guard-unreachable'))
        self.assertEqual(self.api().status_code, 200)
        self.assertNotIn('X-License-Warning', self.api().headers)

    def test_a_guard_silent_for_a_day_counts_as_a_mismatch(self):
        self.status()
        self.advance(hours=24, minutes=1)
        hardware = self.status()['hardware']
        self.assertEqual((hardware['status'], hardware['reason']), ('grace', 'guard-unreachable'))
        self.assertIn('hardware-mismatch', self.api().headers.get('X-License-Warning', ''))
        self.advance(hours=24)
        blocked = self.api()
        self.assertEqual((blocked.status_code, blocked.json().get('code')), (503, 'guard-unreachable'))

    def test_a_stale_report_older_than_the_tolerance_is_not_trusted(self):
        self.report(at=NOW - timedelta(hours=25))
        self.assertEqual(self.status()['hardware']['reason'], 'guard-unreachable')

    def test_a_report_from_the_future_or_a_damaged_one_is_ignored(self):
        self.report(at=NOW + timedelta(hours=2))
        self.assertEqual(self.status()['hardware']['status'], 'pending')
        self.guard.write_text('{"schemaVersion":"1.0"')
        self.advance(seconds=40)
        self.assertEqual(self.status()['hardware']['status'], 'pending')

    def test_an_outage_cannot_end_a_block_that_has_already_started(self):
        self.mismatch()
        self.status()
        self.advance(hours=25)
        self.mismatch()
        self.assertEqual(self.api().status_code, 503)
        self.guard.unlink()
        self.advance(minutes=1)
        self.assertEqual(self.api().status_code, 503)

    def test_unreadable_state_is_treated_as_empty_not_as_a_crash(self):
        self.state.write_text('not json')
        self.mismatch()
        self.assertEqual(self.api().status_code, 200)
        self.assertEqual(json.loads(self.state.read_text())['mismatchSince'], '2026-10-28T12:00:00Z')


class PolicyTests(unittest.TestCase):
    def test_block_window_parsing_and_membership(self):
        window = hw.BlockWindow('mon-fri 09:00-15:00')
        monday = datetime(2026, 11, 2, 9, 0)
        self.assertTrue(window.contains(monday))
        self.assertFalse(window.contains(monday.replace(hour=15)))  # the end is exclusive
        self.assertFalse(window.contains(monday.replace(hour=8, minute=59)))
        self.assertFalse(window.contains(datetime(2026, 11, 7, 10)))  # Saturday
        self.assertEqual(window.next_start(datetime(2026, 11, 6, 16)), datetime(2026, 11, 9, 9))  # Friday evening -> Monday
        self.assertEqual(window.next_start(datetime(2026, 11, 3, 8)), datetime(2026, 11, 3, 9))
        self.assertEqual(hw.BlockWindow('sat-mon 08:00-09:00').days, {5, 6, 0})
        self.assertEqual(hw.BlockWindow('mon,wed 10:00-11:30').days, {0, 2})
        self.assertEqual(len(hw.BlockWindow('daily 00:00-23:59').days), 7)

    def test_bad_windows_are_rejected_at_startup(self):
        for bad in ('', 'mon-fri', 'mon-fri 15:00-09:00', 'mon-fri 09:00-09:00', 'funday 09:00-10:00', 'mon-fri 9:00-10:00',
                    'mon-fri 24:00-25:00'):
            with self.assertRaises(ValueError, msg=bad):
                hw.BlockWindow(bad)


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
