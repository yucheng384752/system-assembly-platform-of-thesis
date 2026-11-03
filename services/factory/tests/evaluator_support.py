"""Finding or building the real evaluator for tests: a node binary and the bundle from services/evaluator/build.mjs.

FACTORY_TEST_NODE and FACTORY_TEST_EVALUATOR_BUNDLE override the lookup (the Linux test container mounts both). When node is
absent the tests that need it are skipped by name, so a run without node cannot claim to have covered the evaluator.
"""
import atexit
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
NODE = os.environ.get('FACTORY_TEST_NODE') or shutil.which('node')
_bundle: str | None = os.environ.get('FACTORY_TEST_EVALUATOR_BUNDLE')


def bundle_path() -> str | None:
    """The evaluator bundle, built once per run; None when it cannot be built here."""
    global _bundle
    if _bundle is None and NODE:
        directory = tempfile.mkdtemp(prefix='evaluator-bundle-')
        atexit.register(shutil.rmtree, directory, True)
        target = str(Path(directory) / 'evaluator.cjs')
        subprocess.run([NODE, str(ROOT / 'services/evaluator/build.mjs'), target], check=True, cwd=ROOT)
        _bundle = target
    return _bundle


def real_command() -> list[str] | None:
    bundle = bundle_path()
    return [NODE, bundle] if NODE and bundle else None


def fake(script: str) -> list[str]:
    """A stand-in child written in Python, to make the real failure modes happen on purpose."""
    return [sys.executable, '-u', '-c', script]
