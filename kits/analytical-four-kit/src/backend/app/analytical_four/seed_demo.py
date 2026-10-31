"""Copies the synthetic demo data set into the Kit data directory, never overwriting a file that is already there.

    python -m app.analytical_four.seed_demo [data-directory]
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path
from typing import List

from app.analytical_four.settings import data_dir

DEMO = Path(__file__).parent / 'demo_data'


def seed(root: Path | None = None) -> List[str]:
    """Returns the relative paths that were copied; files that already exist are left alone."""
    root = root or data_dir()
    copied: List[str] = []
    # the system assembler adds an empty __init__.py to every folder under app/; those are not demo data
    for source in sorted(p for p in DEMO.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name != '__init__.py'):
        relative = source.relative_to(DEMO)
        target = root / relative
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        copied.append(relative.as_posix())
    return copied


if __name__ == '__main__':
    destination = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    done = seed(destination)
    print(f'copied {len(done)} demo files' if done else 'nothing to copy; every demo file already exists')
