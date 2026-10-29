"""Real Node -> OpenSSL/Python license tests; no sudo, Docker, apt or network."""
import copy
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from common import Failure, Runner, canonical, digest, read_json
from detect import collect, current_sources, fingerprint
from license import issue_license, verify_license
from test_engine import fixture, FakeRunner, TEST_SOURCES

NOW = datetime(2026, 10, 28, 10, tzinfo=timezone.utc)
ROOT = Path(os.environ.get('INSTALLER_REPO', str(Path(__file__).resolve().parents[3])))


@unittest.skipUnless(shutil.which('node') and shutil.which('openssl'), 'Node/OpenSSL required; 由 Claude 執行')
class LicenseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='composer-license-test-')
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.base = Path(cls.tmp.name)
        root, cls.manifest, source = fixture(cls.base)
        cls.keys = cls.base / 'keys'
        result = subprocess.run(['node', str(ROOT / 'services/installer/tests/make-fixtures.mjs'), source['archive'],
                                 str(root / 'system-manifest.json'), str(cls.keys)], capture_output=True)
        if result.returncode:
            raise RuntimeError('Node test fixture generation failed: ' + result.stderr.decode(errors='replace'))
        cls.data = read_json(cls.keys / 'licenses.json')
        cls.pem = (cls.keys / 'root.pem').read_text()
        cls.verified = {'keyPem': cls.pem, 'manifestSha256': cls.data['manifestSha256'], 'manifest': cls.manifest}

    def setUp(self):
        self.runner = Runner()

    def verify(self, name='valid', current=None, pem=None, now=NOW):
        return verify_license(self.runner, self.data['cases'][name], pem or self.pem,
                              self.data['manifestSha256'], self.data['sources'] if current is None else current, now)

    def rejected(self, call, code=11, message=None):
        with self.assertRaises(Failure) as caught:
            call()
        self.assertEqual(caught.exception.code, code)
        if message:
            self.assertIn(message, str(caught.exception))

    def test_node_license_and_expired_certificate(self):
        self.assertEqual(self.verify()['licensee']['name'], 'fixture-client')
        self.assertEqual(self.verify(now=datetime(2027, 1, 1, tzinfo=timezone.utc))['schemaVersion'], '3.0')

    def test_wrong_root(self):
        self.rejected(lambda: self.verify(pem=(self.keys / 'other-root.pem').read_text()))

    def test_certificate_signature(self):
        self.rejected(lambda: self.verify('certificateTampered'), message='簽章')

    def test_issuer_id(self):
        self.rejected(lambda: self.verify('issuerMismatch'), message='issuerKeyId')

    def test_key_id(self):
        self.rejected(lambda: self.verify('keyMismatch'), message='keyId')

    def test_license_signature(self):
        self.rejected(lambda: self.verify('licenseTampered'), message='簽章')

    def test_issued_interval(self):
        self.rejected(lambda: self.verify('issuedOutside'), message='issuedAt')

    def test_licensee(self):
        self.rejected(lambda: self.verify('licenseeMismatch'), message='licensee')

    def test_manifest(self):
        self.rejected(lambda: self.verify('manifestMismatch'), message='manifest')

    def test_expiry(self):
        self.rejected(lambda: self.verify('expired'), message='到期')

    def test_hash_intersection_not_names(self):
        renamed = [dict(item, source='disk:renamed' + str(i)) for i, item in enumerate(self.data['sources'])]
        try:
            result = self.verify(current=renamed)
        except Failure as error:
            self.fail('same hashes under different source names must verify: ' + str(error))
        self.assertEqual(result['schemaVersion'], '3.0')
        wrong = [dict(item, sha256=digest(('wrong-' + str(i)).encode())) for i, item in enumerate(self.data['sources'])]
        self.rejected(lambda: self.verify(current=wrong), message='交集')

    def test_duplicate_hashes_do_not_count_twice(self):
        self.rejected(lambda: self.verify('duplicateHashes'), message='交集')
        repeated = [dict(self.data['sources'][0], source='disk:x' + str(i)) for i in range(3)]
        self.rejected(lambda: self.verify(current=repeated), message='交集')
        self.rejected(lambda: self.verify('duplicateNames'), message='重複')

    def test_additional_properties(self):
        self.rejected(lambda: self.verify('extraField'))
        for key in ('unexpected', 'issuerCertificate'):
            value = copy.deepcopy(self.data['cases']['valid'])
            if key == 'issuerCertificate':
                value[key]['unexpected'] = True
            else:
                value[key] = True
            self.rejected(lambda: verify_license(self.runner, value, self.pem, self.data['manifestSha256'], self.data['sources'], NOW))

    def issue(self, out, password='fixture-passphrase', current=None, now=NOW):
        return issue_license(self.runner, self.keys / 'subkey.enc.pem', self.keys / 'subkey.cert.json', out,
                             {'passphrase': password, 'expiresAt': '2099-01-01T00:00:00Z'}, self.verified,
                             self.data['sources'] if current is None else current, now)

    def test_issue_stdin_and_self_verification(self):
        with tempfile.TemporaryDirectory(dir=self.base) as tmp:
            out = Path(tmp) / 'license.lic'
            original = self.runner.run
            calls = []
            def recording(args, **kwargs):
                calls.append((args, kwargs))
                return original(args, **kwargs)
            self.runner.run = recording
            value = self.issue(out)
            self.assertEqual(read_json(out), value)
            self.assertEqual(verify_license(self.runner, value, self.pem, self.data['manifestSha256'], self.data['sources'], NOW)['systemId'], 'fixture')
            signing = [(args, kw) for args, kw in calls if '-sign' in args]
            self.assertEqual(len(signing), 1)
            self.assertEqual(signing[0][1]['data'], b'fixture-passphrase\n')
            self.assertEqual(signing[0][0][signing[0][0].index('-passin') + 1], 'stdin')
            self.assertNotIn('fixture-passphrase', json.dumps(self.runner.commands))
            self.assertNotIn('fixture-hardware-', json.dumps(self.runner.commands))
            for path in self.base.rglob('*'):
                if path.is_file():
                    self.assertNotIn(b'fixture-passphrase', path.read_bytes(), str(path))
                    self.assertNotIn(b'fixture-hardware-', path.read_bytes(), str(path))
            before = out.read_bytes()
            self.rejected(lambda: self.issue(out), 17, '已存在')
            self.assertEqual(out.read_bytes(), before)

    def test_issue_rejections_name_the_stage_without_echoing_inputs(self):
        with tempfile.TemporaryDirectory(dir=self.base) as tmp:
            out = Path(tmp) / 'license.lic'
            self.rejected(lambda: self.issue(out, password='wrong-secret'), 17, '密碼錯誤')
            self.rejected(lambda: self.issue(out, current=self.data['sources'][:2]), 17, '不足三項')
            self.rejected(lambda: self.issue(out, now=datetime(2027, 1, 1, tzinfo=timezone.utc)), 17, '不在有效期內')
            self.rejected(lambda: self.issue(out, now=datetime(2026, 1, 1, tzinfo=timezone.utc)), 17, '不在有效期內')
            self.rejected(lambda: self.issue(out, password=''), 17, '到期日已過或格式不合法')
            self.assertFalse(out.exists())
            self.assertNotIn('wrong-secret', json.dumps(self.runner.commands))


class FingerprintTests(unittest.TestCase):
    def test_disk_serial_vpd_and_exclusions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('sda', 'sdb', 'sdc', 'loop0', 'ram0', 'dm-0', 'md0', 'zram0', 'sr0', 'nbd0'):
                disk = root / 'block' / name
                (disk / 'device').mkdir(parents=True)
                (disk / 'removable').write_text('1' if name == 'sdc' else '0')
                (disk / 'device/serial').write_text('  AB CD  ')
            (root / 'block/sdb/device/serial').unlink()
            (root / 'block/sdb/device/vpd_pg80').write_bytes(b'\x00\x80\xff  Serial-X\x01  ')
            values = {s['source']: s for s in fingerprint(root)['sources'] if s['source'].startswith('disk:')}
            self.assertEqual(set(values), {'disk:sda', 'disk:sdb'})
            self.assertEqual(values['disk:sda']['sha256'], digest(b'ab cd'))
            self.assertEqual(values['disk:sdb']['sha256'], digest(b'serial-x'))
            actual_resolve = Path.resolve
            with patch.object(Path, 'resolve', lambda p: root / 'devices/usb1/sda' if p.name == 'sda' else actual_resolve(p)):
                self.assertNotIn('disk:sda', [s['source'] for s in fingerprint(root)['sources']])

    def test_privileged_collection_and_no_raw_values(self):
        runner = FakeRunner()
        with patch.object(runner, 'run', wraps=runner.run) as run:
            self.assertEqual(current_sources(runner), TEST_SOURCES)
        self.assertTrue(run.call_args.kwargs['privileged'])
        self.assertIn('fingerprint', run.call_args.args[0])
        self.assertNotIn('fixture-hardware-', json.dumps(runner.commands))

    def test_bad_collection_rejected(self):
        runner = FakeRunner()
        with patch.object(runner, 'run', return_value=subprocess.CompletedProcess([], 0, b'{}', b'')):
            with self.assertRaises(Failure):
                collect(runner)


if __name__ == '__main__':
    unittest.main()
