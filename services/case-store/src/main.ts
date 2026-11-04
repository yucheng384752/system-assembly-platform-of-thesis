import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openCaseStore } from '../../../libs/case-store';
import { createApiServer, HOST } from './server';

const port = Number(process.env.CASE_STORE_PORT ?? 18788);
const file = resolve(process.env.CASE_STORE_DB ?? 'data/case-store.sqlite3');

mkdirSync(dirname(file), { recursive: true });
const store = openCaseStore(file);
const server = createApiServer(store);
server.listen(port, HOST, () => console.log(`case-store listening on http://${HOST}:${port} (db: ${file})`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.close(); store.close(); process.exit(0); });
