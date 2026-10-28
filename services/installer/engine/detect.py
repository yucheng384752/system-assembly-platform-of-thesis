"""Read-only Ubuntu preflight. Host paths are injectable for fixtures."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import socket
from common import Failure, canonical


def read(path):
    try:
        return Path(path).read_text(encoding='utf-8').strip()
    except (OSError, UnicodeError):
        return ''


def fingerprint(sys_root):
    root = Path(sys_root)
    sources = {}
    for name in ('product_uuid', 'product_serial', 'board_serial', 'chassis_serial'):
        sources[name] = read(root / 'class/dmi/id' / name).lower()
    for card in sorted((root / 'class/net').glob('*')):
        if (card / 'device').exists():
            sources['mac:' + card.name] = read(card / 'address').lower()
    bad = {'', '0', 'none', 'unknown', 'default string', 'to be filled by o.e.m.', 'not specified', 'system serial number'}
    for disk in sorted((root / 'block').glob('*')):
        if (disk.name.startswith(('loop', 'ram', 'dm-', 'md', 'zram', 'sr', 'nbd'))
                or read(disk / 'removable') == '1' or '/usb' in disk.resolve().as_posix()):
            continue
        serial = disk / 'device/serial'
        if serial.exists():
            value = read(serial).lower()
        else:
            try:
                raw = (disk / 'device/vpd_pg80').read_bytes().decode('utf-8', errors='ignore')
                value = re.sub(r'[\x00-\x1f\x7f-\x9f]', '', raw).strip().lower()
            except OSError:
                value = ''
        sources['disk:' + disk.name] = value
    result = []
    for name, value in sources.items():
        compact = re.sub(r'[-:\s]', '', value)
        valid = value not in bad and bool(compact) and set(compact) != {'0'} and set(compact) != {'f'}
        result.append({'source': name, 'valid': valid, 'sha256': hashlib.sha256(value.encode()).hexdigest() if valid else None})
    valid = [entry for entry in result if entry['valid']]
    return {'sources': result, 'validCount': len(valid), 'sha256': hashlib.sha256(canonical(valid)).hexdigest(),
            'warnings': ['可用指紋來源少於 3 項；授權簽發時將拒絕'] if len(valid) < 3 else []}


def collect(runner, sys_root='/sys'):
    """Only the fixed child command reads privileged hardware; it returns hashes."""
    try:
        result = runner.run(['python3', '-B', str(Path(__file__).with_name('cli.py')), 'fingerprint',
                             '--json', '--sys-root', str(sys_root)], privileged=True)
        values = json.loads(result.stdout)
        if not isinstance(values, list):
            raise ValueError()
        for item in values:
            if (not isinstance(item, dict) or set(item) != {'source', 'valid', 'sha256'}
                    or not isinstance(item['source'], str) or type(item['valid']) is not bool
                    or (item['valid'] and (not isinstance(item['sha256'], str)
                        or not re.fullmatch(r'[a-f0-9]{64}', item['sha256'])))
                    or (not item['valid'] and item['sha256'] is not None)):
                raise ValueError()
        return values
    except (Failure, OSError, ValueError, TypeError):
        raise Failure(11, '無法以 root 採集硬體指紋') from None


def current_sources(runner, sys_root='/sys'):
    return [{'source': item['source'], 'sha256': item['sha256']}
            for item in collect(runner, sys_root) if item['valid']]


def universe_enabled(apt):
    for path in [apt / 'sources.list', *sorted((apt / 'sources.list.d').glob('*.list'))]:
        if any(line.strip().startswith('deb ') and 'universe' in line.split('#', 1)[0].split()
               for line in read(path).splitlines()):
            return True
    for path in (apt / 'sources.list.d').glob('*.sources'):
        for stanza in re.split(r'\n\s*\n', read(path)):
            fields = dict(re.findall(r'^([A-Za-z-]+):\s*([^\n]*)', stanza, re.M))
            if (fields.get('Enabled', 'yes').lower() != 'no' and 'deb' in fields.get('Types', '').split()
                    and 'universe' in fields.get('Components', '').split()):
                return True
    return False


def detect(runner, *, sys_root='/sys', proc_root='/proc', etc_root='/etc', target='/', port=8080):
    os_release = read(Path(etc_root) / 'os-release')
    fields = dict(re.findall(r'^(\w+)=["\']?([^\n"\']*)', os_release, re.M))
    apt = Path(etc_root) / 'apt'
    universe = universe_enabled(apt)
    versions = {}
    for name, command in [('docker', ['docker', '--version']), ('compose', ['docker', 'compose', 'version', '--short'])]:
        try:
            result = runner.run(command, check=False)
            versions[name] = result.stdout.decode(errors='replace').strip() if result.returncode == 0 else None
        except Exception:
            versions[name] = None
    root_user = hasattr(os, 'geteuid') and os.geteuid() == 0
    try:
        sudo = root_user or runner.run(['sudo', '-n', '-l'], check=False).returncode == 0
    except Exception:
        sudo = False
    memory = re.search(r'^MemTotal:\s+(\d+)', read(Path(proc_root) / 'meminfo'), re.M)
    disk = shutil.disk_usage(target).free
    with socket.socket() as connection:
        try:
            connection.bind(('0.0.0.0', port))
            port_free = True
        except OSError:
            port_free = False
    # apt resolves connectivity and exact candidate versions without changing sources/packages.
    packages, connectivity = [], True
    for package in ('docker.io', 'docker-compose-v2'):
        try:
            policy = runner.run(['apt-cache', 'policy', package], check=False)
            candidate = re.search(r'Candidate:\s+(\S+)', policy.stdout.decode(errors='replace'))
            version = candidate.group(1) if candidate else '(none)'
            installed = re.search(r'Installed:\s+(\S+)', policy.stdout.decode(errors='replace'))
            packages.append({'name': package, 'version': version, 'installed': installed.group(1) if installed else '(none)'})
        except Exception:
            packages.append({'name': package, 'version': '(none)', 'installed': '(none)'})
    try:
        connectivity = runner.run(['python3', '-c',
            "import urllib.request; urllib.request.urlopen('https://archive.ubuntu.com/ubuntu/dists/jammy/Release', timeout=10).read(1)"], check=False).returncode == 0
    except Exception:
        connectivity = False
    problems = []
    if fields.get('ID') != 'ubuntu' or fields.get('VERSION_ID') != '22.04':
        problems.append('需要 Ubuntu 22.04')
    if not universe:
        problems.append('universe 未啟用；不自動修改 apt 來源')
    if not port_free:
        problems.append('連接埠已占用')
    if not sudo:
        problems.append('sudo 權限尚未確認；請先在終端執行 sudo -v')
    if disk < 1024 ** 3:
        problems.append('可用磁碟不足 1 GiB')
    if not memory or int(memory.group(1)) < 1024 ** 2:
        problems.append('記憶體不足 1 GiB 或無法讀取')
    if platform.machine() not in ('x86_64', 'aarch64'):
        problems.append('不支援的 CPU 架構')
    if not connectivity:
        problems.append('Ubuntu 套件庫 HTTPS 連線檢查失敗')
    if any(p['version'] == '(none)' for p in packages):
        problems.append('Ubuntu Docker 套件候選版本不可用')
    fingerprints = fingerprint(sys_root)
    try:
        if not sudo:
            raise Failure(11, 'sudo unavailable')
        values = collect(runner, sys_root)
        valid = [item for item in values if item['valid']]
        fingerprints = dict(sources=values, validCount=len(valid), sha256=hashlib.sha256(canonical(valid)).hexdigest(),
                            warnings=['可用指紋來源少於 3 項；授權簽發時將拒絕'] if len(valid) < 3 else [])
    except Failure:
        fingerprints['warnings'].append('未取得 root，DMI 來源不可讀')
    return dict(os='ubuntu-22.04' if fields.get('ID') == 'ubuntu' and fields.get('VERSION_ID') == '22.04' else 'unsupported',
                architecture=platform.machine(), diskFreeBytes=disk, memoryKiB=int(memory.group(1)) if memory else 0,
                root=root_user, sudo=sudo, universe=universe, port=port, portFree=port_free,
                versions=versions, packages=packages, connectivity={'https': connectivity},
                fingerprint=fingerprints, problems=problems)
