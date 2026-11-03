"""Copy the factory service into kits/factory-core-kit as the Kit's backend source, with the one import rewrite the move needs.

services/factory is the source of truth and is what the tests run. The Kit copy lives in the assembled backend under
`app/`, so `factory_core` becomes `app.factory_core` and `factory_api` becomes `app.factory_api`. The routes module is the exception to the layout: it becomes `app/api/routes_factory.py`,
where the assembler (and the package test that scans routes_*.py) expects a Kit's routes. Nothing else is changed.
`--check` fails if the Kit copy differs from what this tool would write, and is run by the test suite.

    python services/factory/tools/sync_kit.py          # write
    python services/factory/tools/sync_kit.py --check  # compare only
"""
from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
SERVICE = ROOT / 'services' / 'factory'
KIT = ROOT / 'kits' / 'factory-core-kit'
BACKEND = KIT / 'src' / 'backend' / 'app'

PACKAGES = ('factory_core', 'factory_api')
SKIP_PARTS = {'__pycache__'}
REWRITE = re.compile(r'\b(from|import)\s+(factory_core|factory_api)\b')


def rewrite(text: str) -> str:
    return REWRITE.sub(lambda m: f'{m.group(1)} app.{m.group(2)}', text)


def wanted() -> dict[Path, bytes]:
    """Every file the Kit should contain that this tool owns, keyed by its path under kits/factory-core-kit."""
    files: dict[Path, bytes] = {}
    for package in PACKAGES:
        for source in sorted((SERVICE / package).rglob('*')):
            if not source.is_file() or SKIP_PARTS & set(source.parts) or source.suffix == '.pyc':
                continue
            data = source.read_bytes()
            if source.suffix == '.py':
                data = rewrite(data.decode('utf-8')).encode('utf-8')
            relative = source.relative_to(SERVICE)
            if relative == Path('factory_api/routes_factory.py'):
                files[Path('src/backend/app/api/routes_factory.py')] = data
            else:
                files[Path('src/backend/app') / relative] = data
    files[Path('src/backend/app/factory_core/executable-plan.schema.json')] = (ROOT / 'schemas' / 'executable-plan.schema.json').read_bytes()
    files[Path('kit.contract.json')] = (SERVICE / 'kit.contract.json').read_bytes()
    return files


def owned_existing() -> set[Path]:
    """Files already in the Kit under the paths this tool owns (so stale ones can be found)."""
    found = {p.relative_to(KIT) for package in PACKAGES if (BACKEND / package).is_dir()
             for p in (BACKEND / package).rglob('*') if p.is_file() and not SKIP_PARTS & set(p.parts)}
    for name in ('kit.contract.json', 'src/backend/app/api/routes_factory.py'):
        if (KIT / name).is_file():
            found.add(Path(name))
    return found


def differences() -> list[str]:
    want = wanted()
    problems = []
    for path, data in want.items():
        target = KIT / path
        if not target.is_file():
            problems.append(f'missing: {path.as_posix()}')
        elif target.read_bytes() != data:
            problems.append(f'differs: {path.as_posix()}')
    problems += [f'stale: {p.as_posix()}' for p in sorted(owned_existing() - set(want))]
    return problems


def main(argv: list[str]) -> int:
    if argv[1:] == ['--check']:
        problems = differences()
        for line in problems:
            print(line)
        return 1 if problems else 0
    if argv[1:]:
        print(__doc__)
        return 2
    want = wanted()
    for path in owned_existing() - set(want):
        (KIT / path).unlink()
    for path, data in want.items():
        (KIT / path).parent.mkdir(parents=True, exist_ok=True)
        (KIT / path).write_bytes(data)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
