import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { PNG_SIGNATURE_FOR_TEST, inkIn } from './ganttPngTestSupport';
import { GANTT_DISCLAIMER, type GanttResult, type GanttRow } from './ganttEstimate';
import { renderGanttPng } from './ganttPng';
import { renderGanttSvg } from './ganttSvg';

type Ok = Extract<GanttResult, { ok: true }>;
const row = (over: Partial<GanttRow> & { nodeId: string; name: string }): GanttRow =>
  ({ milestone: false, transferIn: 0, reasons: [], transferAssumedZero: false, ...over });
const estimate = (over: Partial<Ok> = {}): Ok => ({
  ok: true, planId: 'a'.repeat(64), unit: '分鐘', conditions: ['數量 10 kg'], disclaimer: GANTT_DISCLAIMER,
  rows: [row({ nodeId: 'mix', name: '混合', start: 0, end: 30 }), row({ nodeId: 'bake', name: '烘烤', start: 35, end: 80 })],
  total: 80, lowerBound: 80, incomplete: [], ...over,
});
// Real CJK font when the machine has one, so the font-file tests do not depend on system font loading.
const FONT = ['C:/Windows/Fonts/msjh.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'].find(existsSync);
// Loading system fonts takes seconds the first time; the renderer is native, so give it room.
vi.setConfig({ testTimeout: 60_000 });
const widthOf = (png: Uint8Array) => new DataView(png.buffer, png.byteOffset).getUint32(16);
const heightOf = (png: Uint8Array) => new DataView(png.buffer, png.byteOffset).getUint32(20);

describe('renderGanttPng：估算轉成 PNG', () => {
  it.runIf(FONT)('輸出是有效 PNG，尺寸等於 SVG 尺寸乘縮放倍率', () => {
    const e = estimate();
    const svg = renderGanttSvg(e);
    const w = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)![1]), h = Number(/<svg[^>]*\sheight="(\d+)"/.exec(svg)![1]);
    const result = renderGanttPng(e, { scale: 2, fontFiles: [FONT!] });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(Array.from(result.png.slice(0, 8))).toEqual(PNG_SIGNATURE_FOR_TEST);
    expect([widthOf(result.png), heightOf(result.png)]).toEqual([w * 2, h * 2]);
    expect([result.width, result.height]).toEqual([w * 2, h * 2]);
  });

  it.runIf(FONT)('預設倍率為 2，且 1 倍與 3 倍的尺寸成比例', () => {
    const fontFiles = [FONT!];
    const one = renderGanttPng(estimate(), { scale: 1, fontFiles }), three = renderGanttPng(estimate(), { scale: 3, fontFiles }), dflt = renderGanttPng(estimate(), { fontFiles });
    if (!one.ok || !three.ok || !dflt.ok) throw new Error('render failed');
    expect([three.width, three.height]).toEqual([one.width * 3, one.height * 3]);
    expect([dflt.width, dflt.height]).toEqual([one.width * 2, one.height * 2]);
  });

  it.runIf(FONT)('畫面上真的有內容：長條的主色出現在圖中，缺資料的列不畫長條', () => {
    const fontFiles = [FONT!];
    const complete = renderGanttPng(estimate(), { scale: 1, fontFiles });
    const empty = renderGanttPng(estimate({
      rows: [row({ nodeId: 'mix', name: '混合', reasons: ['缺工時'] }), row({ nodeId: 'bake', name: '烘烤', reasons: ['缺工時'] })], total: null, lowerBound: 0, incomplete: ['mix', 'bake'],
    }), { scale: 1, fontFiles });
    if (!complete.ok || !empty.ok) throw new Error('render failed');
    expect(inkIn(complete.png, [0x07, 0x5e, 0x54])).toBeGreaterThan(500); // DESIGN.md primary
    expect(inkIn(empty.png, [0x07, 0x5e, 0x54])).toBe(0);
  });

  it('倍率超出 1 到 4 或不是數字時拒絕，不猜', () => {
    for (const scale of [0, 0.5, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = renderGanttPng(estimate(), { scale });
      expect(result).toMatchObject({ ok: false, errors: [{ code: 'bad-scale' }] });
    }
  });

  it('指定的字型檔不存在時明確報錯，而不是默默輸出沒有文字的圖', () => {
    const result = renderGanttPng(estimate(), { fontFiles: ['C:/no/such/font.ttf'] });
    expect(result).toMatchObject({ ok: false, errors: [{ code: 'font-file' }] });
  });

  it('找不到任何字型時拒絕輸出，並列出缺字', () => {
    // A real, readable file that is not a font gives the renderer zero fonts: every label would vanish.
    const notAFont = new URL('./ganttPng.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const result = renderGanttPng(estimate(), { fontFiles: [notAFont] });
    expect(result).toMatchObject({ ok: false, errors: [{ code: 'font-missing' }] });
    if (!result.ok) expect(result.errors[0]!.chars).toEqual(expect.arrayContaining(['混', '合']));
  });

  it.runIf(FONT)('有 CJK 字型檔時，文字確實畫出（含免責聲明與列名）', () => {
    const withText = renderGanttPng(estimate(), { scale: 1, fontFiles: [FONT!] });
    if (!withText.ok) throw new Error(JSON.stringify(withText.errors));
    expect(inkIn(withText.png, [0x17, 0x2b, 0x3a], 40)).toBeGreaterThan(30); // DESIGN.md text colour, only text uses it
  });

  it.runIf(FONT)('特殊字元（& < > 引號）出現在名稱時不會破壞輸出', () => {
    const odd = estimate({ rows: [row({ nodeId: 'a', name: `混合 & "攪拌" <A> 'B'`, start: 0, end: 10 })], total: 10, lowerBound: 10 });
    const result = renderGanttPng(odd, { scale: 1, fontFiles: [FONT!] });
    expect(result.ok).toBe(true);
  });

  it('不指定字型檔而用系統字型時：要嘛成功並有文字，要嘛明確回報缺字，不會交出沒有文字的圖', () => {
    const result = renderGanttPng(estimate(), { scale: 1 });
    if (result.ok) expect(inkIn(result.png, [0x17, 0x2b, 0x3a], 40)).toBeGreaterThan(30);
    else expect(result.errors[0]!.code).toBe('font-missing');
  });
});
