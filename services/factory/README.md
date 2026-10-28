# services/factory

Factory-side core for the executable plan (`docs/executable-plan-contract.md`, D134). The rules (`canonical`, `plan`, `params`, `workorder`, `alarms`) run on a store boundary; `MemoryStore` is the reference and `SqlStore` runs the same tests on SQLite and PostgreSQL. No HTTP API yet. Data model: `docs/data-model.md`.

## What exists

| Module | Job |
|---|---|
| `factory_core/canonical.py` | Canonical JSON and sha256 that match `libs/aov-integration` byte for byte (UTF-16 key order, ECMAScript number text, no normalization). `parse_json` reads numbers the way JavaScript does. |
| `factory_core/schema_check.py` | Full validation against `schemas/executable-plan.schema.json` (the file the TypeScript side uses). A missing schema file raises; validation is never skipped. |
| `factory_core/plan.py` | `receive_plan`: format and version, schema, `planId` recomputation, structure the factory relies on. `work_order_blockers`: non-executable nodes, inactive kits, changed forms, evaluator commit. |
| `factory_core/params.py` | `ParameterSetService`: validate against the plan, append-only versions, separate decision records, proposer must differ from approver unless manager or admin. |
| `factory_core/workorder.py` | `FactoryState`: orders pin `planId` at creation and the approved set at start; defaults are flagged. |
| `factory_core/alarms.py` | `AlarmService`: raising an alarm holds its node until a manager or admin acknowledges; reminders at the interval of the pinned parameter set (`DEFAULT_REPEAT_MINUTES` when it has none). |
| `factory_core/store.py`, `sql_store.py`, `sql_schema.py`, `migrate.py`, `migrations/` | The store boundary, its SQL implementation, tables with append-only triggers, and the Alembic revision. |

## Dependencies

`requirements.txt` (versions match composer-refactor-2). The memory store and canonical hashing need only the standard library; schema validation and SQL need the packages.

## Run

```
pip install -r services/factory/requirements.txt
python -B -m unittest discover -s services/factory/tests -p "test_*.py"
```

PostgreSQL tests run when `FACTORY_TEST_PG_URL` is set, for example `postgresql+psycopg://factory:factory@127.0.0.1:5432/factory_test`. The database is wiped between tests, so point it at a scratch database. Without the variable only SQLite runs; the PostgreSQL migration test is reported as skipped and the other PostgreSQL classes are not created, so a run without PostgreSQL does not claim to have covered it.

Checked: Windows (Python 3.13, SQLite) and Ubuntu 22.04 in `python:3.12.8` against `postgres:16.6` (167 tests, three consecutive runs, concurrency tests included).

## Not done yet

- HTTP API and entry-permission wiring (`kit.contract.json` entryPoints with `admin` in `defaultRoles`).
- Who receives the alarm and delivery of notices; this module only decides when a reminder is due.
- The TypeScript evaluator sidecar (the expressions behind `rules`, `guard` and `alarmRules` are not evaluated here, so alarms are raised by a caller that has evaluated them), material pick, inspection and receipt steps.
