"""Mutations of the license gate and secret loader must fail an assertion, never an import or syntax.

Run with a Python that has starlette, httpx, python-multipart and cryptography:
    python services/package/tests/gate_mutations.py
"""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

TESTS = Path(__file__).resolve().parent
REPO = TESTS.parents[2]
GATE, SECRETS = 'services/package/templates/license_gate.py', 'services/package/templates/secret_files.py'
# The two upload size checks (header, then body) overlap on purpose, so mutating either alone is not observable.
CASES = [
    ('blocking', GATE, 'if not current.valid:', 'if False:', 'GateTests.test_nothing_is_served_without_a_license_except_health_and_the_status_routes'),
    ('verify-before-write', GATE, 'if not result.valid:\n            return result', 'if False:\n            return result',
     'GateTests.test_upload_installs_only_licenses_that_pass_the_full_check'),
    ('expiry-recheck', GATE, 'now - self.checked >= RECHECK_SECONDS', 'False', 'GateTests.test_license_expiring_while_the_system_runs_is_noticed'),
    ('file-change', GATE, 'stamp != self.stamp or ', '', 'GateTests.test_replacing_the_license_file_takes_effect_without_waiting'),
    ('throttle', GATE, 'if len(self.attempts) >= ATTEMPTS:', 'if False:', 'GateTests.test_oversized_uploads_and_upload_floods_are_refused'),
    ('manifest-binding', 'kits/platform-core-kit/src/backend/app/core/license.py',
     'if payload["packageManifestSha256"] != manifest_sha256:', 'if False:', 'GateTests.test_a_license_for_another_package_blocks_the_system'),
    ('secret-ambiguity', SECRETS, 'if env.get(name, "").strip():', 'if False:',
     'SecretFileTests.test_ambiguous_missing_or_empty_sources_fail_loudly_without_echoing_values'),
]


def run(root, target):
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', 'services.package.tests.test_license_gate.' + target],
                          cwd=root, capture_output=True, text=True, encoding='utf-8', errors='replace')


def main():
    baseline = run(REPO, 'GateTests')
    baseline_secrets = run(REPO, 'SecretFileTests')
    if baseline.returncode or baseline_secrets.returncode:
        print('Baseline must pass first\n' + baseline.stderr + baseline_secrets.stderr)
        return 1
    for name, target, before, after, test in CASES:
        with tempfile.TemporaryDirectory(prefix='composer-gate-mutation-') as tmp:
            root = Path(tmp)
            (root / 'services/package').mkdir(parents=True)
            shutil.copytree(REPO / 'services/package/templates', root / 'services/package/templates')
            shutil.copytree(TESTS, root / 'services/package/tests', ignore=shutil.ignore_patterns('__pycache__', '.contracts-*'))
            license_path = root / 'kits/platform-core-kit/src/backend/app/core/license.py'
            license_path.parent.mkdir(parents=True)
            shutil.copyfile(REPO / 'kits/platform-core-kit/src/backend/app/core/license.py', license_path)
            source = root / target
            content = source.read_text(encoding='utf-8')
            if content.count(before) != 1:
                raise RuntimeError('Mutation anchor changed: ' + name)
            source.write_text(content.replace(before, after), encoding='utf-8')
            result = run(root, test)
            output = result.stdout + result.stderr
            if result.returncode == 0 or 'FAIL:' not in output or 'ERROR:' in output:
                print(name + ': NOT KILLED\n' + output)
                return 1
            print(name + ': killed by assertion')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
