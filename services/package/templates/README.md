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

Run from this deployment directory. Non-secret fields (see `.env.example`) go in a private `.env`
passed with `--env-file`, including the host paths of the license directory (`LICENSE_DIR`, writable by
UID 10001), the trusted root public key (`ROOT_KEY_FILE`) and the installed `system-manifest.json`
(`MANIFEST_FILE`). Private values are never environment variables: provide each as a file in
`../secrets/` (one value per file, mode 0400, owned by UID 10001; `postgres_password` may stay
root-owned): `postgres_password`, `database_url`, `secret_key`, `entry_permission_jwt_secret` and, when
the package includes mod-subscription-kit, `mod_webhook_secret`. Compose mounts them under
`/run/secrets` and the backend loads `<NAME>_FILE` before any settings are created, so `docker inspect`
shows paths only. The `database_url` must use the PostgreSQL asyncpg driver, host `postgres`, port 5432,
and the same credentials/database as POSTGRES_USER/POSTGRES_DB (URL-encode the password). SYSTEM_ID
supplies the initial tenant name/code (maximum 50 characters); DEFAULT_TENANT_ID must be a UUID.
`.dockerignore` keeps `secrets/`, `license/` and `.env` out of the build context.

License gate (D142): the backend verifies the installed license (root key, sub-key certificate,
manifest hash, expiry) and returns 503 for everything except `/healthz` and the license routes while it
is invalid. `/license` is a minimal status page, `/api/license/status` reports the state and
`/api/license/upload` installs a new license, but only one that passes the full check. Hardware binding
is not checked yet (guard container, work package e2); do not claim copy protection.

Explicit first-install sequence (commands have not been run by Codex):

```sh
docker compose build backend init
docker compose up -d --wait postgres
docker compose --profile init run --rm init
docker compose --profile init run --rm -T init python -m app.secret_files app.entry_permission.create_admin < /protected/admin-input.json
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
