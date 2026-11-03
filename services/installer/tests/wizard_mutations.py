"""Wizard mutations must cause assertion failures, never import/syntax errors."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ('host-check', "if self.headers.get('Host') not in allowed_hosts:", 'if False:', 'test_token_and_host_are_required'),
    ('token-check', "if not hmac.compare_digest(path[:len(prefix)].encode('utf-8', 'replace'), prefix.encode()):",
     'if False:', 'test_token_and_host_are_required'),
    ('origin-check', 'if origin is not None and origin not in allowed_origins:', 'if False:',
     'test_post_guards_origin_content_type_and_size'),
    ('plan-binding', 'if not self.plan_sha or not hmac.compare_digest(confirmed, self.plan_sha):', 'if False:',
     'test_apply_is_bound_to_the_plan_hash_the_wizard_displayed'),
    ('sudo-check', 'if not self.engine.sudo_ready():', 'if False:', 'test_apply_needs_sudo_and_runs_one_at_a_time'),
    ('passphrase-argv', "extra = [*source, '--subkey'", "extra = [*source, '--pass', secret['passphrase'], '--subkey'",
     'test_passphrase_reaches_the_engine_only_through_stdin'),
    ('one-at-a-time', 'if self.applying:\n                raise Reject(409', 'if False:\n                raise Reject(409',
     'test_apply_needs_sudo_and_runs_one_at_a_time'),
    ('rollback-binding', 'if not self.rollback_sha or not hmac.compare_digest(confirmed, self.rollback_sha):', 'if False:',
     'test_rollback_requires_the_displayed_rollback_plan_hash'),
]


def run(path, method=None):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPATH=str(path / 'tests'))
    target = 'test_wizard.WizardTests' + ('.' + method if method else '')
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', target], env=env, cwd=path / 'tests',
                          capture_output=True, text=True, encoding='utf-8', errors='replace')


def main():
    baseline = run(ROOT)
    print(baseline.stdout + baseline.stderr)
    if baseline.returncode or 'skipped=' in baseline.stderr:
        print('Wizard baseline must pass without skips')
        return 1
    for name, before, after, method in CASES:
        with tempfile.TemporaryDirectory(prefix='composer-wizard-mutation-') as tmp:
            path = Path(tmp)
            shutil.copytree(ROOT / 'engine', path / 'engine', ignore=shutil.ignore_patterns('__pycache__'))
            (path / 'tests').mkdir()
            shutil.copyfile(ROOT / 'tests/test_wizard.py', path / 'tests/test_wizard.py')
            source = path / 'engine/wizard.py'
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
