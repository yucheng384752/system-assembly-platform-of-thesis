"""Full JSON Schema validation of an executable plan (contract section 6).

The schema file is the single source shared with the TypeScript side (`schemas/executable-plan.schema.json`). It is read
from FACTORY_PLAN_SCHEMA when set, else from a copy shipped next to this module (a deployed Kit carries one), else from
the repository.
"""
from __future__ import annotations

from functools import lru_cache
import json
import os
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA_NAME = 'executable-plan.schema.json'
SHIPPED = Path(__file__).resolve().parent / SCHEMA_NAME
DEFAULT_SCHEMA = SHIPPED if SHIPPED.exists() else Path(__file__).resolve().parents[3] / 'schemas' / SCHEMA_NAME


@lru_cache(maxsize=1)
def _validator() -> Draft202012Validator:
    path = Path(os.environ.get('FACTORY_PLAN_SCHEMA') or DEFAULT_SCHEMA)
    schema = json.loads(path.read_text(encoding='utf-8'))  # a missing schema fails loudly; it is never skipped
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def schema_errors(plan: dict) -> list[dict]:
    """Located errors, ordered by path, or an empty list."""
    found = sorted(_validator().iter_errors(plan), key=lambda e: [str(p) for p in e.absolute_path])
    return [{'code': 'schema', 'path': '/' + '/'.join(str(p) for p in e.absolute_path), 'message': e.message[:300]} for e in found]
