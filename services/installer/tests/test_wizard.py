import http.client
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

ENGINE = Path(__file__).resolve().parents[1] / 'engine'
sys.path.insert(0, str(ENGINE))
import cli  # noqa: E402
import wizard  # noqa: E402

PLAN_SHA = 'a' * 64
ROLLBACK_SHA = 'b' * 64
SECRET = 'S3cret-passphrase-value'


class FakeEngine:
    def __init__(self, workdir):
        self.workdir = Path(workdir)
        self.calls, self.spawned, self.sudo, self.finish = [], [], True, None
        self.results = {}

    def run(self, command, extra=(), stdin=None):
        self.calls.append((command, list(extra), stdin))
        default = {'exitCode': 0, 'output': [{'status': 'ok'}]}
        if command == 'plan':
            default = {'exitCode': 0, 'output': [{'format': 'composer-install-plan', 'planSha256': PLAN_SHA, 'steps': [], 'notProvided': []}]}
        if command == 'rollback' and '--plan-sha256' not in extra:
            default = {'exitCode': 0, 'output': [{'format': 'composer-rollback-plan', 'planSha256': ROLLBACK_SHA, 'steps': []}]}
        return self.results.get(command, default)

    def spawn(self, command, extra, stdin, finished):
        self.spawned.append((command, list(extra), stdin))
        self.finish = finished

    def sudo_ready(self):
        return self.sudo


class WizardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = FakeEngine(self.tmp.name)
        self.server = None
        started = threading.Event()

        def ready(server, token, app):
            self.server, self.token, self.app = server, token, app
            started.set()
        threading.Thread(target=wizard.serve, daemon=True, kwargs=dict(
            system_id='demo', base=[], port=0, announce=lambda *_: None, workdir=self.tmp.name,
            engine=self.engine, ready=ready)).start()
        self.assertTrue(started.wait(5))
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None, host=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=5)
        merged = {'Host': host or f'127.0.0.1:{self.port}', **(headers or {})}
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        if data is not None:
            merged.setdefault('Content-Type', 'application/json')
        connection.request(method, path, data, merged)
        response = connection.getresponse()
        raw = response.read()
        connection.close()
        return response, raw

    def api(self, name, body=None, **kwargs):
        response, raw = self.request('POST', f'/{self.token}/api/{name}', body or {}, **kwargs)
        return response.status, json.loads(raw)

    def prepare_plan(self):
        self.api('verify', dict(archive='/a.tgz', signature='/s.json', key='/k.pem', prefix='0123abcd'))
        self.api('issue-license', dict(subkey='/u/sub.pem', certificate='/u/c.json', passphrase=SECRET, expiresAt='2030-01-01T00:00:00Z'))
        return self.api('plan')

    def good_input(self):
        return {'env': {'POSTGRES_PASSWORD': 'pw-value-1234'}, 'admin': {'password': 'admin-password-xyz'}}

    def test_token_and_host_are_required(self):
        self.assertEqual(self.request('GET', f'/{self.token}/')[0].status, 200)
        self.assertEqual(self.request('GET', '/wrong-token/')[0].status, 403)
        self.assertEqual(self.request('GET', '/')[0].status, 403)
        response, _ = self.request('GET', f'/{self.token}/', host=f'attacker.example:{self.port}')
        self.assertEqual(response.status, 403)
        response, _ = self.request('POST', f'/{self.token}/api/detect', {}, host='attacker.example')
        self.assertEqual(response.status, 403)
        self.assertEqual(self.engine.calls, [])

    def test_static_files_are_whitelisted_and_locked_down(self):
        for name in ('', 'app.js', 'style.css'):
            response, _ = self.request('GET', f'/{self.token}/{name}')
            self.assertEqual(response.status, 200)
            self.assertIn("default-src 'none'", response.getheader('Content-Security-Policy'))
            self.assertEqual(response.getheader('Cache-Control'), 'no-store')
        for name in ('wizard.py', '../cli.py', '%2e%2e/cli.py', 'api/'):
            self.assertIn(self.request('GET', f'/{self.token}/{name}')[0].status, (403, 404))
        page = (wizard.STATIC / 'index.html').read_text(encoding='utf-8')
        script = (wizard.STATIC / 'app.js').read_text(encoding='utf-8')
        self.assertNotIn('<script>', page)
        self.assertNotIn(' style=', page)
        for forbidden in ('innerHTML', 'outerHTML', 'document.write', 'insertAdjacentHTML', 'eval('):
            self.assertNotIn(forbidden, script)

    def test_post_guards_origin_content_type_and_size(self):
        path = f'/{self.token}/api/detect'
        self.assertEqual(self.request('POST', path, {}, headers={'Origin': 'http://evil.example'})[0].status, 403)
        self.assertEqual(self.request('POST', path, {}, headers={'Origin': f'http://127.0.0.1:{self.port}'})[0].status, 200)
        self.assertEqual(self.request('POST', path, b'{}', headers={'Content-Type': 'text/plain'})[0].status, 415)
        try:
            self.assertEqual(self.request('POST', path, b'x' * (wizard.MAX_BODY + 1))[0].status, 413)
        except (ConnectionError, http.client.HTTPException):
            pass  # the server may reset the socket before the client finishes sending; either way nothing is processed
        self.assertEqual(len(self.engine.calls), 1)  # only the valid-origin request reached the engine
        self.assertEqual(self.request('POST', path, b'not json')[0].status, 400)
        self.assertEqual(self.request('POST', path, b'[]')[0].status, 400)

    def test_inputs_are_validated_before_the_engine_runs(self):
        for body in ({}, dict(archive='relative.tgz', signature='/s', key='/k', prefix='0123abcd'),
                     dict(archive='/a', signature='/s', key='/k', prefix='xyz'),
                     dict(archive='/a\n--plan', signature='/s', key='/k', prefix='0123abcd')):
            self.assertEqual(self.api('verify', body)[0], 400)
        self.assertEqual(self.engine.calls, [])

    def test_passphrase_reaches_the_engine_only_through_stdin(self):
        self.api('verify', dict(archive='/a.tgz', signature='/s.json', key='/k.pem', prefix='0123abcd'))
        status, data = self.api('issue-license', dict(subkey='/u/sub.pem', certificate='/u/c.json', passphrase=SECRET,
                                                      expiresAt='2030-01-01T00:00:00Z'))
        self.assertEqual(status, 200)
        command, extra, stdin = self.engine.calls[-1]
        self.assertEqual(command, 'issue-license')
        self.assertNotIn(SECRET, ' '.join(extra))
        self.assertEqual(json.loads(stdin), {'passphrase': SECRET, 'expiresAt': '2030-01-01T00:00:00Z'})
        self.assertNotIn(SECRET, json.dumps(data))
        self.assertEqual(self.api('config')[1]['licenseIssued'], True)

    def test_issue_requires_verified_package_and_plan_requires_license(self):
        body = dict(subkey='/u/s', certificate='/u/c', passphrase=SECRET, expiresAt='2030-01-01T00:00:00Z')
        self.assertEqual(self.api('issue-license', body)[0], 409)
        self.api('verify', dict(archive='/a.tgz', signature='/s.json', key='/k.pem', prefix='0123abcd'))
        self.assertEqual(self.api('plan')[0], 409)
        self.assertNotIn('plan', [c[0] for c in self.engine.calls])

    def test_failed_issue_does_not_unlock_planning(self):
        self.api('verify', dict(archive='/a.tgz', signature='/s.json', key='/k.pem', prefix='0123abcd'))
        self.engine.results['issue-license'] = {'exitCode': 17, 'output': [{'status': 'failed'}]}
        self.api('issue-license', dict(subkey='/u/s', certificate='/u/c', passphrase=SECRET, expiresAt='2030-01-01T00:00:00Z'))
        self.assertEqual(self.api('plan')[0], 409)

    def test_apply_is_bound_to_the_plan_hash_the_wizard_displayed(self):
        self.prepare_plan()
        self.assertEqual(self.api('apply', {'planSha256': 'c' * 64, 'input': self.good_input()})[0], 409)
        self.assertEqual(self.engine.spawned, [])
        status, data = self.api('apply', {'planSha256': PLAN_SHA, 'input': self.good_input()})
        self.assertEqual((status, data), (200, {'started': True}))
        command, extra, stdin = self.engine.spawned[0]
        self.assertEqual(command, 'apply')
        self.assertIn(PLAN_SHA, extra)
        joined = ' '.join(extra)
        for value in ('pw-value-1234', 'admin-password-xyz'):
            self.assertNotIn(value, joined)
        self.assertEqual(json.loads(stdin), self.good_input())

    def test_apply_needs_sudo_and_runs_one_at_a_time(self):
        self.prepare_plan()
        self.engine.sudo = False
        status, data = self.api('apply', {'planSha256': PLAN_SHA, 'input': self.good_input()})
        self.assertEqual(status, 409)
        self.assertIn('sudo -v', data['message'])
        self.assertEqual(self.engine.spawned, [])
        self.engine.sudo = True
        self.assertEqual(self.api('apply', {'planSha256': PLAN_SHA, 'input': self.good_input()})[0], 200)
        self.assertEqual(self.api('apply', {'planSha256': PLAN_SHA, 'input': self.good_input()})[0], 409)
        self.assertTrue(self.api('config')[1]['applying'])
        self.engine.finish(13)
        status, data = self.api('status')
        self.assertEqual((data['applying'], data['applyExit']), (False, 13))

    def test_failed_plan_clears_the_confirmable_hash(self):
        self.prepare_plan()
        self.engine.results['plan'] = {'exitCode': 12, 'output': [{'status': 'failed'}]}
        self.api('plan')
        self.assertEqual(self.api('apply', {'planSha256': PLAN_SHA, 'input': self.good_input()})[0], 409)

    def test_rollback_requires_the_displayed_rollback_plan_hash(self):
        self.prepare_plan()
        self.assertEqual(self.api('rollback', {'planSha256': ROLLBACK_SHA})[0], 409)
        self.api('rollback-plan', {'checkpoint': 'images-load'})
        self.assertIn('--checkpoint', self.engine.calls[-1][1])
        self.assertEqual(self.api('rollback', {'planSha256': 'd' * 64})[0], 409)
        self.assertEqual(self.api('rollback', {'planSha256': ROLLBACK_SHA})[0], 200)
        self.assertEqual(self.engine.calls[-1][0], 'rollback')
        self.assertIn(ROLLBACK_SHA, self.engine.calls[-1][1])

    def test_unknown_api_is_rejected(self):
        self.assertEqual(self.api('shell', {'cmd': 'id'})[0], 404)
        self.assertEqual(self.api('__init__')[0], 404)


class EngineProcessTests(unittest.TestCase):
    def test_child_process_boundary_and_output_parsing(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / 'fake_cli.py'
            script.write_text("import json,sys\nprint(json.dumps({'argv': sys.argv[1:], 'stdin': sys.stdin.read()}))\n"
                              "print('not json')\nsys.exit(11)\n", encoding='utf-8')
            engine = wizard.Engine(['--system-id', 'demo'], tmp, cli=script)
            result = engine.run('verify', ['--archive', '/a'], stdin=b'hello')
        self.assertEqual(result['exitCode'], 11)
        self.assertEqual(len(result['output']), 1)
        self.assertEqual(result['output'][0]['argv'], ['verify', '--json', '--system-id', 'demo', '--archive', '/a'])
        self.assertEqual(result['output'][0]['stdin'], 'hello')

    def test_sudo_credential_is_refreshed_while_apply_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / 'slow_cli.py'
            script.write_text('import sys, time\nsys.stdin.read()\ntime.sleep(1.2)\n', encoding='utf-8')
            engine = wizard.Engine([], tmp, cli=script)
            engine.keepalive = 0.2
            refreshed, done = [], threading.Event()
            engine.refresh_sudo = lambda: refreshed.append(1)
            codes = []
            engine.spawn('apply', [], b'{}', lambda code: (codes.append(code), done.set()))
            self.assertTrue(done.wait(10))
        self.assertEqual(codes, [0])
        self.assertGreaterEqual(len(refreshed), 2)

    def test_cli_wizard_command_validates_system_id(self):
        out = []
        self.assertEqual(cli.main(['wizard', '--system-id', 'Bad_Id', '--json'], runner=object(), stream=None), 10)


if __name__ == '__main__':
    unittest.main()
