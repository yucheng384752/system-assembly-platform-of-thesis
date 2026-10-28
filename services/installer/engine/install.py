"""First-install executor and ownership-scoped rollback; no upgrade."""
import json
import os
from pathlib import Path
import re
import time
from urllib.parse import quote
import uuid
from common import Failure, canonical, check_plan, digest, seal, read_json
from detect import current_sources
from license import checked_license

LABEL = 'com.composer.install-id'
STEPS = ['docker-ensure', 'trust-store', 'images-load', 'network-volumes', 'env-secrets',
         'db-init', 'migration', 'license-install', 'guard-up', 'compose-up', 'health-check']
LIMITATIONS = ['硬體綁定由 guard 容器回報、後端比對（不符時警告、寬限 24 小時、封鎖時段才停止服務）；實體品牌機的指紋穩定性、guard 失效行為與緊急臨時授權流程尚待實機驗證，僅能防止搬移與複製，不能保證所有情況',
              '秘密值以 0400 檔案掛入容器，不在容器環境變數；root 與 docker 群組仍可讀取宿主上的檔案',
              '升級遷移、前端、TLS 與實機驗證尚未提供']
BACKEND_UID = 10001  # the generated backend image runs as this user
# Secret file name (under <install>/secrets, mounted at /run/secrets) -> input field.
SECRET_FILES = {'postgres_password': 'POSTGRES_PASSWORD', 'database_url': 'DATABASE_URL', 'secret_key': 'SECRET_KEY',
                'entry_permission_jwt_secret': 'ENTRY_PERMISSION_JWT_SECRET', 'mod_webhook_secret': 'MOD_WEBHOOK_SECRET'}
PUBLIC_ENV = ('POSTGRES_USER', 'POSTGRES_DB', 'DEFAULT_TENANT_ID', 'SYSTEM_ID', 'PROXY_BIND', 'HTTP_PORT',
              'LICENSE_BLOCK_WINDOW', 'LICENSE_TIMEZONE')
WINDOW_PATTERN = r'(daily|[a-z]{3}(?:-[a-z]{3}|(?:,[a-z]{3})*)) ([01][0-9]|2[0-3]):([0-5][0-9])-([01][0-9]|2[0-3]):([0-5][0-9])'


def deployment_names(root):
    """Only the known WP3a mapping layout; refuse unfamiliar layouts instead of parsing YAML loosely."""
    text = (Path(root) / 'deployment/docker-compose.yml').read_text(encoding='utf-8')
    groups = {}
    current = None
    for line in text.splitlines():
        top = re.fullmatch(r'(services|networks|volumes):', line)
        if top:
            current = top.group(1)
            groups[current] = []
        elif line and not line[0].isspace() and not line.startswith('#'):
            current = None
        elif current:
            match = re.fullmatch(r'  ([a-z][a-z0-9_-]*):(?:.*)', line)
            if match:
                groups[current].append(match.group(1))
    if groups != {'services': ['postgres', 'backend', 'init', 'guard', 'proxy'],
                  'networks': ['data', 'edge'], 'volumes': ['database', 'files', 'permissions', 'guard']}:
        raise Failure(11, '部署結構不符合 WP3a；需先審閱新版介面')
    return groups


def make_plan(verified, root, source, detection, install_dir, trust_dir, license_info):
    if not license_info:
        raise Failure(11, '需要授權；請先 issue-license')
    if detection['problems']:
        raise Failure(10, '環境檢查未通過：' + '；'.join(detection['problems']))
    manifest = verified['manifest']
    target = Path(install_dir)
    trust = Path(trust_dir)
    for path in (target, trust):
        if not path.is_absolute() or path == Path(path.anchor) or any(p.is_symlink() for p in (path, *path.parents)):
            raise Failure(10, '安裝或信任庫路徑不安全')
    if target.exists():
        raise Failure(10, '尚未提供升級遷移；首次安裝目錄必須不存在')
    if target == trust or target in trust.parents or trust in target.parents:
        raise Failure(10, '安裝目錄與信任庫不可互相包含')
    names = deployment_names(root)
    pending = [p for p in detection['packages'] if p['installed'] == '(none)']
    for item in pending:
        if not re.fullmatch(r'[A-Za-z0-9.+:~_-]+', item['version']):
            raise Failure(10, '套件版本不合法')
    return seal({'format': 'composer-install-plan', 'version': 1,
                 'package': {'manifestSha256': verified['manifestSha256'],
                             'systemVersion': manifest['systemVersion'], 'systemId': manifest['systemId'],
                             'archiveSha256': verified['archiveSha256'], 'keyFingerprint': verified['keyFingerprint']},
                 'source': source, 'license': license_info,
                 'target': {'os': 'ubuntu-22.04', 'installDir': str(target), 'trustDir': str(trust)},
                 'names': names, 'images': manifest['images'],
                 'steps': [dict(id=step, title=step, privileged=step != 'health-check',
                                reversible='partial' if step in ('docker-ensure', 'db-init', 'migration', 'compose-up') else 'yes',
                                params={'packages': pending} if step == 'docker-ensure' else {},
                                undo='只移除本次建立者；可能已有資料的卷保留並要求人工處理') for step in STEPS],
                 'secretRef': ['POSTGRES_PASSWORD', 'SECRET_KEY', 'ENTRY_PERMISSION_JWT_SECRET', 'admin.password',
                               *(['MOD_WEBHOOK_SECRET'] if 'MOD_WEBHOOK_SECRET_FILE' in (Path(root) / 'deployment/docker-compose.yml').read_text() else [])],
                 'migration': {'mode': 'first-install-only', 'planSha256': None}, 'notProvided': LIMITATIONS})


def override(plan, install_id):
    project = plan['package']['systemId'] + '-' + install_id
    labels = {LABEL: install_id}
    services = {name: {'labels': labels} for name in plan['names']['services']}
    for image in plan['images']:
        for name in image['services']:
            services[name].update(image=image['id'], pull_policy='never')
    # JSON is YAML 1.2 and avoids a new YAML dependency. --no-build disables inherited build entries.
    return { 'services': services,
             **{kind: {name: {'name': project + '_' + name, 'labels': labels}
                       for name in plan['names'][kind]} for kind in ('networks', 'volumes')} }


def private_input(body, plan):
    if not isinstance(body, dict) or set(body) != {'env', 'admin'}:
        raise Failure(10, '輸入必須只包含 env 與 admin')
    env, admin = dict(body['env']), body['admin']
    required = {'POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'SECRET_KEY',
                'ENTRY_PERMISSION_JWT_SECRET', 'DEFAULT_TENANT_ID'}
    if 'MOD_WEBHOOK_SECRET' in plan['secretRef']:
        required.add('MOD_WEBHOOK_SECRET')
    if not required <= env.keys() or set(env) - required - {'PROXY_BIND', 'HTTP_PORT', 'LICENSE_BLOCK_WINDOW', 'LICENSE_TIMEZONE'}:
        raise Failure(10, 'env 欄位缺少或不支援')
    if any(not isinstance(v, str) or not v or any(c in v for c in "\n\r\x00'") for v in env.values()):
        raise Failure(10, 'env 值必須為非空單行字串，且不可含單引號')
    for field in ('POSTGRES_USER', 'POSTGRES_DB'):
        if not re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,62}', env[field]):
            raise Failure(10, 'PostgreSQL 識別名稱不合法')
    for field in ('SECRET_KEY', 'ENTRY_PERMISSION_JWT_SECRET'):
        if len(env[field]) < 32:
            raise Failure(10, '後端秘密值至少需要 32 個字元')
    try:
        uuid.UUID(env['DEFAULT_TENANT_ID'])
        port = int(env.get('HTTP_PORT', '8080'))
        import ipaddress
        ipaddress.IPv4Address(env.get('PROXY_BIND', '127.0.0.1'))
        if not 1 <= port <= 65535:
            raise ValueError()
    except ValueError:
        raise Failure(10, '租戶 UUID、IPv4 綁定位址或連接埠不合法') from None
    window = env.get('LICENSE_BLOCK_WINDOW')
    if window is not None:
        match = re.fullmatch(WINDOW_PATTERN, window)
        weekdays = {'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'}
        days = match.group(1) if match else ''
        # The backend refuses to start on a window it cannot parse, so reject it here instead of at first boot.
        if (not match or (days != 'daily' and not set(re.findall(r'[a-z]{3}', days)) <= weekdays)
                or (int(match.group(4)), int(match.group(5))) <= (int(match.group(2)), int(match.group(3)))):
            raise Failure(10, '封鎖生效時段格式須為「mon-fri 09:00-15:00」，星期須為 mon 至 sun，且結束時間須晚於開始時間')
    zone = env.get('LICENSE_TIMEZONE')
    if zone is not None:
        from zoneinfo import ZoneInfo
        try:
            ZoneInfo(zone)
        except Exception:
            raise Failure(10, '時區不合法（需為 IANA 名稱，例如 Asia/Taipei）') from None
    if not isinstance(admin, dict) or set(admin) != {'username', 'password', 'display_name'}:
        raise Failure(10, '管理員輸入格式不符')
    if any(not isinstance(v, str) or not v for v in admin.values()):
        raise Failure(10, '管理員輸入不得為空')
    if len(admin['password']) <= 8 or len(admin['password'].encode('utf-8')) > 72:
        raise Failure(10, '管理員密碼需超過 8 字元且不超過 72 UTF-8 bytes')
    if any(len(admin[k]) > 100 for k in ('username', 'display_name')):
        raise Failure(10, '管理員名稱最多 100 字元')
    if len(canonical(admin)) > 16384:
        raise Failure(10, '管理員輸入過大')
    env['SYSTEM_ID'] = plan['package']['systemId']
    env['DATABASE_URL'] = ('postgresql+asyncpg://' + env['POSTGRES_USER'] + ':' + quote(env['POSTGRES_PASSWORD'], safe='')
                           + '@postgres:5432/' + env['POSTGRES_DB'])
    return env, admin


class Installer:
    def __init__(self, runner, journal, plan, state=None, key_pem=None, license_path=None, sys_root='/sys'):
        self.runner, self.journal, self.plan = runner, journal, plan
        self.directory = journal.directory
        self.target = Path(plan['target']['installDir'])
        self.state = state or {'format': 'composer-install-state', 'version': 1, 'installId': uuid.uuid4().hex[:12],
                               'planSha256': plan['planSha256'], 'steps': {}, 'status': 'planned', 'retained': []}
        self.install_id = self.state['installId']
        self.project = plan['package']['systemId'] + '-' + self.install_id
        self.key_pem = key_pem
        self.license_path, self.sys_root = license_path, sys_root

    def save(self):
        self.journal.save(self.state)

    def docker(self, args, **kwargs):
        return self.runner.run(['docker', *args], privileged=True, **kwargs)

    def compose(self, args, **kwargs):
        return self.docker(['compose', '-p', self.project, '--project-directory', str(self.target / 'deployment'),
                            '--env-file', str(self.target / '.env'), '-f', str(self.target / 'deployment/docker-compose.yml'),
                            '-f', str(self.target / 'compose.override.yml'), *args], **kwargs)

    def remember(self, step, item):
        if item['kind'] == 'containers':
            item['before'] = self.docker(['container', 'ls', '-aq', '--no-trunc', '--filter',
                                          'label=' + LABEL + '=' + self.install_id]).stdout.decode().split()
        self.state['steps'][step]['undo'].append(item)
        self.save()  # Write intent before a side effect, including effects whose command may fail halfway.

    def image_exists(self, image_id):
        result = self.docker(['image', 'ls', '--all', '--no-trunc', '--quiet'])
        return image_id in result.stdout.decode().splitlines()

    def create_fs(self, step, kind, path, action, **kwargs):
        item = {'kind': kind, 'path': str(path), 'created': False}
        self.remember(step, item)
        self.runner.fs(action, path, **kwargs)
        item['created'] = True
        self.save()

    def run_step(self, step, root, env, admin):
        if step == 'docker-ensure':
            self.runner.run(['sudo', '-v']) if hasattr(os, 'geteuid') and os.geteuid() != 0 else None
            for item in self.plan['steps'][0]['params']['packages']:
                current = self.runner.run(['dpkg-query', '-W', '-f=${Status}', item['name']], check=False)
                if current.returncode == 0 and current.stdout == b'install ok installed':
                    continue
                self.remember(step, {'kind': 'package', 'name': item['name']})
                self.runner.run(['apt-get', 'install', '-y', item['name'] + '=' + item['version']], privileged=True)
            self.docker(['info'])
            self.docker(['compose', 'version'])
        elif step == 'trust-store':
            trust = Path(self.plan['target']['trustDir'])
            key = trust / 'root.pem'
            if not trust.exists():
                self.create_fs(step, 'directory', trust, 'mkdir')
            if not key.exists():
                if self.key_pem is None:
                    raise Failure(11, '缺少已驗證公鑰')
                self.create_fs(step, 'file', key, 'write', text=self.key_pem)
            if self.target.exists():
                raise Failure(10, '首次安裝目錄已存在')
            self.create_fs(step, 'directory', self.target, 'copy', source=str(root))
            self.create_fs(step, 'file', self.target / 'compose.override.yml', 'write',
                           text=canonical(override(self.plan, self.install_id)).decode() + '\n')
        elif step == 'images-load':
            for image in self.plan['images']:
                existed = self.image_exists(image['id'])
                item = {'kind': 'image', 'id': image['id'], 'loadedId': None, 'tag': image['tag'], 'existed': existed}
                self.remember(step, item)
                if not existed:
                    # Preserve unrelated tag mappings; never overwrite an existing tag with another image.
                    tag = self.docker(['image', 'inspect', '--format', '{{.Id}}', image['tag']], check=False)
                    if tag.returncode == 0 and tag.stdout.decode().strip() != image['id']:
                        raise Failure(13, '映像標籤已由其他映像使用')
                    self.docker(['load', '--input', str(self.target / image['archive'])])
                actual = self.docker(['image', 'inspect', '--format', '{{.Id}}', image['id']]).stdout.decode().strip()
                item['loadedId'] = actual
                self.save()
                if actual != image['id']:
                    self.retain('image', actual, '載入後身分異常，無法安全自動移除未知映像')
                    raise Failure(11, '載入後映像 ID 與 manifest 不符')
                if not existed:
                    tagged = self.docker(['image', 'inspect', '--format', '{{.Id}}', image['tag']]).stdout.decode().strip()
                    if tagged != image['id']:
                        raise Failure(11, '載入後映像標籤與 manifest 不符')
        elif step == 'network-volumes':
            for kind, names in [('network', self.plan['names']['networks']), ('volume', self.plan['names']['volumes'])]:
                for name in names:
                    resource = self.project + '_' + name
                    existing = self.docker([kind, 'ls', '--format', '{{.Name}}']).stdout.decode().splitlines()
                    if resource in existing:
                        raise Failure(13, '資源已存在；拒絕取得原有資源所有權')
                    self.remember(step, {'kind': kind, 'name': resource, 'logicalName': name})
                    self.docker([kind, 'create', '--label', LABEL + '=' + self.install_id,
                                 '--label', 'com.docker.compose.project=' + self.project,
                                 '--label', 'com.docker.compose.' + kind + '=' + name,
                                 *(['--internal'] if kind == 'network' and name == 'data' else []), resource])
        elif step == 'env-secrets':
            secrets = self.target / 'secrets'
            self.create_fs(step, 'directory', secrets, 'mkdir', mode=0o700)
            for filename, name in SECRET_FILES.items():
                if name in env:
                    # The backend (UID 10001) reads its files through the bind mount; PostgreSQL's entrypoint runs as root.
                    owner = {} if filename == 'postgres_password' else {'owner': [BACKEND_UID, BACKEND_UID]}
                    self.create_fs(step, 'file', secrets / filename, 'write', mode=0o400, text=env[name], **owner)
            public = {name: env[name] for name in PUBLIC_ENV if name in env}
            public.update(LICENSE_DIR=str(self.target / 'license'), ROOT_KEY_FILE=str(Path(self.plan['target']['trustDir']) / 'root.pem'),
                          MANIFEST_FILE=str(self.target / 'system-manifest.json'))
            self.create_fs(step, 'file', self.target / '.env', 'write', mode=0o600,
                           text=''.join(name + "='" + value + "'\n" for name, value in sorted(public.items())))
        elif step == 'db-init':
            self.remember(step, {'kind': 'containers'})
            self.state['dataMayExist'] = True
            self.save()
            self.compose(['up', '-d', '--wait', '--wait-timeout', '180', '--no-build', '--pull', 'never', 'postgres'])
        elif step == 'migration':
            self.remember(step, {'kind': 'database'})
            self.remember(step, {'kind': 'containers'})
            self.compose(['--profile', 'init', 'run', '--rm', '-T', '--no-build', '--pull', 'never', 'init', 'python', '-m', 'app.system_init'])
            self.compose(['--profile', 'init', 'run', '--rm', '-T', '--no-build', '--pull', 'never', 'init',
                          'python', '-m', 'app.secret_files', 'app.entry_permission.create_admin'], data=canonical(admin))
        elif step == 'guard-up':
            self.remember(step, {'kind': 'containers'})
            # Start the guard first so its first report exists when the backend starts.
            self.compose(['up', '-d', '--wait', '--wait-timeout', '180', '--no-build', '--pull', 'never', 'guard'])
        elif step == 'compose-up':
            self.remember(step, {'kind': 'containers'})
            # Wait for backend before starting nginx to avoid its DNS/startup race.
            self.compose(['up', '-d', '--wait', '--wait-timeout', '180', '--no-build', '--pull', 'never', 'backend'])
            self.compose(['up', '-d', '--wait', '--wait-timeout', '180', '--no-build', '--pull', 'never', 'proxy'])
        elif step == 'license-install':
            try:
                raw, info = checked_license(self.runner, self.license_path,
                                            {'keyPem': self.key_pem, 'manifestSha256': self.plan['package']['manifestSha256']},
                                            current_sources(self.runner, self.sys_root))
                if info != self.plan['license']:
                    raise Failure(12, '授權與計畫不符')
            except (Failure, TypeError):
                raise Failure(12, '授權或硬體與已確認計畫不符') from None
            directory = self.target / 'license'
            if not directory.exists():
                # The backend replaces license.lic when a new license is uploaded, so it must own the directory.
                self.create_fs(step, 'directory', directory, 'mkdir', mode=0o755, owner=[BACKEND_UID, BACKEND_UID])
            self.create_fs(step, 'file', directory / 'license.lic', 'write', text=raw.decode('utf-8'), mode=0o644,
                           owner=[BACKEND_UID, BACKEND_UID])
        elif step == 'health-check':
            self.compose(['exec', '-T', 'backend', 'python', '-c',
                          "import urllib.request; urllib.request.urlopen('http://proxy/healthz', timeout=10)"])
            # The running backend must itself accept the license (chain, expiry, manifest) and the guard's report must
            # match it: this closes the loop from issuance on the host to the container's view of the same machine.
            self.compose(['exec', '-T', 'backend', 'python', '-c',
                          "import json, sys, time, urllib.request\n"
                          "for _ in range(30):\n"
                          " status = json.load(urllib.request.urlopen('http://proxy/api/license/status', timeout=10))\n"
                          " if status.get('valid') is True and status['hardware']['status'] == 'match':\n"
                          "  sys.exit(0)\n"
                          " time.sleep(2)\n"
                          "sys.exit(1)"])
        else:
            raise Failure(10, '尚未提供此步驟')

    def apply(self, root, body):
        env, admin = private_input(body, self.plan)
        # Only secrets are redacted; public identifiers in state must retain their identity.
        self.journal.secrets = [env[k] for k in ('POSTGRES_PASSWORD', 'SECRET_KEY', 'ENTRY_PERMISSION_JWT_SECRET', 'DATABASE_URL')]
        self.journal.secrets += [admin['password'], quote(env['POSTGRES_PASSWORD'], safe='')]
        if 'MOD_WEBHOOK_SECRET' in env:
            self.journal.secrets.append(env['MOD_WEBHOOK_SECRET'])
        self.journal.secrets.sort(key=len, reverse=True)
        self.state['status'] = 'running'
        self.save()
        for step in STEPS:
            if (self.directory / 'cancel.request').exists():
                self.state['status'] = 'cancelled'
                self.save()
                self.journal.event(step, 'cancelled', '已取消；目前完成點保留')
                return 15
            entry = {'status': 'started', 'startedAt': time.time(), 'undo': []}
            self.state['steps'][step] = entry
            self.save()
            self.journal.event(step, 'started', step, True)
            try:
                self.run_step(step, root, env, admin)
            except Exception as error:
                entry['status'] = 'failed'
                entry['endedAt'] = time.time()
                self.save()
                message = str(error) if isinstance(error, Failure) else '執行或狀態寫入失敗'
                self.journal.event(step, 'failed', message + '；正在還原此步驟', True)
                try:
                    self.undo_step(step)
                    code = 14 if self.state['retained'] else (12 if isinstance(error, Failure) and error.code == 12 else 13)
                except Exception:
                    code = 14
                self.state['status'] = 'failed'
                self.save()
                self.journal.event(step, 'failed', '需人工處理，現場已保留' if code == 14 else '已還原到上一個完成點')
                return code
            entry.update(status='ok', endedAt=time.time())
            self.save()
            self.journal.event(step, 'ok', '步驟完成', True)
            if (self.directory / 'cancel.request').exists():
                self.state['status'] = 'cancelled'
                self.save()
                self.journal.event(step, 'cancelled', '已取消；目前完成點保留')
                return 15
        self.state['status'] = 'ok'
        self.save()
        return 0

    def owned(self, kind, name):
        result = self.docker([kind, 'inspect', name], check=False)
        if result.returncode:
            # A failed inspect is not proof of absence (daemon/permission may be down).
            listing = self.docker([kind, 'ls', *(['-a', '--no-trunc'] if kind == 'container' else []),
                                   '--format', '{{.ID}}' if kind == 'container' else '{{.Name}}'])
            if any(name in line.split() for line in listing.stdout.decode().splitlines()):
                raise Failure(14, '資源存在但無法檢查所有權')
            return None
        info = json.loads(result.stdout)[0]
        labels = info.get('Config', {}).get('Labels', {}) if kind == 'container' else info.get('Labels', {})
        return (labels or {}).get(LABEL) == self.install_id

    def retain(self, kind, name, reason):
        self.state['retained'].append({'kind': kind, 'name': name, 'reason': reason})
        self.save()
        self.journal.event('rollback', 'warn', reason + '：' + name)

    def undo_step(self, step):
        entry = self.state['steps'][step]
        for item in reversed(entry['undo']):
            if item.get('undone'):
                continue
            kind = item['kind']
            if kind == 'containers':
                result = self.docker(['container', 'ls', '-aq', '--no-trunc', '--filter', 'label=' + LABEL + '=' + self.install_id])
                for name in result.stdout.decode().split():
                    if name not in item['before'] and self.owned('container', name):
                        self.docker(['container', 'rm', '-f', name])
            elif kind in ('network', 'volume'):
                ownership = self.owned(kind, item['name'])
                if ownership is False:
                    self.retain(kind, item['name'], '標籤不屬於本次安裝，保留')
                elif ownership:
                    if kind == 'volume' and self.state.get('dataMayExist'):
                        self.retain(kind, item['name'], '可能已有資料，保留；請人工確認並使用備份')
                    else:
                        self.docker([kind, 'rm', item['name']])
            elif kind == 'image':
                if not item['existed'] and self.image_exists(item['id']):
                    users = self.docker(['container', 'ls', '-aq', '--filter', 'ancestor=' + item['id']])
                    if users.stdout.strip():
                        self.retain(kind, item['id'], '仍有容器使用映像')
                    else:
                        self.docker(['image', 'rm', item['id']])
            elif kind == 'package':
                populated = any(self.docker(command).stdout.strip() for command in (
                    ['container', 'ls', '-aq'], ['image', 'ls', '-q'], ['volume', 'ls', '-q']))
                if populated:
                    self.retain(kind, item['name'], '主機仍有 Docker 物件，保留套件')
                else:
                    self.runner.run(['apt-get', 'remove', '-y', item['name']], privileged=True)
            elif kind == 'database':
                self.retain(kind, self.project + '_database', '首次建表可能已寫入租戶與管理員資料；請人工確認並使用備份')
            elif kind in ('file', 'directory'):
                path = Path(item['path'])
                trust = Path(self.plan['target']['trustDir'])
                secrets = self.target / 'secrets'
                if path not in (self.target, trust, trust / 'root.pem', self.target / '.env', self.target / 'compose.override.yml',
                                self.target / 'license', self.target / 'license/license.lic', secrets,
                                *(secrets / name for name in SECRET_FILES)):
                    raise Failure(14, '還原路徑不在本次固定寫入範圍')
                # Preserve retained-volume recovery material, especially .env, instead of destroying credentials.
                if not item.get('created') and path.exists():
                    self.retain(kind, str(path), '未取得建立完成回覆，保留以免刪除其他程序建立的檔案')
                elif step == 'license-install' and item.get('created'):
                    if path.exists():
                        self.runner.fs('rmdir' if kind == 'directory' else 'remove', path)
                elif (path == self.target / '.env' or secrets in (path, *path.parents)) and self.state.get('dataMayExist'):
                    self.retain(kind, str(path), '資料卷可能已有資料，保留復原所需秘密檔')
                elif kind == 'directory' and any(Path(r['name']).is_relative_to(path)
                                                 for r in self.state['retained'] if r['kind'] in ('file', 'directory')):
                    self.retain(kind, str(path), '內有需保留的檔案，不遞迴刪除')
                elif self.state['retained'] and (path == self.target or self.target in path.parents):
                    self.retain(kind, str(path), '保留資料的復原設定，需人工處理')
                elif path.exists():
                    self.runner.fs('remove', path)
            item['undone'] = True
            self.save()
        entry.update(status='rolled-back', endedAt=time.time())
        self.save()
        self.journal.event(step, 'rolled-back', '還原步驟完成；保留項目另列', True)

    def rollback_plan(self, checkpoint=None):
        if checkpoint is not None and (checkpoint not in STEPS or self.state['steps'].get(checkpoint, {}).get('status') != 'ok'):
            raise Failure(10, '還原完成點不存在')
        after = STEPS.index(checkpoint) + 1 if checkpoint else 0
        return seal({'format': 'composer-rollback-plan', 'version': 1, 'installId': self.install_id,
                     'stateSha256': digest(canonical(self.state)), 'checkpoint': checkpoint,
                     'steps': [step for step in reversed(STEPS[after:]) if self.state['steps'].get(step, {}).get('status') in ('ok', 'failed', 'started')],
                     'warnings': ['可能已有資料的卷與復原設定會保留；不冒充完整還原']})

    def rollback(self, plan, confirmation):
        check_plan(plan, confirmation)
        if plan != self.rollback_plan(plan.get('checkpoint')):
            raise Failure(12, '還原計畫已過期或與狀態不符')
        try:
            for step in plan['steps']:
                self.undo_step(step)
        except Exception:
            self.state['status'] = 'rollback-failed'
            self.save()
            self.journal.event('rollback', 'failed', '還原失敗；保留現場，不自動重試')
            return 14
        self.state['status'] = 'rolled-back'
        self.save()
        return 14 if self.state['retained'] else 0
