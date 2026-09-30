// Test-only ZIP reader that follows the PKWARE APPNOTE layout, used to check createZip output independently.
export interface ReadEntry { path: string; data: Uint8Array; crc: number; flags: number; method: number; date: number; time: number }
export function readZip(bytes: Uint8Array): ReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error('missing end of central directory');
  const count = view.getUint16(end + 10, true); let at = view.getUint32(end + 16, true);
  if (at + view.getUint32(end + 12, true) !== end) throw new Error('central directory size mismatch');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries: ReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('bad central header');
    const nameLength = view.getUint16(at + 28, true); const size = view.getUint32(at + 20, true); const local = view.getUint32(at + 42, true);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error('bad local header');
    const localName = view.getUint16(local + 26, true); const localExtra = view.getUint16(local + 28, true);
    if (decoder.decode(bytes.subarray(local + 30, local + 30 + localName)) !== path || view.getUint32(local + 14, true) !== view.getUint32(at + 16, true)) throw new Error('local and central headers disagree');
    const start = local + 30 + localName + localExtra;
    entries.push({ path, data: bytes.subarray(start, start + size), crc: view.getUint32(at + 16, true), flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true), time: view.getUint16(at + 12, true), date: view.getUint16(at + 14, true) });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return entries;
}
