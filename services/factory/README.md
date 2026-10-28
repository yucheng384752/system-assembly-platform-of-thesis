# services/factory

Factory-side core for the executable plan (`docs/executable-plan-contract.md`, D134). The rules (`canonical`, `plan`, `params`, `workorder`, `alarms`) run on a store boundary; `MemoryStore` is the reference and `SqlStore` runs the same tests on SQLite and PostgreSQL. HTTP routes in `factory_api/`; the system package mounts them as `kits/factory-core-kit` (generated copy, see below). Data model: `docs/data-model.md`.

## What exists

| Module | Job |
|---|---|
| `factory_core/canonical.py` | Canonical JSON and sha256 that match `libs/aov-integration` byte for byte (UTF-16 key order, ECMAScript number text, no normalization). `parse_json` reads numbers the way JavaScript does. |
| `factory_core/schema_check.py` | Full validation against `schemas/executable-plan.schema.json` (the file the TypeScript side uses). A missing schema file raises; validation is never skipped. |
| `factory_core/plan.py` | `receive_plan`: format and version, schema, `planId` recomputation, structure the factory relies on. `work_order_blockers`: non-executable nodes, inactive kits, changed forms, evaluator commit. |
| `factory_core/params.py` | `ParameterSetService`: validate against the plan, append-only versions, separate decision records, proposer must differ from approver unless manager or admin. |
| `factory_core/workorder.py` | `FactoryState`: orders pin `planId` at creation and the approved set at start; defaults are flagged. |
| `factory_core/alarms.py` | `AlarmService`: raising an alarm holds its node until a manager or admin acknowledges; reminders at the interval of the pinned parameter set (`DEFAULT_REPEAT_MINUTES` when it has none). |
| `factory_api/routes_factory.py`, `support.py`, `deploy.py`, `kit.contract.json` | 13 routes under `/api/factory` (`build_router`; the module-level `router` is what the system backend mounts). Trusts only the actor that the entry-permission middleware sets and answers 401 without it; identity and time never come from the body. `deploy.py` turns the backend's async `DATABASE_URL` into the synchronous store, runs the first-install migration and reads the active kits from the package. `kit.contract.json` declares the 8 entry points the shared directory is assembled from. |
| `tools/sync_kit.py` | Generates `kits/factory-core-kit` from this directory (import roots only; the routes module goes to `app/api/`). `--check` runs in the tests, so a hand edit of the Kit copy fails. Run it after changing anything here. |
| `factory_core/store.py`, `sql_store.py`, `sql_schema.py`, `migrate.py`, `migrations/` | The store boundary, its SQL implementation, tables with append-only triggers, and the Alembic revision. |

## Dependencies

`requirements.txt` (versions match composer-refactor-2). The memory store and canonical hashing need only the standard library; schema validation and SQL need the packages.

## Run

```
pip install -r services/factory/requirements.txt
python -B -m unittest discover -s services/factory/tests -p "test_*.py"
```

PostgreSQL tests run when `FACTORY_TEST_PG_URL` is set, for example `postgresql+psycopg://factory:factory@127.0.0.1:5432/factory_test`. The database is wiped between tests, so point it at a scratch database. Without the variable only SQLite runs; the PostgreSQL migration test is reported as skipped and the other PostgreSQL classes are not created, so a run without PostgreSQL does not claim to have covered it.

Checked: Windows (Python 3.13, SQLite) and Ubuntu 22.04 in `python:3.12.8` against `postgres:16.6`, including the deployed dependency versions (fastapi 0.115.0, pydantic 2.9.2): 236 tests. Deployed end to end with Docker Compose (`services/package/e2e/factory_e2e.py`, 35 + 7 checks).

## Not done yet

- Form hashes and the evaluator for a deployment: a plan that needs a form or an expression cannot create work orders on a deployed system yet.
- The deployed check goes straight to the backend; the nginx path, several backend processes and real alarm delivery are not covered.
- Who receives the alarm and delivery of notices; this module only decides when a reminder is due.
- The TypeScript evaluator sidecar (the expressions behind `rules`, `guard` and `alarmRules` are not evaluated here, so alarms are raised by a caller that has evaluated them), material pick, inspection and receipt steps.
