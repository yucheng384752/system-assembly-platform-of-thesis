"""Authenticate before extraction; reject links, special files and unlisted data."""
import base64
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import tempfile
from common import Failure, digest, file_digest, read_json


def safe_path(name):
    if (not isinstance(name, str) or not name or '\\' in name or ':' in name
            or name.startswith('/') or any(p in ('', '.', '..') for p in name.split('/'))):
        raise Failure(11, '安裝包路徑不安全')
    return PurePosixPath(name)


def validate_manifest(manifest, root):
    if manifest.get('format') != 'composer-system-assembly' or not isinstance(manifest.get('files'), list):
        raise Failure(11, 'system-manifest 格式不符')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,49}', manifest.get('systemId', '')):
        raise Failure(11, 'systemId 必須為 1 至 50 個小寫英數字或連字號')
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', manifest.get('systemVersion', '')):
        raise Failure(11, '缺少合法 systemVersion；schemaVersion 不代表系統版本')
    listed = {'system-manifest.json'}
    for entry in manifest['files']:
        name = str(safe_path(entry['path']))
        if name in listed:
            raise Failure(11, 'manifest 路徑重複')
        listed.add(name)
        path = root / name
        if not path.is_file() or file_digest(path) != entry['sha256'] or path.stat().st_size != entry['bytes']:
            raise Failure(11, 'manifest 檔案 sha256 或 bytes 不符：' + name)
    if listed != {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file()}:
        raise Failure(11, '安裝包含未列入 manifest 的檔案')
    images = manifest.get('images')
    if not isinstance(images, list) or not images:
        raise Failure(11, '缺少 images／映像 ID；請依 installer 欄位草案封裝')
    services = set()
    for image in images:
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', image.get('id', '')):
            raise Failure(11, '映像 ID 不合法')
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/:@-]*', image.get('tag', '')):
            raise Failure(11, '映像標籤名稱不合法')
        archive = str(safe_path(image['archive']))
        if archive not in listed or not isinstance(image.get('services'), list) or not image['services']:
            raise Failure(11, '映像封存檔或 services 缺少')
        with tarfile.open(root / archive, 'r:*') as saved:
            for member in saved.getmembers():
                safe_path(member.name.rstrip('/') if member.isdir() else member.name)
                if not (member.isfile() or member.isdir()):
                    raise Failure(11, '映像封存檔含連結或特殊檔案')
            metadata = json.load(saved.extractfile('manifest.json'))
            if len(metadata) != 1 or metadata[0].get('RepoTags') != [image['tag']]:
                raise Failure(11, '每個映像封存檔須只含 manifest 指定的一個映像與標籤')
            config = str(safe_path(metadata[0]['Config']))
            if 'sha256:' + digest(saved.extractfile(config).read()) != image['id']:
                raise Failure(11, '映像 config digest 與映像 ID 不符')
        for service in image['services']:
            if service not in ('postgres', 'backend', 'init', 'guard', 'proxy') or service in services:
                raise Failure(11, '映像 service 重複或不支援')
            services.add(service)
    if services != {'postgres', 'backend', 'init', 'guard', 'proxy'}:
        raise Failure(11, '映像未覆蓋全部 WP3a services')
    for required in ('deployment/docker-compose.yml', 'deployment/nginx.conf', 'deployment/.env.example'):
        if required not in listed:
            raise Failure(11, '缺少部署產物：' + required)
    if any(Path(name).name in ('.env', 'compose.override.yml') for name in listed):
        raise Failure(11, '安裝包不得預先夾帶 .env 或 compose.override.yml')


def verify(runner, archive, signature, key, prefix, destination):
    """Destination must be an empty private directory owned by this invocation."""
    destination = Path(destination)
    try:
        envelope = read_json(signature)
        if (set(envelope) != {'payload', 'signature', 'algorithm'}
                or envelope['algorithm'] != 'RSA-PSS-SHA256' or not isinstance(envelope['payload'], str)):
            raise Failure(11, '簽章信封格式不符')
        key_pem = Path(key).read_text(encoding='utf-8')
        with tempfile.TemporaryDirectory(prefix='composer-signature-') as tmp:
            stable_key = Path(tmp) / 'root.pem'
            stable_key.write_text(key_pem, encoding='utf-8')
            der = runner.run(['openssl', 'pkey', '-pubin', '-in', str(stable_key), '-outform', 'DER']).stdout
            fingerprint = digest(der)
            if not re.fullmatch(r'[a-fA-F0-9]{8}', prefix or '') or not fingerprint.startswith(prefix.lower()):
                raise Failure(11, '根公鑰 SPKI 指紋前 8 碼不符')
            payload_file, signature_file = Path(tmp) / 'payload', Path(tmp) / 'signature'
            payload_file.write_bytes(envelope['payload'].encode('utf-8'))
            signature_file.write_bytes(base64.b64decode(envelope['signature'], validate=True))
            result = runner.run(['openssl', 'dgst', '-sha256', '-sigopt', 'rsa_padding_mode:pss',
                                 '-sigopt', 'rsa_pss_saltlen:32', '-verify', str(stable_key),
                                 '-signature', str(signature_file), str(payload_file)], check=False)
            if result.returncode:
                raise Failure(11, '安裝包簽章不符')
        payload = json.loads(envelope['payload'])
        for field in ('sha256', 'systemManifestSha256'):
            if not re.fullmatch(r'[a-f0-9]{64}', payload.get(field, '')):
                raise Failure(11, '簽章 payload 缺少雜湊：' + field)
        # Keep the same open file through hash and extraction to avoid pathname replacement.
        with open(archive, 'rb') as source:
            import hashlib
            checksum = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                checksum.update(chunk)
            if checksum.hexdigest() != payload['sha256']:
                raise Failure(11, 'tar.gz sha256 不符')
            source.seek(0)
            with tarfile.open(fileobj=source, mode='r:gz') as tar:
                names = set()
                members = tar.getmembers()
                for member in members:
                    name = str(safe_path(member.name.rstrip('/') if member.isdir() else member.name))
                    if name in names or not (member.isfile() or member.isdir()):
                        raise Failure(11, '安裝包含重複路徑、連結或特殊檔案')
                    names.add(name)
                for member in members:
                    target = destination / member.name
                    if member.isdir():
                        target.mkdir(parents=True, exist_ok=True)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with tar.extractfile(member) as src, open(target, 'xb') as dst:
                            import shutil
                            shutil.copyfileobj(src, dst)
        manifest_file = destination / 'system-manifest.json'
        if file_digest(manifest_file) != payload['systemManifestSha256']:
            raise Failure(11, 'system-manifest sha256 不符')
        manifest = read_json(manifest_file)
        validate_manifest(manifest, destination)
        return dict(manifest=manifest, manifestSha256=payload['systemManifestSha256'],
                    archiveSha256=payload['sha256'], keyFingerprint=fingerprint, keyPem=key_pem, license='skipped')
    except Failure as error:
        if error.code != 11:
            raise Failure(11, '簽章驗證工具失敗') from None
        raise
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError):
        raise Failure(11, '安裝包或簽章資料損毀') from None
