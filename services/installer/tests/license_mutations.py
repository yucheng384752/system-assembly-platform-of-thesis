"""License mutations must cause assertion failures, never import/syntax errors."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ('certificate-signature', 'if result.returncode:', 'if False:', 'test_certificate_signature'),
    ('issuer-id', "if cert['issuerKeyId'] != public_id(runner, root_pem, directory):", 'if False:', 'test_issuer_id'),
    ('manifest', "if payload['packageManifestSha256'] != manifest_sha256:", 'if False:', 'test_manifest'),
    ('source-names', "{s['sha256'] for s in expected} & {s['sha256'] for s in current}",
     "{s['source'] for s in expected} & {s['source'] for s in current}", 'test_hash_intersection_not_names'),
    ('issued-at', "if not timestamp(cert['notBefore']) <= timestamp(payload['issuedAt']) <= timestamp(cert['notAfter']):",
     'if False:', 'test_issued_interval'),
    ('password-argv', "'-passin', 'stdin'", "'-passin', 'pass:' + password", 'test_issue_stdin_and_self_verification'),
]


def run(path, method=None):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(path / 'tests'),
               INSTALLER_REPO=str(ROOT.parents[1]), INSTALLER_PACKAGE_TEMPLATES=str(ROOT.parent / 'package/templates'))
    target = 'test_license.LicenseTests' + ('.' + method if method else '')
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', target], env=env, cwd=path / 'tests',
                          capture_output=True, text=True, encoding='utf-8', errors='replace')


def main():
    baseline = run(ROOT)
    print(baseline.stdout + baseline.stderr)
    if baseline.returncode or 'skipped=' in baseline.stderr:
        print('License baseline must pass without skips')
        return 1
    for name, before, after, method in CASES:
        with tempfile.TemporaryDirectory(prefix='composer-license-mutation-') as tmp:
            path = Path(tmp)
            shutil.copytree(ROOT / 'engine', path / 'engine', ignore=shutil.ignore_patterns('__pycache__'))
            (path / 'tests').mkdir()
            for filename in ('test_license.py', 'test_engine.py'):
                shutil.copyfile(ROOT / 'tests' / filename, path / 'tests' / filename)
            source = path / 'engine/license.py'
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
