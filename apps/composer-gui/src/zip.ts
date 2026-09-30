// Minimal store-only (uncompressed) ZIP writer for the configuration delivery package (D31).
// Deterministic: entries keep caller order and every entry carries the fixed DOS time 1980-01-01 00:00.
export interface ZipEntry { path: string; data: Uint8Array }

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8_NAMES = 0x0800;
const LIMIT = 0xffffffff; // No ZIP64: a larger package must fail loudly instead of writing a corrupt archive.

function checkPath(path: string, seen: Set<string>): void {
  const segments = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || segments.some(s => !s || s === '.' || s === '..')) throw new Error(`壓縮檔路徑不正確：${path}`);
  if (seen.has(path)) throw new Error(`壓縮檔路徑重複：${path}`);
  seen.add(path);
}

export function createZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > 0xffff) throw new Error('壓縮檔的檔案數量超過上限。');
  const seen = new Set<string>();
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = []; const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    checkPath(entry.path, seen);
    const name = encoder.encode(entry.path); const size = entry.data.length; const crc = crc32(entry.data);
    if (size >= LIMIT || offset >= LIMIT) throw new Error('壓縮檔超過 4 GB 上限。');
    const local = new Uint8Array(30 + name.length + size); const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, UTF8_NAMES, true); l.setUint16(8, 0, true);
    l.setUint16(10, 0, true); l.setUint16(12, DOS_DATE, true); l.setUint32(14, crc, true);
    l.setUint32(18, size, true); l.setUint32(22, size, true); l.setUint16(26, name.length, true); l.setUint16(28, 0, true);
    local.set(name, 30); local.set(entry.data, 30 + name.length);
    const central = new Uint8Array(46 + name.length); const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, UTF8_NAMES, true);
    c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, DOS_DATE, true); c.setUint32(16, crc, true);
    c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true);
    // Extra, comment, disk number and attributes stay zero.
    c.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  if (offset + centralSize >= LIMIT) throw new Error('壓縮檔超過 4 GB 上限。');
  const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}
