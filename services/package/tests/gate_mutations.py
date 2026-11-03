"""Mutations of the license gate, hardware policy and secret loader must fail an assertion, never an import or syntax.

Run with a Python that has starlette, httpx, python-multipart, cryptography and tzdata:
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
HW = 'services/package/templates/license_hardware.py'
KIT = 'kits/platform-core-kit/src/backend/app/core/license.py'
NL = '\n'
BLOCKED = 'HardwareTests.test_grace_expiry_inside_the_window_blocks_and_the_block_persists_after_the_window_closes'
# The two upload size checks (header, then body) overlap on purpose, so mutating either alone is not observable.
CASES = [
    ('blocking', GATE, 'if not current.valid:', 'if False:', 'GateTests.test_nothing_is_served_without_a_license_except_health_and_the_status_routes'),
    ('verify-before-write', GATE, 'if not result.valid:' + NL + '            return result', 'if False:' + NL + '            return result',
     'GateTests.test_upload_installs_only_licenses_that_pass_the_full_check'),
    ('expiry-recheck', GATE, 'now - self.checked >= RECHECK_SECONDS', 'False', 'GateTests.test_license_expiring_while_the_system_runs_is_noticed'),
    ('file-change', GATE, 'stamp != self.stamp or ', '', 'GateTests.test_replacing_the_license_file_takes_effect_without_waiting'),
    ('throttle', GATE, 'if len(self.attempts) >= ATTEMPTS:', 'if False:', 'GateTests.test_oversized_uploads_and_upload_floods_are_refused'),
    ('manifest-binding', KIT, 'if payload["packageManifestSha256"] != manifest_sha256:', 'if False:', 'GateTests.test_a_license_for_another_package_blocks_the_system'),
    ('secret-ambiguity', SECRETS, 'if env.get(name, "").strip():', 'if False:',
     'SecretFileTests.test_ambiguous_missing_or_empty_sources_fail_loudly_without_echoing_values'),
    ('hardware-block-never', HW, 'if now < grace_end:', 'if True:', BLOCKED),
    ('window-ignored', HW, 'if window.contains(local):', 'if True:',
     'HardwareTests.test_grace_expiry_outside_the_window_waits_for_the_next_window_start'),
    ('block-not-sticky', HW, 'if state.get("blockedSince"):' + NL + '        return Verdict("blocked", **common)',
     'if False:' + NL + '        return Verdict("blocked", **common)', BLOCKED),
    ('match-keeps-block', HW, '            for key in ("mismatchSince", "blockedSince"):' + NL + '                state.pop(key, None)' + NL,
     '            pass' + NL, 'HardwareTests.test_matching_hardware_again_clears_the_warning_and_the_block'),
    ('one-source-is-enough', KIT, 'matched >= result.min_match', 'matched >= 1', 'HardwareTests.test_one_matching_source_is_not_enough'),
    ('guard-silence-tolerated-forever', HW, 'if now - since < UNREACHABLE_TOLERANCE:', 'if True:',
     'HardwareTests.test_a_guard_silent_for_a_day_counts_as_a_mismatch'),
    ('outage-ends-block', HW, 'if not state.get("mismatchSince") and not state.get("blockedSince"):', 'if True:',
     'HardwareTests.test_an_outage_cannot_end_a_block_that_has_already_started'),
    ('stale-report-trusted', HW, 'elif now - report.generated_at > UNREACHABLE_TOLERANCE:', 'elif False:',
     'HardwareTests.test_a_stale_report_older_than_the_tolerance_is_not_trusted'),
    ('future-report-trusted', HW, 'generated > now + CLOCK_SKEW', 'False', 'HardwareTests.test_a_report_from_the_future_or_a_damaged_one_is_ignored'),
    ('state-not-saved', GATE, 'hw.save_state(self.state_file(), state)', 'pass', 'HardwareTests.test_grace_survives_a_backend_restart'),
    ('upload-ignores-hardware', GATE, 'if not lic.fingerprint_matches(result, report.hashes)[0]:', 'if False:',
     'GateTests.test_upload_installs_only_licenses_that_pass_the_full_check'),
    ('upload-with-stale-guard', GATE, 'self.now() - report.generated_at > hw.UNREACHABLE_TOLERANCE', 'False',
     'GateTests.test_upload_needs_a_recent_guard_report_to_know_which_hardware_this_is'),
    ('banner-missing', GATE, 'if warning:' + NL + '        response.headers', 'if False:' + NL + '        response.headers',
     'HardwareTests.test_a_mismatch_starts_a_visible_grace_period_and_keeps_serving'),
]


def run(root, target):
    return subprocess.run([sys.executable, '-B', '-m', 'unittest', 'services.package.tests.test_license_gate.' + target],
                          cwd=root, capture_output=True, text=True, encoding='utf-8', errors='replace')


def main():
    for group in ('GateTests', 'HardwareTests', 'PolicyTests', 'SecretFileTests'):
        baseline = run(REPO, group)
        if baseline.returncode:
            print('Baseline must pass first' + NL + baseline.stderr)
            return 1
    for name, target, before, after, test in CASES:
        with tempfile.TemporaryDirectory(prefix='composer-gate-mutation-') as tmp:
            root = Path(tmp)
            (root / 'services/package').mkdir(parents=True)
            shutil.copytree(REPO / 'services/package/templates', root / 'services/package/templates')
            shutil.copytree(TESTS, root / 'services/package/tests', ignore=shutil.ignore_patterns('__pycache__', '.contracts-*'))
            license_path = root / KIT
            license_path.parent.mkdir(parents=True)
            shutil.copyfile(REPO / KIT, license_path)
            source = root / target
            content = source.read_text(encoding='utf-8')
            if content.count(before) != 1:
                raise RuntimeError('Mutation anchor changed: ' + name)
            source.write_text(content.replace(before, after), encoding='utf-8')
            result = run(root, test)
            output = result.stdout + result.stderr
            if result.returncode == 0 or 'FAIL:' not in output or 'ERROR:' in output:
                print(name + ': NOT KILLED' + NL + output)
                return 1
            print(name + ': killed by assertion')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
