// 假的 PDF 轉檔服務：來源系統與產出系統接同一個（handoff 第 4.3 節）。
// S4 比的是「系統如何處理轉檔結果」，不比轉檔品質，所以這裡只回固定內容。
//
// 行為由上傳的 PDF 檔名決定，三種情況：
//   檔名含 "fail"  → 回 HTTP 500
//   檔名含 "hang"  → 收到請求後不回應（讓呼叫端逾時）
//   其他           → 回固定的 ZIP（內容由 lib/synthetic.mjs 的 pdfConversionOutputs 決定）
//
// 介面依來源 be/services/pdf_conversion.py 第 82 至 156 行：
//   POST <PDF_SERVER_URL>/process，multipart 欄位 table 與 files；回應不是 JSON 時當作 ZIP。
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { buildStoredZip } from './lib/zip.mjs';
import { pdfConversionOutputs } from './lib/synthetic.mjs';

export function classifyPdfRequest(filename) {
  const name = String(filename || '').toLowerCase();
  if (name.includes('fail')) return 'fail';
  if (name.includes('hang')) return 'hang';
  return 'ok';
}

// 只取 multipart 內第一個檔案的檔名；不解析內容（內容不影響回傳）。
export function extractUploadFilename(bodyBuffer) {
  const match = /filename="([^"]*)"/.exec(bodyBuffer.toString('latin1'));
  return match ? Buffer.from(match[1], 'latin1').toString('utf8') : '';
}

export function createFakePdfServer({ log = () => {} } = {}) {
  const hanging = new Set();
  const requests = [];

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const filename = extractUploadFilename(Buffer.concat(chunks));
      const mode = req.method === 'POST' ? classifyPdfRequest(filename) : 'not-found';
      requests.push({ method: req.method, url: req.url, filename, mode });
      log(`${req.method} ${req.url} filename=${filename} -> ${mode}`);

      if (mode === 'not-found') {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      if (mode === 'fail') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('synthetic conversion failure');
        return;
      }
      if (mode === 'hang') {
        hanging.add(res);
        res.on('close', () => hanging.delete(res));
        return;
      }
      const zip = buildStoredZip(pdfConversionOutputs(filename));
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': zip.length });
      res.end(zip);
    });
  });

  return {
    requests,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      for (const res of hanging) res.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.FAKE_PDF_PORT ?? 18090);
  // 只綁本機；容器內的系統要連線時，由操作者另行決定綁定位址（FAKE_PDF_HOST）。
  const host = process.env.FAKE_PDF_HOST ?? '127.0.0.1';
  const fake = createFakePdfServer({ log: (line) => console.log(`[fake-pdf] ${line}`) });
  const actual = await fake.listen(port, host);
  console.log(`[fake-pdf] listening on http://${host}:${actual}（PDF_SERVER_URL 設為這個位址）`);
}
