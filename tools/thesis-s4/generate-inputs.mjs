// 把合成輸入檔寫到指定資料夾，並輸出清單（檔名、用途、SHA-256）。
// 用法：node tools/thesis-s4/generate-inputs.mjs <輸出資料夾>
// 輸出資料夾不進 repo；內容可由本腳本重新產生。
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inputFiles, pdfConversionOutputs } from './lib/synthetic.mjs';
import { buildStoredZip } from './lib/zip.mjs';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function buildManifest() {
  const files = Object.values(inputFiles()).map((file) => ({
    key: file.key,
    name: file.name,
    table: file.table,
    purpose: file.purpose,
    bytes: file.data.length,
    sha256: sha256(file.data),
  }));
  const zip = buildStoredZip(pdfConversionOutputs());
  return { files, pdfConversionZip: { bytes: zip.length, sha256: sha256(zip) } };
}

export function writeInputs(outDir) {
  mkdirSync(outDir, { recursive: true });
  // 有兩個用途不同但檔名相同的檔案（修正前與修正後），所以各自放在以 key 命名的子資料夾
  for (const file of Object.values(inputFiles())) {
    const dir = path.join(outDir, file.key);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, file.name), file.data);
  }
  writeFileSync(path.join(outDir, 'pdf-conversion-output.zip'), buildStoredZip(pdfConversionOutputs()));
  const manifest = buildManifest();
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outDir = process.argv[2];
  if (!outDir) {
    console.error('用法：node tools/thesis-s4/generate-inputs.mjs <輸出資料夾>');
    process.exit(2);
  }
  const manifest = writeInputs(path.resolve(outDir));
  console.log(`已寫出 ${manifest.files.length} 個輸入檔與假轉檔服務的回傳內容到 ${path.resolve(outDir)}`);
}
