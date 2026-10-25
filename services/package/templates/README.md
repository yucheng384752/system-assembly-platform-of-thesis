# WP3a deployment artifacts

This package supplies backend wiring and first-install initialization. It is not a
complete installer (`installable: false`); signature/license verification and the
installation engine remain separate work. Runtime validation is pending Claude.

Images are pinned to python:3.12.8-slim-bookworm and postgres:16.6-bookworm,
matching the validated baseline. nginx:1.28.0-bookworm pins the 1.28 stable release
and the same Debian family for reproducibility; this does not assert a current
security audit. Python requirements combine the baseline pins and selected Kit
pins, including PyJWT and bcrypt. A hash-locked dependency file is not provided;
`--require-hashes` remains recommended. Image acquisition/offline provisioning is
not supplied here.

Run from this deployment directory. Supply the blank fields described in
`.env.example` via a protected environment or a private 0600 env file supplied
with Compose `--env-file`. Never put credentials in the package or command line.
The DATABASE_URL must use the PostgreSQL asyncpg driver, host `postgres`, port
5432, and the same credentials/database as the POSTGRES fields. URL-encode its
password. SYSTEM_ID supplies the initial tenant name/code (maximum 50 characters).
DEFAULT_TENANT_ID must be a UUID. Secrets have no defaults; Compose rejects missing
or empty values, and the backend separately checks its required variables.
MOD_WEBHOOK_SECRET is required only when this package includes mod-subscription-kit.

Explicit first-install sequence (commands have not been run by Codex):

```sh
docker compose build backend init
docker compose up -d --wait postgres
docker compose --profile init run --rm init
docker compose --profile init run --rm -T init python -m app.entry_permission.create_admin < /protected/admin-input.json
docker compose up -d --wait backend proxy
```

The protected administrator input is JSON with username, password, display_name,
as required by the Kit; the installer supplies stdin and removes its private
temporary file. Password change is required at first login. `system_init` creates
the registered models and missing default tenant explicitly, without altering an
existing tenant. It can be repeated; it is not an executable upgrade migration.
Backend startup never creates tables. `/healthz` checks connectivity, all registered
tables, and the configured tenant; missing initialization returns 503.

PostgreSQL uses only the internal data network and publishes no port. Backend
publishes no port and runs as UID/GID 10001; only nginx publishes a port, defaulting
to 127.0.0.1:8080. The installation engine must explicitly configure PROXY_BIND for
LAN access. TLS is not provided. nginx forwards only `/api/` and `/healthz`; all
other paths return 503 because the frontend is not included in this package version.

Database, uploaded files/logs, and permission configuration use named volumes.
The permissions volume is initialized from this image on first use; existing
volumes are not refreshed by rebuilds. Upgrades must explicitly reconcile the
entry directory and endpoint permissions; upgrade automation is not provided.
Do not delete volumes to upgrade. Endpoint permission edits persist in that volume.
If endpoint permissions are nonempty, their restrictions intersect entry grants;
`/api/entry-points/me` reflects only entry grants. Existing Kit role-name checks
still apply. Machine API key authentication is unavailable (401); no replacement
authentication is implemented. JWT revocation, SSO and MFA are outside this work.

Python syntax/import/FK checks, startup, init idempotency, actual HTTP authorization,
Compose validation and Docker smoke checks: **to be run by Claude**.
