"""Local web wizard (WP3c). Every screen maps to one engine subcommand; no install logic lives here."""
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from common import Failure

STATIC = Path(__file__).with_name('wizard_static')
PAGES = {'': ('index.html', 'text/html; charset=utf-8'), 'app.js': ('app.js', 'text/javascript; charset=utf-8'),
         'style.css': ('style.css', 'text/css; charset=utf-8')}
MAX_BODY = 131072
HEX64 = re.compile(r'[a-f0-9]{64}')
SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
                               "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
}


class Reject(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def text_field(body, name, pattern=None, limit=4096):
    value = body.get(name)
    if not isinstance(value, str) or not value or len(value) > limit or any(c in value for c in '\x00\r\n'):
        raise Reject(400, '欄位不合法：' + name)
    if pattern and not re.fullmatch(pattern, value):
        raise Reject(400, '欄位格式不符：' + name)
    return value


def path_field(body, name):
    value = text_field(body, name)
    if not value.startswith('/'):  # the wizard only runs on Ubuntu; keep the rule platform independent
        raise Reject(400, '需要絕對路徑：' + name)
    return value


class Engine:
    """Runs the CLI as a child process so the wizard never imports installer internals."""

    def __init__(self, base, workdir, python=None, cli=None):
        self.base = list(base)
        self.workdir = Path(workdir)
        self.python = python or sys.executable
        self.cli = str(cli or Path(__file__).with_name('cli.py'))
        self.keepalive = 240

    def argv(self, command, extra):
        return [self.python, '-B', self.cli, command, '--json', *self.base, *extra]

    def run(self, command, extra=(), stdin=None):
        # Secrets travel on stdin only; argv carries paths, hashes and the public key prefix.
        try:
            done = subprocess.run(self.argv(command, extra), input=stdin, stdout=subprocess.PIPE,
                                  stderr=subprocess.DEVNULL, timeout=3600, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return {'exitCode': 10, 'output': [{'status': 'failed', 'message': '引擎無法執行'}]}
        output = []
        for line in done.stdout.decode('utf-8', errors='replace').splitlines():
            try:
                output.append(json.loads(line))
            except ValueError:
                continue
        return {'exitCode': done.returncode, 'output': output}

    def spawn(self, command, extra, stdin, finished):
        process = subprocess.Popen(self.argv(command, extra), stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        process.stdin.write(stdin)
        process.stdin.close()

        def watch():
            # sudo's cached credential expires (about 15 minutes) before a 30 minute install ends; keep it fresh.
            while True:
                try:
                    code = process.wait(timeout=self.keepalive)
                    break
                except subprocess.TimeoutExpired:
                    self.refresh_sudo()
            finished(code)
        threading.Thread(target=watch, daemon=True).start()

    def refresh_sudo(self):
        try:
            subprocess.run(['sudo', '-n', '-v'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False, timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            pass

    def sudo_ready(self):
        try:
            return subprocess.run(['sudo', '-n', 'true'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  check=False, timeout=15).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False


class Wizard:
    def __init__(self, engine, system_id):
        self.engine, self.system_id = engine, system_id
        self.lock = threading.Lock()
        self.source = None
        self.license_ready = False
        self.plan_sha = None
        self.rollback_sha = None
        self.applying = False
        self.apply_exit = None
        work = engine.workdir
        self.license_path, self.plan_path, self.rollback_path = (str(work / n) for n in ('license.lic', 'plan.json', 'rollback.json'))

    def source_args(self, body):
        source = {name: path_field(body, name) for name in ('archive', 'signature', 'key')}
        prefix = text_field(body, 'prefix', r'[0-9a-fA-F]{8}')
        self.source = ['--archive', source['archive'], '--signature', source['signature'], '--key', source['key'],
                       '--confirm-key-prefix', prefix]
        return self.source

    def known_source(self):
        if not self.source:
            raise Reject(409, '請先完成驗證安裝包')
        return self.source

    def handle(self, name, body):
        method = getattr(self, 'do_' + name.replace('-', '_'), None)
        if not method:
            raise Reject(404, '找不到')
        return method(body)

    def do_config(self, body):
        return {'systemId': self.system_id, 'workdir': str(self.engine.workdir),
                'licenseIssued': self.license_ready, 'applying': self.applying}

    def do_detect(self, body):
        return self.engine.run('detect')

    def do_verify(self, body):
        return self.engine.run('verify', self.source_args(body))

    def do_issue_license(self, body):
        source = self.known_source()
        secret = {'passphrase': text_field(body, 'passphrase', limit=1024),
                  'expiresAt': text_field(body, 'expiresAt', r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z', 20)}
        extra = [*source, '--subkey', path_field(body, 'subkey'), '--certificate', path_field(body, 'certificate'),
                 '--out', self.license_path]
        if self.license_ready:
            Path(self.license_path).unlink(missing_ok=True)  # our own earlier output; the engine never overwrites
            self.license_ready = False
        result = self.engine.run('issue-license', extra, json.dumps(secret).encode('utf-8'))
        self.license_ready = result['exitCode'] == 0
        return result

    def do_plan(self, body):
        if not self.license_ready:
            raise Reject(409, '請先簽發授權')
        result = self.engine.run('plan', [*self.known_source(), '--license', self.license_path, '--plan', self.plan_path])
        plan = next((o for o in result['output'] if o.get('format') == 'composer-install-plan'), None)
        self.plan_sha = plan['planSha256'] if result['exitCode'] == 0 and plan else None
        return result

    def need_sudo(self):
        if not self.engine.sudo_ready():
            raise Reject(409, '尚未取得 sudo 權限；請在終端機執行 sudo -v 後重試（密碼不經過瀏覽器）')

    def do_apply(self, body):
        confirmed = text_field(body, 'planSha256', r'[a-f0-9]{64}', 64)
        if not self.plan_sha or not hmac.compare_digest(confirmed, self.plan_sha):
            raise Reject(409, '確認的計畫與畫面上顯示的不一致；請重新產生計畫')
        if not isinstance(body.get('input'), dict):
            raise Reject(400, '缺少安裝設定')
        self.need_sudo()
        with self.lock:
            if self.applying:
                raise Reject(409, '已有安裝正在進行')
            self.applying, self.apply_exit = True, None

        def finished(code):
            self.apply_exit, self.applying = code, False
        try:
            self.engine.spawn('apply', ['--plan', self.plan_path, '--plan-sha256', confirmed, '--license', self.license_path],
                              json.dumps(body['input']).encode('utf-8'), finished)
        except OSError:
            self.applying = False
            raise Reject(500, '無法啟動安裝')
        return {'started': True}

    def do_status(self, body):
        result = self.engine.run('status')
        return {**result, 'applying': self.applying, 'applyExit': self.apply_exit}

    def do_cancel(self, body):
        return self.engine.run('cancel')

    def do_rollback_plan(self, body):
        extra = ['--plan', self.plan_path, '--rollback-plan', self.rollback_path]
        if body.get('checkpoint') is not None:
            extra += ['--checkpoint', text_field(body, 'checkpoint', r'[a-z0-9-]{1,40}', 40)]
        result = self.engine.run('rollback', extra)
        plan = next((o for o in result['output'] if o.get('format') == 'composer-rollback-plan'), None)
        self.rollback_sha = plan['planSha256'] if result['exitCode'] == 0 and plan else None
        return result

    def do_rollback(self, body):
        confirmed = text_field(body, 'planSha256', r'[a-f0-9]{64}', 64)
        if not self.rollback_sha or not hmac.compare_digest(confirmed, self.rollback_sha):
            raise Reject(409, '確認的還原計畫與畫面上顯示的不一致')
        self.need_sudo()
        return self.engine.run('rollback', ['--plan', self.plan_path, '--rollback-plan', self.rollback_path,
                                            '--plan-sha256', confirmed])


def handler_for(wizard, token, port):
    allowed_hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
    allowed_origins = {'http://' + host for host in allowed_hosts}
    prefix = '/' + token + '/'

    class Handler(BaseHTTPRequestHandler):
        server_version = 'ComposerWizard'
        sys_version = ''

        def log_message(self, *args):
            pass  # request lines contain the one-time token

        def reply(self, status, body, content_type='application/json; charset=utf-8'):
            data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            for key, value in SECURITY_HEADERS.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(data)

        def authorize(self):
            if self.headers.get('Host') not in allowed_hosts:
                raise Reject(403, '主機標頭不符')  # DNS rebinding
            path = self.path.split('?', 1)[0]
            if not hmac.compare_digest(path[:len(prefix)].encode('utf-8', 'replace'), prefix.encode()):
                raise Reject(403, '權杖不符')
            return path[len(prefix):]

        def do_GET(self):
            try:
                name = self.authorize()
                if name not in PAGES:
                    raise Reject(404, '找不到')
                file, kind = PAGES[name]
                self.reply(200, (STATIC / file).read_bytes(), kind)
            except Reject as error:
                self.reply(error.status, {'message': error.message})

        def do_POST(self):
            try:
                name = self.authorize()
                if not name.startswith('api/'):
                    raise Reject(404, '找不到')
                origin = self.headers.get('Origin')
                if origin is not None and origin not in allowed_origins:
                    raise Reject(403, '來源不符')
                if self.headers.get('Content-Type', '').split(';')[0].strip() != 'application/json':
                    raise Reject(415, '需要 JSON')
                try:
                    length = int(self.headers.get('Content-Length', ''))
                except ValueError:
                    raise Reject(411, '需要 Content-Length') from None
                if not 0 <= length <= MAX_BODY:
                    raise Reject(413, '請求過大')
                try:
                    body = json.loads(self.rfile.read(length) or b'{}')
                except ValueError:
                    raise Reject(400, 'JSON 不合法') from None
                if not isinstance(body, dict):
                    raise Reject(400, '需要 JSON 物件')
                self.reply(200, wizard.handle(name[4:], body))
            except Reject as error:
                self.reply(error.status, {'message': error.message})
            except Failure as error:
                self.reply(400, {'message': str(error)})

    return Handler


def serve(system_id, base, port=0, announce=lambda message: print(message, flush=True), workdir=None, engine=None, ready=None):
    work = Path(workdir or tempfile.mkdtemp(prefix='composer-wizard-'))
    work.mkdir(mode=0o700, exist_ok=True)
    wizard = Wizard(engine or Engine(base, work), system_id)
    token = secrets.token_urlsafe(24)
    server = ThreadingHTTPServer(('127.0.0.1', port), lambda *a: None)
    bound = server.server_address[1]
    server.RequestHandlerClass = handler_for(wizard, token, bound)
    announce(f'精靈已啟動（只監聽本機）：http://127.0.0.1:{bound}/{token}/')
    announce(f'暫存目錄（含授權與計畫，還原時需要）：{work}')
    if ready:
        ready(server, token, wizard)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
