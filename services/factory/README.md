# services/factory

Factory-side core for the executable plan (`docs/executable-plan-contract.md`, D134). Standard library only; no web framework, database driver or JSON Schema library yet.

## What exists (W3, first slice)

| Module | Job |
|---|---|
| `factory_core/canonical.py` | Canonical JSON and sha256 that match `libs/aov-integration` byte for byte (UTF-16 key order, ECMAScript number text, no normalization). `parse_json` reads numbers the way JavaScript does. |
| `factory_core/plan.py` | `receive_plan`: format and version, `planId` recomputation, structure the factory relies on. `work_order_blockers`: non-executable nodes, inactive kits, changed forms, evaluator commit. |
| `factory_core/params.py` | `ParameterSetService`: validate against the plan, append-only versions, separate decision records, proposer must differ from approver unless manager or admin. |
| `factory_core/workorder.py` | `FactoryState`: orders pin `planId` at creation and the approved set at start; defaults are flagged. In-memory reference store. |

## Run

```
python -B -m unittest discover -s services/factory/tests -p "test_*.py"
```

Checked on Python 3.10 (Ubuntu 22.04) and 3.13 (Windows).

## Not done yet

- Persistence (PostgreSQL), HTTP API, entry-permission wiring (`kit.contract.json` entryPoints with `admin` in `defaultRoles`).
- Full JSON Schema validation of the plan (`schemas/executable-plan.schema.json`); needs a library, see contract 8.2.
- Alarms and the `held` node state, the TypeScript evaluator sidecar, material pick, inspection and receipt steps.
