"""License v3 boundaries; OpenSSL signs/verifies, private keys stay encrypted on disk."""
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
from common import Failure, canonical, digest, read_json


def timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', value):
        raise ValueError('Invalid timestamp')
    return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)


def shape(value, fields):
    if not isinstance(value, dict) or set(value) != set(fields.split()):
        raise ValueError('Invalid fields')


def text(value, minimum, maximum):
    if not isinstance(value, str) or not minimum <= len(value) <= maximum:
        raise ValueError('Invalid text')


def pattern(value, expression):
    if not isinstance(value, str) or not re.fullmatch(expression, value):
        raise ValueError('Invalid pattern')


def licensee(value):
    shape(value, 'name')
    text(value['name'], 1, 100)


def envelope(value):
    shape(value, 'payload signature algorithm')
    text(value['payload'], 2, 65536)
    text(value['signature'], 1, 1024)
    pattern(value['signature'], r'[A-Za-z0-9+/]+={0,2}')
    if value['algorithm'] != 'RSA-PSS-SHA256':
        raise ValueError('Invalid algorithm')


def sources(value):
    if not isinstance(value, list):
        raise ValueError('Invalid sources')
    for item in value:
        shape(item, 'source sha256')
        pattern(item['source'], r'(product_uuid|product_serial|board_serial|chassis_serial|(?:mac|disk):[^/\s]+)')
        pattern(item['sha256'], r'[a-f0-9]{64}')


def payload_shape(value):
    shape(value, 'schemaVersion issuedAt expiresAt licensee systemId recipe enabledKits fingerprint packageManifestSha256')
    if value['schemaVersion'] != '3.0':
        raise ValueError('Invalid version')
    timestamp(value['issuedAt'])
    timestamp(value['expiresAt'])
    licensee(value['licensee'])
    pattern(value['systemId'], r'[a-z0-9][a-z0-9-]{0,49}')
    pattern(value['recipe'], r'[a-z0-9-]+')
    kits = value['enabledKits']
    if not isinstance(kits, list) or not kits:
        raise ValueError('Invalid kits')
    for kit in kits:
        pattern(kit, r'[a-z0-9-]+')
    if len(set(kits)) != len(kits):
        raise ValueError('Duplicate kits')
    shape(value['fingerprint'], 'minMatch sources')
    if value['fingerprint']['minMatch'] != 2:
        raise ValueError('Invalid threshold')
    sources(value['fingerprint']['sources'])
    if len(value['fingerprint']['sources']) < 3:
        raise ValueError('Insufficient sources')
    pattern(value['packageManifestSha256'], r'[a-f0-9]{64}')


def public_id(runner, pem, directory):
    text(pem, 1, 8192)
    key = directory / 'public.pem'
    key.write_text(pem, encoding='utf-8')
    info = runner.run(['openssl', 'pkey', '-pubin', '-in', str(key), '-text', '-noout']).stdout
    bits = re.search(rb'Public-Key: \((\d+) bit\)', info)
    if not bits or int(bits.group(1)) < 2048 or b'Modulus:' not in info:
        raise ValueError('RSA key required')
    return digest(runner.run(['openssl', 'pkey', '-pubin', '-in', str(key), '-outform', 'DER']).stdout)


def signed(runner, value, pem, directory):
    envelope(value)
    public_id(runner, pem, directory)
    payload, signature = directory / 'payload', directory / 'signature'
    payload.write_bytes(value['payload'].encode('utf-8'))
    signature.write_bytes(base64.b64decode(value['signature'], validate=True))
    result = runner.run(['openssl', 'dgst', '-sha256', '-sigopt', 'rsa_padding_mode:pss',
                         '-sigopt', 'rsa_pss_saltlen:32', '-verify', str(directory / 'public.pem'),
                         '-signature', str(signature), str(payload)], check=False)
    if result.returncode:
        raise Failure(11, '授權鏈簽章不符')
    return json.loads(value['payload'])


def certificate(runner, value, root_pem, directory):
    cert = signed(runner, value, root_pem, directory)
    shape(cert, 'schemaVersion keyId issuerKeyId subjectPublicKey licensee notBefore notAfter')
    if cert['schemaVersion'] != '1.0':
        raise ValueError('Invalid certificate version')
    licensee(cert['licensee'])
    pattern(cert['issuerKeyId'], r'[a-f0-9]{64}')
    pattern(cert['keyId'], r'[a-f0-9]{64}')
    if cert['issuerKeyId'] != public_id(runner, root_pem, directory):
        raise Failure(11, 'issuerKeyId 不符')
    if cert['keyId'] != public_id(runner, cert['subjectPublicKey'], directory):
        raise Failure(11, 'keyId 不符')
    if timestamp(cert['notAfter']) <= timestamp(cert['notBefore']):
        raise Failure(11, '憑證有效區間不合法')
    return cert


def verify_license(runner, value, root_pem, manifest_sha256, current, now=None):
    try:
        now = now or datetime.now(timezone.utc)
        shape(value, 'payload signature algorithm issuerCertificate')
        with tempfile.TemporaryDirectory(prefix='composer-license-') as tmp:
            directory = Path(tmp)
            cert = certificate(runner, value['issuerCertificate'], root_pem, directory)
            payload = signed(runner, {k: v for k, v in value.items() if k != 'issuerCertificate'},
                             cert['subjectPublicKey'], directory)
        payload_shape(payload)
        if not timestamp(cert['notBefore']) <= timestamp(payload['issuedAt']) <= timestamp(cert['notAfter']):
            raise Failure(11, 'issuedAt 不在憑證有效區間')
        if payload['licensee']['name'] != cert['licensee']['name']:
            raise Failure(11, 'licensee 不符')
        if timestamp(payload['expiresAt']) <= now:
            raise Failure(11, '授權已到期')
        if payload['packageManifestSha256'] != manifest_sha256:
            raise Failure(11, '授權 manifest 雜湊不符')
        expected = payload['fingerprint']['sources']
        if len({s['source'] for s in expected}) != len(expected):
            raise Failure(11, '指紋來源重複')
        sources(current)
        if len({s['sha256'] for s in expected} & {s['sha256'] for s in current}) < payload['fingerprint']['minMatch']:
            raise Failure(11, '指紋交集不足')
        return payload
    except Failure as error:
        if error.code == 11:
            raise
        raise Failure(11, '授權驗證工具失敗') from None
    except (OSError, ValueError, KeyError, TypeError):
        raise Failure(11, '授權資料格式不合法') from None


def checked_license(runner, path, verified, current):
    try:
        raw = Path(path).read_bytes()
        value = json.loads(raw)
        payload = verify_license(runner, value, verified['keyPem'], verified['manifestSha256'], current)
        return raw, {'sha256': digest(raw), 'licensee': payload['licensee'], 'expiresAt': payload['expiresAt']}
    except (OSError, ValueError, TypeError):
        raise Failure(11, '授權檔無法讀取') from None


# Fixed texts only, so a failure says which stage broke without echoing any input or secret.
ISSUE_REASONS = {
    'input': '到期日已過或格式不合法，或密碼為空、含換行',
    'sources': '這台機器可用的指紋來源不足三項或格式不合法',
    'certificate': '子金鑰憑證無法讀取、格式不合法，或不是這把根公鑰簽發的',
    'window': '子金鑰憑證不在有效期內',
    'key': '子金鑰檔不是加密的 PKCS8 私鑰',
    'sign': '子金鑰密碼錯誤或私鑰無法使用',
    'selfcheck': '簽出的授權沒有通過自我驗證',
    'write': '輸出路徑無法寫入',
    'exists': '輸出路徑已存在，不覆寫',
}


def issue_license(runner, subkey, cert_path, out, body, verified, current, now=None):
    stage = 'input'
    try:
        now = now or datetime.now(timezone.utc)
        shape(body, 'passphrase expiresAt')
        password = body['passphrase']
        text(password, 1, 65536)
        if any(c in password for c in '\r\n\x00') or timestamp(body['expiresAt']) <= now:
            raise ValueError('Invalid issuance input')
        stage = 'sources'
        sources(current)
        if len(current) < 3:
            raise ValueError('Insufficient sources')
        stage = 'certificate'
        cert_value = read_json(cert_path)
        with tempfile.TemporaryDirectory(prefix='composer-issue-') as tmp:
            directory = Path(tmp)
            cert = certificate(runner, cert_value, verified['keyPem'], directory)
            stage = 'window'
            if not timestamp(cert['notBefore']) <= now <= timestamp(cert['notAfter']):
                raise ValueError('Certificate outside issuance window')
            stage = 'key'
            if not Path(subkey).read_bytes().startswith(b'-----BEGIN ENCRYPTED PRIVATE KEY-----'):
                raise ValueError('Encrypted PKCS8 required')
            stage = 'selfcheck'
            manifest = verified['manifest']
            payload = dict(schemaVersion='3.0', issuedAt=now.strftime('%Y-%m-%dT%H:%M:%SZ'), expiresAt=body['expiresAt'],
                           licensee=cert['licensee'], systemId=manifest['systemId'], recipe=manifest['systemId'],
                           enabledKits=[kit['kit'] for kit in manifest['kits']],
                           packageManifestSha256=verified['manifestSha256'], fingerprint={'minMatch': 2, 'sources': current})
            payload_shape(payload)
            payload_file, signature_file = directory / 'payload', directory / 'signature'
            payload_file.write_bytes(canonical(payload))
            stage = 'sign'
            runner.run(['openssl', 'dgst', '-sha256', '-sigopt', 'rsa_padding_mode:pss', '-sigopt', 'rsa_pss_saltlen:32',
                        '-sign', str(subkey), '-passin', 'stdin', '-out', str(signature_file), str(payload_file)],
                       data=(password + '\n').encode('utf-8'))
            stage = 'selfcheck'
            value = dict(payload=canonical(payload).decode('utf-8'), signature=base64.b64encode(signature_file.read_bytes()).decode('ascii'),
                         algorithm='RSA-PSS-SHA256', issuerCertificate=cert_value)
            verify_license(runner, value, verified['keyPem'], verified['manifestSha256'], current, now)
            # Validate before publishing; exclusive creation also rejects dangling symlinks.
            stage = 'write'
            with open(out, 'xb') as stream:
                stream.write(canonical(value) + b'\n')
                stream.flush()
                os.fsync(stream.fileno())
        return value
    except (Failure, OSError, ValueError, KeyError, TypeError) as error:
        reason = ISSUE_REASONS['exists' if isinstance(error, FileExistsError) else stage]
        raise Failure(17, '授權簽發失敗：' + reason) from None
