# Factory data model

Data first: these tables are what `factory_core/sql_schema.py`, the Alembic revision `migrations/versions/0001_initial.py` and `factory_core/store.py` all agree on. A test builds the database from the migration and compares it with the table definitions, so the three cannot drift apart.

## Rules that shape the tables

- Plans and forms are content addressed and immutable; a work order needs every `(formId, contentSha256)` its plan names to be in `forms`. Parameter sets, decisions, alarms, acknowledgements and notices are append-only. The database refuses `UPDATE`, `DELETE` and `TRUNCATE` on them with triggers, so the rule holds even for a script that bypasses the service.
- A work order is written once at creation and once at start (the pin). After the start the database refuses any change. Nothing is ever deleted.
- "Approved", "open", "held" and "acknowledged" are derived from the records, never stored as flags. A node is held exactly when it has an alarm with no acknowledgement.
- JSON is stored as canonical text and times as the ISO text the caller gave. A database that normalized a number or reordered keys would change the bytes a content hash was computed over.
- A stored plan is re-verified (schema, structure, `planId`) the first time it is read. If the bytes no longer hash to the id, the store raises `StoreCorrupt` and nothing derived from that plan is used.

## Tables

| Table | Key | Content | Enforced by the database |
|---|---|---|---|
| `plans` | `plan_id` (sha256) | `document`: canonical JSON of the plan | append-only; id is 64 characters |
| `forms` | `content_sha256` | `form_id`, `definition` (canonical JSON of the AoV `FormDef`), uploader, time (Alembic revision 0002) | append-only; hash is 64 characters; re-hashed on every read |
| `parameter_sets` | `(plan_id, set_version)` | values, tables, alarm intervals (canonical JSON text), `content_sha256`, source (`manual` or `upload`) and file hash, proposer, time, reason | append-only; foreign key to `plans`; version at least 1; source is one of the two |
| `parameter_decisions` | `(plan_id, set_version)` | `approved` or `rejected`, decider, time, note | append-only; one decision per version (the key); foreign key to the set |
| `work_orders` | `order_id` | `plan_id`, creator and time, then at start: `started_at`, pinned `set_version`, `using_defaults` | only the single start is writable; a pin exists only when started; foreign keys to the plan and the pinned set |
| `alarms` | `alarm_id` (`order:rule:episode`) | order, rule, node, `episode`, time, detail | append-only; unique `(order, rule, episode)`; foreign key to the order |
| `alarm_acks` | `alarm_id` | who, role (`manager` or `admin`), time, note | append-only; one acknowledgement per alarm |
| `alarm_notices` | `(alarm_id, seq)` | `sent_at` of the first notice and of every reminder | append-only |

## Not enforced by the database (service rules)

- Proposer and approver must differ unless the approver is a manager or admin.
- A work order pins the latest approved set; the pinned set being approved is checked by the service, not by a constraint.
- Which roles may call which entry point is decided by entry-permission at the API layer (`kit.contract.json`).

## Running

Fresh install: `factory_core.migrate.upgrade(engine)` (the system init step calls it), or `alembic` with `script_location = services/factory/factory_core/migrations`. Tests build the same schema with `sql_schema.create_all`. Any later change to a table or guard is a new revision; revision 0001 is not edited (0002 added `forms`; 0001 installs guards for the tables it creates only).
