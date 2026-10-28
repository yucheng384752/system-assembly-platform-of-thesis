"""Standard-library tests. Run on Ubuntu/Python 3.10; never invokes Docker or sudo."""
import base64
import contextlib
import copy
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from common import Failure, Journal, Lock, Runner, canonical, check_plan, digest, seal, write_json
import cli
import fsops
from detect import detect, fingerprint, universe_enabled
from install import Installer, LABEL, STEPS, make_plan, override, private_input
from package import safe_path, verify

TEST_SOURCES = [{'source': name, 'sha256': digest(('fixture-' + str(i)).encode())}
                for i, name in enumerate(('product_uuid', 'board_serial', 'disk:sda'))]


def fake_license(manifest_hash):
    def signed(payload):
        return {'payload': canonical(payload).decode(), 'signature': base64.b64encode(b'fixture-signature').decode(),
                'algorithm': 'RSA-PSS-SHA256'}
    cert = signed({'schemaVersion': '1.0', 'issuerKeyId': digest(b'fixture-der'), 'keyId': digest(b'fixture-der'),
                   'subjectPublicKey': 'FAKE TEST PUBLIC KEY', 'licensee': {'name': 'fixture'},
                   'notBefore': '2026-01-01T00:00:00Z', 'notAfter': '2026-01-02T00:00:00Z'})
    return dict(signed({'schemaVersion': '3.0', 'issuedAt': '2026-01-01T12:00:00Z', 'expiresAt': '2099-01-01T00:00:00Z',
                        'licensee': {'name': 'fixture'}, 'systemId': 'fixture', 'recipe': 'fixture',
                        'enabledKits': ['platform-core-kit'], 'packageManifestSha256': manifest_hash,
                        'fingerprint': {'minMatch': 2, 'sources': TEST_SOURCES}}), issuerCertificate=cert)


def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w') as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    return output.getvalue()


def fixture(directory, extra=None):
    root = directory / 'source'
    root.mkdir()
    template = Path(os.environ.get('INSTALLER_PACKAGE_TEMPLATES', str(Path(__file__).resolve().parents[2] / 'package/templates')))
    files = {'deployment/docker-compose.yml': (template / 'docker-compose.yml').read_bytes().replace(b'@@WEBHOOK_ENV@@', b''),
             'deployment/.env.example': (template / 'env.example').read_bytes().replace(b'@@WEBHOOK_EXAMPLE@@', b''),
             'deployment/nginx.conf': (template / 'nginx.conf').read_bytes()}
    images = []
    for name, services in [('postgres', ['postgres']), ('backend', ['backend', 'init']), ('proxy', ['proxy'])]:
        config = canonical({'fixture': name})
        config_name = digest(config) + '.json'
        tag = name + ':test'
        image = {'id': 'sha256:' + digest(config), 'tag': tag, 'archive': 'images/' + name + '.tar', 'services': services}
        files[image['archive']] = tar_bytes({config_name: config, 'manifest.json': canonical([
            {'Config': config_name, 'RepoTags': [tag], 'Layers': []}])})
        images.append(image)
    manifest = {'format': 'composer-system-assembly', 'schemaVersion': '1.0.0', 'systemVersion': '1.0.0', 'systemId': 'fixture', 'images': images,
                'kits': [{'kit': 'platform-core-kit'}],
                'files': [{'path': name, 'bytes': len(data), 'sha256': digest(data), 'role': 'fixture'} for name, data in files.items()]}
    files['system-manifest.json'] = canonical(manifest)
    for name, data in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    archive_path = directory / 'package.tar.gz'
    with tarfile.open(archive_path, 'w:gz') as archive:
        for name, data in {**files, **(extra or {})}.items():
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            archive.addfile(entry, io.BytesIO(data))
    envelope = {'algorithm': 'RSA-PSS-SHA256', 'payload': canonical({
        'sha256': digest(archive_path.read_bytes()), 'systemManifestSha256': digest(files['system-manifest.json'])}).decode(),
        'signature': base64.b64encode(b'fixture-signature').decode()}
    signature = directory / 'signature.json'
    signature.write_bytes(canonical(envelope))
    key = directory / 'key.pem'
    key.write_text('FAKE TEST PUBLIC KEY')
    source = {'archive': str(archive_path), 'signature': str(signature), 'key': str(key), 'prefix': digest(b'fixture-der')[:8]}
    return root, manifest, source


class FakeRunner(Runner):
    def __init__(self):
        super().__init__()
        self.images, self.tags, self.resources = set(), {}, {'network': {}, 'volume': {}, 'container': {}}
        self.signature_ok = True
        self.fail = None
        self.wrong_id = False
        self.active_install_id = ''
        self.after = None

    def fs(self, action, path, **kwargs):
        self.commands.append(['fs', action, str(path)])
        if self.fail == 'fs-remove' and action == 'remove':
            raise Failure(13, 'fixture failure')
        kwargs.pop('owner', None)
        fsops.execute(dict(action=action, path=str(path), **kwargs))

    def run(self, args, *, privileged=False, data=None, check=True):
        self.commands.append(list(args))
        code, out = 0, b''
        if self.fail and self.fail != 'fs-remove' and self.fail in ' '.join(args):
            code = 1
        elif args[:2] == ['openssl', 'pkey']:
            out = b'Public-Key: (2048 bit)\nModulus:' if '-text' in args else b'fixture-der'
        elif args[:2] == ['openssl', 'dgst']:
            signature = Path(args[args.index('-signature') + 1]).read_bytes()
            code = 0 if self.signature_ok and signature == b'fixture-signature' else 1
        elif 'fingerprint' in args:
            out = canonical([dict(item, valid=True) for item in TEST_SOURCES])
        elif args[0] == 'apt-cache':
            out = b'Installed: (none)\nCandidate: 1.2.3\n'
        elif args[0] == 'dpkg-query':
            code = 1
        elif args[:3] == ['docker', 'image', 'ls']:
            out = '\n'.join(sorted(self.images)).encode()
        elif args[:3] == ['docker', 'image', 'inspect']:
            name = args[-1]
            image_id = self.tags.get(name, name if name in self.images else None)
            code = 0 if image_id else 1
            out = (('sha256:' + '0' * 64) if self.wrong_id else image_id or '').encode()
        elif args[:2] == ['docker', 'load']:
            with tarfile.open(args[-1]) as archive:
                item = json.load(archive.extractfile('manifest.json'))[0]
                image_id = 'sha256:' + digest(archive.extractfile(item['Config']).read())
                self.images.add(image_id)
                self.tags[item['RepoTags'][0]] = image_id
        elif args[:3] == ['docker', 'image', 'rm']:
            self.images.discard(args[-1])
        elif args[0] == 'docker' and len(args) > 2 and args[1] in self.resources:
            kind, action = args[1:3]
            objects = self.resources[kind]
            if action == 'ls':
                selected = list(objects)
                if '--filter' in args:
                    criterion = args[args.index('--filter') + 1]
                    if criterion.startswith('label='):
                        selected = [name for name in selected if objects[name].get(LABEL) == criterion.split('=', 2)[2]]
                    elif criterion.startswith('ancestor='):
                        selected = [name for name in selected if objects[name].get('image') == criterion.split('=', 1)[1]]
                out = '\n'.join(selected).encode()
            elif action == 'create':
                objects[args[-1]] = {args[n + 1].split('=', 1)[0]: args[n + 1].split('=', 1)[1]
                                    for n, arg in enumerate(args) if arg == '--label'}
            elif action == 'inspect':
                if args[-1] not in objects:
                    code = 1
                else:
                    info = {'Labels': objects[args[-1]]}
                    out = canonical([{'Config': info} if kind == 'container' else info])
            elif action == 'rm':
                objects.pop(args[-1], None)
        elif args[:2] == ['docker', 'compose'] and 'up' in args:
            name = args[-1]
            override_path = Path(args[args.index('-f', args.index('-f') + 1) + 1])
            config = json.loads(override_path.read_text())
            self.resources['container'][name] = config['services'][name]['labels']
        if self.after:
            self.after(args)
        if check and code:
            raise Failure(13, 'fixture command failed')
        return subprocess.CompletedProcess(args, code, out, b'')


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root, self.manifest, self.source = fixture(self.base)
        self.runner = FakeRunner()
        self.state_dir = self.base / 'state'
        self.state_dir.mkdir()
        self.extracted = self.base / 'extracted'
        self.extracted.mkdir()
        self.verified = verify(self.runner, **self.source, destination=self.extracted)
        self.detection = {'problems': [], 'packages': [{'name': name, 'version': '1.2.3', 'installed': '(none)'}
                                                     for name in ('docker.io', 'docker-compose-v2')]}
        self.license_path = self.base / 'license.lic'
        write_json(self.license_path, fake_license(self.verified['manifestSha256']))
        self.license_info = {'sha256': digest(self.license_path.read_bytes()), 'licensee': {'name': 'fixture'}, 'expiresAt': '2099-01-01T00:00:00Z'}
        self.plan = make_plan(self.verified, self.root, self.source, self.detection, self.base / 'installed', self.base / 'trust', self.license_info)
        self.events = []
        self.journal = Journal(self.state_dir, self.events.append)
        self.installer = Installer(self.runner, self.journal, self.plan, key_pem=self.verified['keyPem'], license_path=self.license_path)
        self.body = {'env': {'POSTGRES_USER': 'app', 'POSTGRES_DB': 'app', 'POSTGRES_PASSWORD': 'db$private',
                             'SECRET_KEY': 'S' * 40, 'ENTRY_PERMISSION_JWT_SECRET': 'J' * 40,
                             'DEFAULT_TENANT_ID': '12345678-1234-1234-1234-123456789abc'},
                     'admin': {'username': 'admin', 'password': 'Admin-private-123', 'display_name': 'Test Admin'}}

    def assert_code(self, code, call):
        with self.assertRaises(Failure) as caught:
            call()
        self.assertEqual(caught.exception.code, code)

    def verify_again(self):
        with tempfile.TemporaryDirectory(dir=self.base) as out:
            return verify(self.runner, **self.source, destination=out)

    def test_signature_rejected_before_extraction(self):
        self.runner.signature_ok = False
        with patch('package.tarfile.open', side_effect=AssertionError('extracted before signature')):
            self.assert_code(11, self.verify_again)

    def test_tar_hash_rejected_before_extraction(self):
        with open(self.source['archive'], 'ab') as stream:
            stream.write(b'tamper')
        with patch('package.tarfile.open', side_effect=AssertionError('extracted before hash')):
            self.assert_code(11, self.verify_again)

    def test_traversal_and_unlisted_files_rejected(self):
        for name in ('../escape', '/absolute', 'a\\escape', 'unlisted.txt'):
            with self.subTest(name=name), tempfile.TemporaryDirectory(dir=self.base) as tmp:
                _, _, source = fixture(Path(tmp), {name: b'bad'})
                with tempfile.TemporaryDirectory(dir=self.base) as out:
                    self.assert_code(11, lambda: verify(self.runner, **source, destination=out))
        self.assertFalse((self.base / 'escape').exists())

    def test_path_guard(self):
        for name in ('../escape', '/absolute', 'a/../b', 'a\\b', 'C:/file'):
            self.assert_code(11, lambda: safe_path(name))

    def test_link_rejected(self):
        archive_path = Path(self.source['archive'])
        with tarfile.open(archive_path, 'w:gz') as archive:
            entry = tarfile.TarInfo('escape')
            entry.type, entry.linkname = tarfile.SYMTYPE, '/tmp'
            archive.addfile(entry)
        signature = json.loads(Path(self.source['signature']).read_text())
        payload = json.loads(signature['payload'])
        payload['sha256'] = digest(archive_path.read_bytes())
        signature['payload'] = json.dumps(payload)
        Path(self.source['signature']).write_text(json.dumps(signature))
        self.assert_code(11, self.verify_again)

    def test_key_prefix_and_manifest_hash_rejected(self):
        self.source['prefix'] = '00000000'
        self.assert_code(11, self.verify_again)
        self.source['prefix'] = digest(b'fixture-der')[:8]
        signature = json.loads(Path(self.source['signature']).read_text())
        payload = json.loads(signature['payload'])
        payload['systemManifestSha256'] = '0' * 64
        signature['payload'] = json.dumps(payload)
        Path(self.source['signature']).write_text(json.dumps(signature))
        self.assert_code(11, self.verify_again)

    def test_signature_bytes_and_listed_file_hash(self):
        signature_path = Path(self.source['signature'])
        signature = json.loads(signature_path.read_text())
        signature['signature'] = base64.b64encode(b'tampered-signature').decode()
        signature_path.write_text(json.dumps(signature))
        self.assert_code(11, self.verify_again)
        signature['signature'] = base64.b64encode(b'fixture-signature').decode()
        archive_path = Path(self.source['archive'])
        with tarfile.open(archive_path, 'w:gz') as archive:
            for path in self.root.rglob('*'):
                if path.is_file():
                    name = path.relative_to(self.root).as_posix()
                    data = b'tampered' if name == 'deployment/nginx.conf' else path.read_bytes()
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    archive.addfile(entry, io.BytesIO(data))
        payload = json.loads(signature['payload'])
        payload['sha256'] = digest(archive_path.read_bytes())
        signature['payload'] = json.dumps(payload)
        signature_path.write_text(json.dumps(signature))
        self.assert_code(11, self.verify_again)

    def test_plan_hash_and_order(self):
        check_plan(self.plan, self.plan['planSha256'])
        self.assertEqual([s['id'] for s in self.plan['steps']], STEPS)
        bad = copy.deepcopy(self.plan)
        bad['target']['installDir'] += '-tampered'
        self.assert_code(12, lambda: check_plan(bad, self.plan['planSha256']))
        self.assertEqual(canonical({'z': 1, 'a': '測試'}), '{"a":"測試","z":1}'.encode())

    def test_apply_and_no_secret_copies(self):
        original = (self.root / 'deployment/docker-compose.yml').read_bytes()
        self.assertEqual(self.installer.apply(self.root, self.body), 0)
        target = self.base / 'installed'
        self.assertEqual((target / 'deployment/docker-compose.yml').read_bytes(), original)
        config = json.loads((target / 'compose.override.yml').read_text())
        for group in ('services', 'networks', 'volumes'):
            for resource in config[group].values():
                self.assertEqual(resource['labels'][LABEL], self.installer.install_id)
        self.assertEqual((target / '.env').stat().st_mode & 0o777, 0o600)
        for path in self.base.rglob('*'):
            if path.is_file() and path != target / '.env':
                self.assertNotIn(b'db$private', path.read_bytes(), str(path))
                self.assertNotIn(b'Admin-private-123', path.read_bytes(), str(path))
        self.assertNotIn('db$private', json.dumps(self.runner.commands))
        self.assertTrue(any('app.entry_permission.create_admin' in c for c in self.runner.commands))
        self.assertTrue(all('build' not in c for c in self.runner.commands))
        loaded = self.installer.state['steps']['images-load']['undo']
        self.assertTrue(all(item['loadedId'] == item['id'] and not item['existed'] for item in loaded))

    def test_redaction_at_event_and_state_boundary(self):
        self.journal.secrets = ['known-secret']
        self.journal.event('test', 'failed', 'exception contains known-secret')
        self.journal.save({'nested': ['known-secret']})
        for name in ('events.jsonl', 'state.json'):
            text = (self.state_dir / name).read_text()
            self.assertNotIn('known-secret', text)
            self.assertIn('[REDACTED]', text)

    def test_cancel_at_step_boundary(self):
        def after(args):
            if args[:2] == ['docker', 'load']:
                (self.state_dir / 'cancel.request').write_text('{}')
        self.runner.after = after
        self.assertEqual(self.installer.apply(self.root, self.body), 15)
        self.assertEqual(self.installer.state['steps']['images-load']['status'], 'ok')
        self.assertNotIn('network-volumes', self.installer.state['steps'])

    def test_step_failure_and_rollback_failure(self):
        self.runner.fail = 'docker load'
        self.assertEqual(self.installer.apply(self.root, self.body), 13)
        self.assertEqual(self.installer.state['steps']['trust-store']['status'], 'ok')
        # A separate rollback failure preserves the installation directory for investigation.
        self.runner.fail = 'fs-remove'
        rollback = self.installer.rollback_plan()
        self.assertEqual(self.installer.rollback(rollback, rollback['planSha256']), 14)
        self.assertTrue((self.base / 'installed').exists())

    def test_loaded_id_mismatch_rejected(self):
        self.runner.wrong_id = True
        self.assertEqual(self.installer.apply(self.root, self.body), 14)
        self.assertEqual(self.installer.state['steps']['images-load']['status'], 'rolled-back')

    def test_preexisting_image_survives_rollback(self):
        existing = self.manifest['images'][0]['id']
        self.runner.images.add(existing)
        self.runner.after = lambda args: (self.state_dir / 'cancel.request').write_text('{}') if args[:2] == ['docker', 'load'] else None
        self.assertEqual(self.installer.apply(self.root, self.body), 15)
        self.runner.after = None
        rollback = self.installer.rollback_plan()
        self.assertEqual(self.installer.rollback(rollback, rollback['planSha256']), 14)
        self.assertIn(existing, self.runner.images)
        self.assertFalse(any(c[:3] == ['docker', 'image', 'rm'] and c[-1] == existing for c in self.runner.commands))

    def test_rollback_label_boundary_and_nonempty_volumes(self):
        self.assertEqual(self.installer.apply(self.root, self.body), 0)
        victim = self.installer.project + '_edge'
        self.runner.resources['network'][victim] = {LABEL: 'other-install'}
        rollback = self.installer.rollback_plan()
        self.assertEqual(self.installer.rollback(rollback, rollback['planSha256']), 14)
        self.assertIn(victim, self.runner.resources['network'])
        self.assertTrue(self.runner.resources['volume'])
        self.assertTrue((self.base / 'installed/.env').exists())
        self.assertFalse(any(c[:3] == ['docker', 'network', 'rm'] and c[-1] == victim for c in self.runner.commands))

    def test_rollback_hash_and_checkpoint(self):
        self.runner.fail = 'docker load'
        self.assertEqual(self.installer.apply(self.root, self.body), 13)
        rollback = self.installer.rollback_plan('trust-store')
        self.assertEqual(rollback['steps'], [])
        self.assert_code(12, lambda: self.installer.rollback(rollback, 'wrong'))
        self.installer.state['status'] = 'changed'
        self.assert_code(12, lambda: self.installer.rollback(rollback, rollback['planSha256']))
        self.assert_code(10, lambda: self.installer.rollback_plan('missing'))

    @unittest.skipUnless(sys.platform == 'linux', 'flock requires target Ubuntu; 由 Claude 執行')
    def test_lock_rejection(self):
        path = self.base / 'lock'
        with Lock(path, 'apply'):
            self.assert_code(16, lambda: Lock(path, 'rollback').__enter__())
        with Lock(path, 'rollback'):
            pass

    def test_fingerprint_and_detect(self):
        sysroot, etc, proc = self.base / 'sys', self.base / 'etc', self.base / 'proc'
        (sysroot / 'class/dmi/id').mkdir(parents=True)
        (sysroot / 'class/dmi/id/product_uuid').write_text('00000000-0000-0000-0000-000000000000')
        (sysroot / 'class/dmi/id/board_serial').write_text('To Be Filled By O.E.M.')
        (sysroot / 'class/net/virtual').mkdir(parents=True)
        (sysroot / 'class/net/virtual/address').write_text('12:34:56:78:90:ab')
        self.assertEqual(fingerprint(sysroot)['validCount'], 0)
        self.assertTrue(fingerprint(sysroot)['warnings'])
        (sysroot / 'class/net/physical/device').mkdir(parents=True)
        (sysroot / 'class/net/physical/address').write_text('12:34:56:78:90:ac')
        self.assertEqual(fingerprint(sysroot)['validCount'], 1)
        (etc / 'apt').mkdir(parents=True)
        (etc / 'os-release').write_text('ID=ubuntu\nVERSION_ID="22.04"\n')
        (etc / 'apt/sources.list').write_text('deb https://archive.ubuntu.com/ubuntu jammy main universe\n')
        proc.mkdir()
        (proc / 'meminfo').write_text('MemTotal: 4096000 kB\n')
        result = detect(self.runner, sys_root=sysroot, etc_root=etc, proc_root=proc, target=self.base, port=0)
        self.assertEqual(result['problems'], [])
        (etc / 'apt/sources.list').write_text('# deb https://example.invalid jammy universe\n')
        (etc / 'apt/sources.list.d').mkdir()
        deb822 = etc / 'apt/sources.list.d/ubuntu.sources'
        deb822.write_text('Types: deb\nComponents: universe\nEnabled: no\n')
        self.assertFalse(universe_enabled(etc / 'apt'))
        deb822.write_text('Types: deb\nComponents: universe\nEnabled: yes\n')
        self.assertTrue(universe_enabled(etc / 'apt'))
        (etc / 'os-release').write_text('ID=other\nVERSION_ID=1\n')
        self.assertTrue(detect(self.runner, sys_root=sysroot, etc_root=etc, proc_root=proc, target=self.base, port=0)['problems'])

    def test_input_rejected_without_mutation(self):
        self.body['env']['POSTGRES_PASSWORD'] = "bad\nINJECT=value"
        self.assert_code(10, lambda: self.installer.apply(self.root, self.body))
        self.assertFalse((self.base / 'installed').exists())

    def call_cli(self, *arguments, body=None):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), patch('cli.detect', return_value=self.detection):
            result = cli.main([*arguments, '--json', '--system-id', 'fixture', '--state-dir', str(self.state_dir),
                               '--lock-file', str(self.base / 'lock')], self.runner, io.StringIO(json.dumps(body or self.body)))
        values = [json.loads(line) for line in output.getvalue().splitlines()]
        return result, values

    def test_cli_verify_and_plan(self):
        args = sum(([('--confirm-key-prefix' if k == 'prefix' else '--' + k), v] for k, v in self.source.items()), [])
        self.assertEqual(self.call_cli('verify', *args)[0], 0)
        code, output = self.call_cli('verify', *args, '--license', str(self.license_path))
        self.assertEqual(code, 0)
        self.assertEqual(output[0]['license'], 'ok')
        plan_path = self.base / 'plan.json'
        self.assertEqual(self.call_cli('plan', *args, '--license', str(self.license_path), '--plan', str(plan_path), '--install-dir', str(self.base / 'out'),
                                       '--trust-dir', str(self.base / 'trust'))[0], 0)
        self.assertTrue(plan_path.exists())
        self.runner.signature_ok = False
        self.assertEqual(self.call_cli('verify', *args)[0], 11)
        self.assertEqual(self.call_cli('plan')[0], 11)

    def test_license_install_recheck_and_rollback(self):
        self.assertEqual(self.installer.apply(self.root, self.body), 0)
        directory = self.base / 'installed/license'
        self.assertEqual((directory / 'license.lic').read_bytes(), self.license_path.read_bytes())
        self.assertTrue(all(item['created'] for item in self.installer.state['steps']['license-install']['undo']))
        self.installer.undo_step('license-install')
        self.assertFalse(directory.exists())
        plan_text = json.dumps(self.plan)
        self.assertIn(self.license_info['sha256'], plan_text)
        for source in TEST_SOURCES:
            self.assertNotIn(source['sha256'], plan_text)

    def test_license_install_drift_is_code_12(self):
        def after(args):
            if args[:2] == ['docker', 'compose'] and args[-1] == 'proxy':
                with self.license_path.open('ab') as stream:
                    stream.write(b'\n')
        self.runner.after = after
        self.assertEqual(self.installer.apply(self.root, self.body), 12)
        self.assertFalse((self.base / 'installed/license/license.lic').exists())
        self.assertEqual(self.installer.state['steps']['compose-up']['status'], 'ok')

    def test_fingerprint_drift_before_license_install(self):
        original = self.runner.run
        def changed(args, **kwargs):
            if 'fingerprint' in args:
                return subprocess.CompletedProcess(args, 0, canonical([]), b'')
            return original(args, **kwargs)
        self.runner.run = changed
        self.assertEqual(self.installer.apply(self.root, self.body), 12)
        self.assertFalse((self.base / 'installed/license').exists())

    def test_license_rollback_preserves_unowned_files(self):
        self.assertEqual(self.installer.apply(self.root, self.body), 0)
        directory = self.base / 'installed/license'
        (directory / 'foreign').write_text('keep')
        with self.assertRaises(OSError):
            self.installer.undo_step('license-install')
        self.assertTrue((directory / 'foreign').exists())
        self.assertFalse((directory / 'license.lic').exists())

    def test_missing_license_apply_refused_before_mutation(self):
        self.assertEqual(self.call_cli('apply')[0], 11)
        self.assertFalse((self.base / 'installed').exists())

    def test_cli_apply_rechecks_license_before_side_effects(self):
        plan_path = self.base / 'plan.json'
        write_json(plan_path, self.plan)
        arguments = ('apply', '--license', str(self.license_path), '--plan', str(plan_path),
                     '--plan-sha256', self.plan['planSha256'])
        raw = self.license_path.read_bytes()
        self.license_path.write_text('{}')
        with patch('cli.Lock', return_value=contextlib.nullcontext()):
            self.assertEqual(self.call_cli(*arguments)[0], 12)
            self.license_path.write_bytes(raw)
            with patch('cli.current_sources', return_value=[]):
                self.assertEqual(self.call_cli(*arguments)[0], 12)
        self.assertFalse((self.base / 'installed').exists())
        self.assertFalse((self.state_dir / 'state.json').exists())

    def test_issue_secrets_cannot_be_arguments(self):
        for option, value in (('--passphrase', 'raw-private-password'), ('--expiresAt', '2099-01-01T00:00:00Z')):
            code, output = self.call_cli('issue-license', option, value)
            self.assertEqual(code, 10)
            self.assertNotIn(value, json.dumps(output))
        code, output = self.call_cli('issue-license', body={'passphrase': 'raw-private-password', 'expiresAt': 'invalid'})
        self.assertEqual(code, 17)
        self.assertNotIn('raw-private-password', json.dumps(output))

    def test_detect_sudo_unavailable_warning(self):
        with patch('detect.os.geteuid', return_value=1000, create=True):
            self.runner.fail = 'sudo'
            result = detect(self.runner, sys_root=self.base, proc_root=self.base, etc_root=self.base,
                            target=self.base, port=0)
        self.assertIn('未取得 root，DMI 來源不可讀', result['fingerprint']['warnings'])

    @unittest.skipUnless(sys.platform == 'linux', 'CLI mutation lock requires Ubuntu; 由 Claude 執行')
    def test_cli_apply_status_cancel_rollback(self):
        plan_path = self.base / 'plan.json'
        write_json(plan_path, self.plan)
        self.assertEqual(self.call_cli('apply', '--license', str(self.license_path), '--plan', str(plan_path), '--plan-sha256', 'wrong')[0], 12)
        self.assertEqual(self.call_cli('apply', '--license', str(self.license_path), '--plan', str(plan_path), '--plan-sha256', self.plan['planSha256'])[0], 0)
        self.assertEqual(self.call_cli('status')[0], 0)
        self.assertEqual(self.call_cli('cancel')[0], 10)
        state = json.loads((self.state_dir / 'state.json').read_text())
        state['status'] = 'running'
        write_json(self.state_dir / 'state.json', state)
        self.assertEqual(self.call_cli('cancel')[0], 0)
        rollback = self.base / 'rollback.json'
        self.assertEqual(self.call_cli('rollback', '--plan', str(plan_path), '--rollback-plan', str(rollback))[0], 0)
        self.assertEqual(self.call_cli('rollback', '--plan', str(plan_path), '--rollback-plan', str(rollback), '--plan-sha256', 'wrong')[0], 12)
        rollback_hash = json.loads(rollback.read_text())['planSha256']
        self.assertEqual(self.call_cli('rollback', '--plan', str(plan_path), '--rollback-plan', str(rollback), '--plan-sha256', rollback_hash)[0], 14)

    def test_cli_detect_and_unavailable(self):
        self.assertEqual(self.call_cli('unknown-command')[0], 10)
        self.assertEqual(self.call_cli('detect')[0], 0)
        self.detection['problems'] = ['fixture unsupported']
        self.assertEqual(self.call_cli('detect')[0], 10)
        self.assertEqual(self.call_cli('issue-license')[0], 17)
        for command in ('license-install', 'guard-up'):
            code, output = self.call_cli(command)
            self.assertEqual(code, 10)
            self.assertIn('尚未提供', output[0]['message'])
        self.assertEqual(self.call_cli('status')[0], 10)
        self.assertEqual(self.call_cli('cancel')[0], 10)

    @unittest.skipUnless(sys.platform == 'linux', 'POSIX input file permissions; 由 Claude 執行')
    def test_private_file_consumed_and_permissions(self):
        path = self.base / 'private.json'
        path.write_text(json.dumps(self.body))
        path.chmod(0o600)
        args = cli.parser().parse_args(['apply', '--input-file', str(path)])
        self.assertEqual(cli.input_body(args, io.StringIO('')), self.body)
        self.assertFalse(path.exists())
        path.write_text('{}')
        path.chmod(0o644)
        self.assert_code(10, lambda: cli.input_body(args, io.StringIO('')))
        self.assertFalse(path.exists())

    def test_empty_install_rollback_succeeds(self):
        self.runner.after = lambda args: (self.state_dir / 'cancel.request').write_text('{}') if args[:2] == ['docker', 'load'] else None
        self.assertEqual(self.installer.apply(self.root, self.body), 15)
        self.runner.after = None
        rollback = self.installer.rollback_plan()
        self.assertEqual(self.installer.rollback(rollback, rollback['planSha256']), 0)
        self.assertFalse(self.runner.images)
        self.assertFalse((self.base / 'installed').exists())

    def test_used_image_retained(self):
        self.runner.after = lambda args: (self.state_dir / 'cancel.request').write_text('{}') if args[:2] == ['docker', 'load'] else None
        self.assertEqual(self.installer.apply(self.root, self.body), 15)
        self.runner.after = None
        image_id = self.manifest['images'][0]['id']
        self.runner.resources['container']['foreign'] = {LABEL: 'other', 'image': image_id}
        rollback = self.installer.rollback_plan()
        self.assertEqual(self.installer.rollback(rollback, rollback['planSha256']), 14)
        self.assertIn(image_id, self.runner.images)

    def test_unexpected_image_archive_tag_rejected(self):
        from package import validate_manifest
        manifest = copy.deepcopy(self.manifest)
        manifest['images'][0]['tag'] = 'unexpected:tag'
        self.assert_code(11, lambda: validate_manifest(manifest, self.root))

    def test_unknown_deployment_or_upgrade_rejected(self):
        (self.base / 'installed').mkdir()
        self.assert_code(10, lambda: make_plan(self.verified, self.root, self.source, self.detection,
                                             self.base / 'installed', self.base / 'trust', self.license_info))
        (self.root / 'deployment/docker-compose.yml').write_text('services: {}')
        self.assert_code(11, lambda: make_plan(self.verified, self.root, self.source, self.detection,
                                             self.base / 'different', self.base / 'trust', self.license_info))

    @unittest.skipUnless(sys.platform == 'linux', 'sudo boundary targets Ubuntu; 由 Claude 執行')
    def test_runner_uses_arrays_and_does_not_record_stdin(self):
        runner = Runner()
        result = subprocess.CompletedProcess([], 0, b'ok', b'')
        with patch('common.os.geteuid', return_value=1000), patch('common.subprocess.run', return_value=result) as spawn:
            runner.run(['docker', 'info'], privileged=True, data=b'private-input')
        self.assertEqual(spawn.call_args.args[0], ['sudo', '--', 'docker', 'info'])
        self.assertNotIn('shell', spawn.call_args.kwargs)
        self.assertNotIn('private-input', json.dumps(runner.commands))

    def test_unconfirmed_file_creation_is_preserved(self):
        path = self.base / 'installed'
        path.mkdir()
        (path / 'existing-data').write_text('keep')
        self.installer.state['steps']['trust-store'] = {'status': 'failed', 'undo': [
            {'kind': 'directory', 'path': str(path), 'created': False}]}
        self.installer.undo_step('trust-store')
        self.assertTrue((path / 'existing-data').exists())
        self.assertTrue(self.installer.state['retained'])


if __name__ == '__main__':
    unittest.main()
