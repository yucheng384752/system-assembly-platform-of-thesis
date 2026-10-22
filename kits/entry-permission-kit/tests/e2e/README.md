# Entry-permission end-to-end check (real PostgreSQL, real HTTP)

Run by Claude on 2026-10-22: 48/48 HTTP checks, bootstrap race, fail-loud startup. Uses the real entry-permission
middleware, the unchanged `endpoint_permission_middleware` and the real generic-forms and audit-edit routers.
The machine API-key middleware is a **test double** (the baseline `api_key_auth_middleware` is not in `kits/`).

Layout expected by `run.sh` (mounted at `/work`): `asm/` = `node services/preview/assemble.mjs asm` output with
`kits/entry-permission-kit/src/backend/app/.` copied over `asm/app/`; `e2e/` = this directory; `req.txt` =
`services/preview/requirements.txt`; `ep-req.txt` = `kits/entry-permission-kit/requirements.txt`.

```text
docker network create epe2e
docker run -d --name epe2e-pg --network epe2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e-local-only -e POSTGRES_DB=e2e postgres:16.6-bookworm
docker run --rm --network epe2e -v <work-dir>:/work python:3.12.8-slim-bookworm sh /work/e2e/run.sh
docker rm -f epe2e-pg; docker network rm epe2e
```

`entry_points.json` is a test directory (four entry points), not the Kit's real directory (EP4).
All data is synthetic; passwords in the scripts are test values only.
