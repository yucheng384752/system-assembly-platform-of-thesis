"""Ten isolated mutations. Syntax/import errors never count as killed mutations."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ('signature', 'package.py', 'if result.returncode:', 'if False:', 'test_signature_rejected_before_extraction'),
    ('archive-sha256', 'package.py', "if checksum.hexdigest() != payload['sha256']:", 'if False:', 'test_tar_hash_rejected_before_extraction'),
    ('path-traversal', 'package.py', "raise Failure(11, '安裝包路徑不安全')", 'pass', 'test_path_guard'),
    ('plan-hash', 'common.py', "raise Failure(12, '計畫雜湊不符')", 'pass', 'test_plan_hash_and_order'),
    ('redaction', 'common.py', "value = value.replace(secret, '[REDACTED]')", 'value = value', 'test_redaction_at_event_and_state_boundary'),
    ('ownership-label', 'install.py', "return (labels or {}).get(LABEL) == self.install_id", 'return True', 'test_rollback_label_boundary_and_nonempty_volumes'),
    ('secrets-in-env-file', 'install.py', 'public = {name: env[name] for name in PUBLIC_ENV if name in env}', 'public = dict(env)', 'test_apply_and_no_secret_copies'),
    ('backend-cannot-read-secrets', 'install.py', "owner = {} if filename == 'postgres_password' else {'owner': [BACKEND_UID, BACKEND_UID]}", 'owner = {}', 'test_apply_and_no_secret_copies'),
    ('license-after-services', 'install.py', "'db-init', 'migration', 'license-install', 'compose-up', 'health-check']", "'db-init', 'migration', 'compose-up', 'license-install', 'health-check']", 'test_license_install_drift_is_code_12'),
    ('admin-without-secret-loader', 'install.py', "'python', '-m', 'app.secret_files', 'app.entry_permission.create_admin'", "'python', '-m', 'app.entry_permission.create_admin'", 'test_apply_and_no_secret_copies'),
]


def run(path, method=None):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(path / 'tests'),
               INSTALLER_PACKAGE_TEMPLATES=str(ROOT.parent / 'package/templates'))
    target = 'test_engine' + ('.EngineTests.' + method if method else '')
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', target], env=env,
                          capture_output=True, text=True, encoding='utf-8', errors='replace')


def main():
    baseline = run(ROOT)
    print(baseline.stdout + baseline.stderr)
    if baseline.returncode:
        print('正常測試未通過，不執行變異')
        return 1
    for name, filename, before, after, method in CASES:
        with tempfile.TemporaryDirectory(prefix='.mutation-', dir=ROOT / 'tests') as tmp:
            path = Path(tmp)
            shutil.copytree(ROOT / 'engine', path / 'engine', ignore=shutil.ignore_patterns('__pycache__'))
            (path / 'tests').mkdir()
            shutil.copyfile(ROOT / 'tests/test_engine.py', path / 'tests/test_engine.py')
            source = path / 'engine' / filename
            content = source.read_text(encoding='utf-8')
            if content.count(before) != 1:
                raise RuntimeError('Mutation anchor changed: ' + name)
            source.write_text(content.replace(before, after), encoding='utf-8')
            result = run(path, method)
            output = result.stdout + result.stderr
            if result.returncode == 0 or 'FAIL:' not in output or 'ERROR:' in output:
                print(name + ': NOT KILLED\n' + output)
                return 1
            print(name + ': killed by assertion')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
