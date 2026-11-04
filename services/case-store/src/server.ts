import { createServer, type Server } from 'node:http';
import type { CaseStore } from '../../../libs/case-store';
import { handle } from './handler';

// Adapts node:http to the pure handler. Loopback only (D176); the GUI reaches it through the Vite proxy, so no CORS.
export const HOST = '127.0.0.1';
const MAX_BODY = 12_000_000; // a 10 MB bundle plus JSON string escaping and the other fields

const loopback = (host: string) => host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
const hostname = (value: string) => { try { return new URL(value).hostname; } catch { return ''; } };

export function createApiServer(store: CaseStore): Server {
  return createServer((req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    // A loopback port is still reachable from any web page the user opens: refuse foreign Host (DNS rebinding) and foreign Origin.
    const origin = req.headers.origin;
    if (!loopback(hostname(`http://${req.headers.host ?? ''}`)) || (origin !== undefined && !loopback(hostname(origin)))) {
      return reply(403, { errors: [{ code: 'E-FORBIDDEN', message: '只接受本機來源。' }] });
    }
    const method = req.method ?? 'GET';
    if (method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
      return reply(415, { errors: [{ code: 'E-INVALID-INPUT', message: '請求須為 application/json。' }] });
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) { reply(413, { errors: [{ code: 'E-INVALID-INPUT', message: '請求過大。' }] }); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body: unknown = null;
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
          return reply(400, { errors: [{ code: 'E-INVALID-INPUT', message: '請求不是有效的 JSON。' }] });
        }
      }
      handle(store, { method, path: new URL(req.url ?? '/', `http://${HOST}`).pathname, body })
        .then(r => reply(r.status, r.body))
        .catch((error: unknown) => {
          console.error(error); // never swallowed: the operator sees the cause, the client sees a generic failure
          reply(500, { errors: [{ code: 'E-INTERNAL', message: '服務內部錯誤，細節在服務記錄。' }] });
        });
    });
  });
}
