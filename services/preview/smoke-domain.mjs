// Regression for T12 (D123): a registered code WITH a physical table must still be read from that table.
// Run after `preview.mjs up` and `app.preview_seed`. It creates one synthetic domain table inside the preview database
// through `docker compose exec`; it touches nothing outside the preview project and never deletes data.
// Usage: node services/preview/smoke-domain.mjs [baseUrl]   (default http://127.0.0.1:18000)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:18000';
const directory = path.dirname(fileURLToPath(import.meta.url));
const tenant = '00000000-0000-4000-8000-000000000001';
const headers = { 'X-Tenant-Id': tenant, 'X-Admin-API-Key': 'preview-fake-admin-key' };
const code = 'preview_domain_demo';

const setup = `
import asyncio
from sqlalchemy import select, text
from app.core import database
from app.models.core.schema_registry import TableRegistry
from app.models.station import Station, StationSchema

TENANT = "${tenant}"

async def main():
    await database.init_db()
    try:
        async with database.async_session_factory() as session:
            await session.execute(text('CREATE TABLE IF NOT EXISTS "${code}" (entry_key text, "_tenant_id" text, '
                '"_import_job_id" text, "_row_index" integer, "_imported_at" timestamptz DEFAULT now())'))
            if not (await session.execute(text('SELECT 1 FROM "${code}" LIMIT 1'))).first():
                await session.execute(text('INSERT INTO "${code}" (entry_key, "_tenant_id", "_import_job_id", "_row_index") '
                    "VALUES ('domain-row', :tid, 'job-1', 1)"), {"tid": TENANT})
            if not (await session.execute(select(TableRegistry).where(TableRegistry.table_code == "${code}"))).scalar_one_or_none():
                session.add(TableRegistry(table_code="${code}", display_name="Preview domain demo"))
            station = (await session.execute(select(Station).where(Station.tenant_id == TENANT, Station.code == "${code}"))).scalar_one_or_none()
            if station is None:
                station = Station(tenant_id=TENANT, code="${code}", name="Preview domain demo")
                session.add(station)
                await session.flush()
                session.add(StationSchema(station_id=station.id, version=1, is_active=True,
                    record_fields=[{"name": "entry_key", "type": "text"}], unique_key_fields=["entry_key"]))
            await session.commit()
            print("DOMAIN_TABLE_READY")
    finally:
        await database.close_db()

asyncio.run(main())
`;

const run = spawnSync('docker', ['compose', '--project-name', 'composer-preview', '--file', path.join(directory, 'docker-compose.yml'),
  'exec', '-T', 'backend', 'python', '-'], { input: setup, encoding: 'utf8', shell: false });
if (run.status !== 0 || !run.stdout.includes('DOMAIN_TABLE_READY')) {
  console.error(`FAIL  無法建立合成領域表\n${run.stderr || run.stdout}`);
  process.exit(1);
}

async function call(path) {
  const response = await fetch(base + path, { headers });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, body };
}

let failed = 0;
const record = (name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`); };

const list = await call(`/api/forms/${code}/records`);
const row = list.body?.records?.find(item => item.data?.entry_key === 'domain-row');
record('有實體表的登記代碼仍從實體表列出資料列', list.status === 200 && list.body?.total === 1 && !!row,
  `status ${list.status}, total ${list.body?.total}, 讀回 ${!!row}`);
const trend = await call(`/api/analytics/trend?code=${code}`);
record('有實體表的登記代碼趨勢仍走實體路徑', trend.status === 200, `status ${trend.status}`);

console.log(`\n${failed ? `${failed} 項失敗` : '2/2 通過'}`);
process.exit(failed ? 1 : 0);
