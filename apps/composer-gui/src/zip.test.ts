import { expect, test } from 'vitest';
import { crc32, createZip } from './zip';
import { readZip } from './testZip';

const text = (value: string) => new TextEncoder().encode(value);
test('CRC32 matches the standard check value, so unzip tools accept the entries', () => {
  expect(crc32(text('123456789'))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});
test('entries round-trip with UTF-8 names, store method and the fixed 1980-01-01 time (D31)', () => {
  const entries = [{ path: 'package-manifest.json', data: text('{}') }, { path: 'aov/流程.json', data: text('{"名稱":"收料"}') }];
  const read = readZip(createZip(entries));
  expect(read.map(e => e.path)).toEqual(['package-manifest.json', 'aov/流程.json']);
  expect(new TextDecoder().decode(read[1].data)).toBe('{"名稱":"收料"}');
  for (const entry of read) {
    expect(entry.method).toBe(0);
    expect(entry.flags & 0x0800).toBe(0x0800);
    expect([entry.date, entry.time]).toEqual([0x21, 0]);
    expect(entry.crc).toBe(crc32(entry.data));
  }
});
test('same input gives identical bytes, so a package can be compared byte for byte (A12, A15)', () => {
  const entries = () => [{ path: 'a.json', data: text('1') }, { path: 'b/c.json', data: text('2') }];
  expect(createZip(entries())).toEqual(createZip(entries()));
});
test('paths that could escape the extract folder or collide are refused, not silently rewritten', () => {
  for (const path of ['../evil.json', '/abs.json', 'a\\b.json', 'a//b.json', './a.json', '']) {
    expect(() => createZip([{ path, data: text('x') }])).toThrow('壓縮檔路徑不正確');
  }
  expect(() => createZip([{ path: 'a.json', data: text('1') }, { path: 'a.json', data: text('2') }])).toThrow('壓縮檔路徑重複');
});
