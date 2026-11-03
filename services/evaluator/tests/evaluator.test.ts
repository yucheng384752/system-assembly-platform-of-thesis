import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import vectors from '../../../fixtures/evaluator/vectors.json';
import version from '../../../libs/aov-core/VERSION.json';
// @ts-expect-error plain JS module, typed by its JSDoc
import { bundleEvaluator } from '../build.mjs';
import { MAX_REQUEST_BYTES, respond } from '../src/protocol';

const NOW = '2026-10-29T00:00:00Z';
const call = (request: Record<string, unknown>) => JSON.parse(respond(JSON.stringify(request)));
const guard = (expr: string, extra: Record<string, unknown> = {}) => call({ id: 1, op: 'evaluate', mode: 'guard', expr, now: NOW, ...extra });

describe('求值器側車的請求處理（契約 8.1 第 16 項）', () => {
  it('hello 回報固定快照的 aov-core commit，這是工廠端比對 source.aovCoreCommit 的依據', () => {
    expect(call({ id: 7, op: 'hello' })).toEqual({ id: 7, ok: true, commit: version.commit, protocol: 1 });
    expect(vectors.aovCommit).toBe(version.commit); // vectors recorded against another core must be regenerated, not trusted
  });

  for (const vector of vectors.vectors) {
    it(`向量：${vector.name}`, () => {
      expect(call(vector.request)).toEqual(vector.response);
    });
  }

  it('相同請求永遠得到相同回應：求值器不讀時鐘，now 由呼叫端給', () => {
    const request = { id: 1, op: 'evaluate', mode: 'value', expr: 'now', now: NOW };
    expect(respond(JSON.stringify(request))).toBe(respond(JSON.stringify(request)));
    expect(call({ ...request, now: '2030-01-01T00:00:00Z' }).value).toEqual({ $datetime: '2030-01-01T00:00:00.000Z' });
  });

  it('參數與 now 只能由請求欄位設定，不能經 vars 偷換', () => {
    for (const name of ['params', 'now']) expect(guard('true', { vars: { [name]: 1 } })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
  });

  it('壞請求一律回結構化錯誤而不是丟出例外', () => {
    const base = '{"id":1,"op":"evaluate","mode":"guard","expr":"true","now":"2026-10-29T00:00:00Z"';
    for (const line of ['[]', '"x"', '{', '{"op":"nope"}', '{"id":1,"op":"evaluate","mode":"x","expr":"1","now":"2026-10-29T00:00:00Z"}',
                        '{"id":1,"op":"evaluate","mode":"guard","expr":"  ","now":"2026-10-29T00:00:00Z"}',
                        base + ',"params":[]}', base + ',"artifactTypes":{}}', base + ',"vars":{"a":null}}',
                        '{"id":1,"op":"guards","guard":5,"now":"2026-10-29T00:00:00Z"}']) {
      const answer = JSON.parse(respond(line));
      expect(answer.ok, line).toBe(false);
      expect(answer.error.code, line).toMatch(/^bad-/);
    }
  });

  it('artifact 缺欄位或單位不明時拒絕，不補預設值', () => {
    const bad = (a: unknown) => guard('true', { vars: { self: { $artifact: a } } });
    expect(bad({ id: 'A', type: 't', version: 1, attrs: {} })).toMatchObject({ ok: false, error: { code: 'bad-value' } });
    expect(bad({ id: 'A', type: 't', version: 1, attrs: {}, createdAt: 0, qty: { value: 1, unit: 'furlong' } })).toMatchObject({ ok: false });
  });

  it('標記物件不能夾帶其他鍵，數值必須有限（1e999 在 JSON 裡會讀成無限大）', () => {
    expect(guard('true', { vars: { x: { $datetime: NOW, extra: 1 } } })).toMatchObject({ ok: false, error: { code: 'bad-value' } });
    const answer = JSON.parse(respond('{"id":1,"op":"evaluate","mode":"guard","expr":"true","now":"2026-10-29T00:00:00Z","params":{"x":1e999}}'));
    expect(answer).toMatchObject({ ok: false, error: { code: 'bad-value' } });
  });

  it('單一字串 guard 與空 guard 也能求值', () => {
    expect(call({ id: 1, op: 'guards', guard: 'params.x > 1', params: { x: 2 }, now: NOW }).items).toEqual([{ label: '條件', status: 'true' }]);
    expect(call({ id: 1, op: 'guards', now: NOW }).items).toEqual([]);
  });

  it('同一組規則與型別重複使用快取結果，內容不同則重新編譯', () => {
    const rules = (expr: string) => [{ id: 'r', params: ['x'], expr }];
    expect(guard('r(5)', { rules: rules('x > 3') }).status).toBe('true');
    expect(guard('r(5)', { rules: rules('x > 9') }).status).toBe('false');
  });
});

describe('打包後的程序（工廠端實際執行的形式）', () => {
  let directory: string;
  let bundle: string;
  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'evaluator-'));
    bundle = path.join(directory, 'evaluator.cjs');
    writeFileSync(bundle, await bundleEvaluator());
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it('打包兩次位元組相同，且不含建置機的絕對路徑', async () => {
    const first = await bundleEvaluator();
    expect(Buffer.compare(first, await bundleEvaluator())).toBe(0);
    const text = first.toString('utf8');
    expect(text).not.toContain(process.cwd().replaceAll('\\', '\\\\'));
    expect(text).not.toMatch(/[A-Za-z]:\\\\Users/);
  });

  it('經標準輸入輸出逐行回應；stdout 只有回應，結果與直接呼叫相同', () => {
    const lines = vectors.vectors.map(v => JSON.stringify(v.request));
    const input = ['{"id":0,"op":"hello"}', ...lines, '', 'junk'].join('\n') + '\n';
    const out = execFileSync(process.execPath, [bundle], { input, encoding: 'utf8' }).trim().split('\n');
    expect(out).toHaveLength(vectors.vectors.length + 2);
    expect(JSON.parse(out[0]).commit).toBe(version.commit);
    vectors.vectors.forEach((v, i) => expect(JSON.parse(out[i + 1])).toEqual(v.response));
    expect(JSON.parse(out[out.length - 1])).toMatchObject({ ok: false, error: { code: 'bad-json' } });
  });

  it('過大的請求被拒絕且之後的請求仍正常處理', async () => {
    const child = spawn(process.execPath, [bundle], { stdio: ['pipe', 'pipe', 'inherit'] });
    const answers: string[] = [];
    child.stdout.setEncoding('utf8').on('data', (d: string) => answers.push(d));
    child.stdin.write('x'.repeat(MAX_REQUEST_BYTES + 10));
    await new Promise(resolve => setTimeout(resolve, 300)); // the oversized line is refused before its end arrives
    child.stdin.write('x'.repeat(100) + '\n{"id":5,"op":"hello"}\n');
    child.stdin.end();
    await new Promise(resolve => child.on('close', resolve));
    const lines = answers.join('').trim().split('\n').map(l => JSON.parse(l));
    expect(lines[0]).toMatchObject({ ok: false, error: { code: 'too-large' } });
    expect(lines[lines.length - 1]).toMatchObject({ id: 5, ok: true });
    expect(lines).toHaveLength(2);
  });

  it('標準輸入關閉就結束', async () => {
    const child = spawn(process.execPath, [bundle], { stdio: ['pipe', 'ignore', 'inherit'] });
    child.stdin.end();
    expect(await new Promise(resolve => child.on('close', resolve))).toBe(0);
  });
});
