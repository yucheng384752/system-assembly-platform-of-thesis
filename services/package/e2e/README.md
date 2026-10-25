# Deployed-system end-to-end check (Docker Compose, real PostgreSQL, real HTTP through the proxy)

Run by Claude on 2026-10-25 against the full 11-kit system package: 48/48 checks, zero backend errors. All data is
synthetic; the passwords in `system_e2e.py` are test values only. The machine API key path is not provided in this
package version, so the script checks that it is rejected.

```text
node services/package/assemble-system.mjs <new-dir> --recipe <recipe.json>      # needs PREVIEW_PYTHON with jsonschema
cd <new-dir>/deployment
# create .env from .env.example with generated test secrets (HTTP_PORT=18080), then:
docker compose -p wp3a --env-file .env -f docker-compose.yml --profile init build
docker compose -p wp3a --env-file .env -f docker-compose.yml up -d postgres
docker compose -p wp3a --env-file .env -f docker-compose.yml --profile init run --rm init
docker compose -p wp3a --env-file .env -f docker-compose.yml up -d --wait backend proxy
printf '{"username":"admin","password":"bootstrap-secret-1","display_name":"Admin"}' | docker compose -p wp3a --env-file .env -f docker-compose.yml exec -T backend python -m app.entry_permission.create_admin
python services/package/e2e/system_e2e.py .env        # needs httpx
docker compose -p wp3a --env-file .env -f docker-compose.yml down -v
```

`docker compose run --rm init` does not rebuild a cached image: run `--profile init build` after changing a template.
