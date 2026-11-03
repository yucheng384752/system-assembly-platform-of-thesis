import { existsSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import type { GanttResult } from './ganttEstimate';
import { renderGanttSvg } from './ganttSvg';

// Node-side PNG of an estimate, for thesis figures and reports. The browser never imports this file.
// A renderer without a matching font drops the text and still returns an image, so every character is probed first:
// a figure with missing labels is refused, never delivered.
export interface GanttPngOptions {
  /** Output scale, 1 to 4 (default 2). */
  scale?: number;
  /** Font files to use instead of the system fonts, so the figure looks the same on every machine. */
  fontFiles?: string[];
}
export interface GanttPngError { code: 'bad-scale' | 'font-file' | 'font-missing' | 'render'; message: string; chars?: string[] }
export type GanttPngResult =
  | { ok: false; errors: GanttPngError[] }
  | { ok: true; png: Uint8Array; width: number; height: number; scale: number };

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const unescapeXml = (s: string) => s
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
  .replace(/&(lt|gt|quot);/g, m => ENTITIES[m]!)
  .replace(/&amp;/g, '&');

// Every visible character, from <text> elements only (titles are tooltips and are not drawn).
function visibleChars(svg: string): string[] {
  const chars = new Set<string>();
  for (const match of svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)) {
    for (const ch of unescapeXml(match[1]!)) if (ch.trim() !== '') chars.add(ch);
  }
  return [...chars];
}

const CELL = 48, COLUMNS = 20;
// One render for all characters: each is drawn in its own cell, and a cell with no ink means the font has no glyph for it.
function missingGlyphs(chars: string[], family: string, font: { loadSystemFonts: boolean; fontFiles?: string[] }): string[] {
  if (chars.length === 0) return [];
  const rows = Math.ceil(chars.length / COLUMNS);
  const cells = chars.map((ch, i) => `<text x="${(i % COLUMNS) * CELL + 6}" y="${Math.floor(i / COLUMNS) * CELL + 34}" font-size="28" font-family="${family}">${ch.replace(/[&<>"']/g, c => `&#${c.codePointAt(0)};`)}</text>`);
  const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMNS * CELL}" height="${rows * CELL}">${cells.join('')}</svg>`;
  const image = new Resvg(probe, { font, fitTo: { mode: 'original' } }).render();
  const pixels = image.pixels; // a getter that copies the whole buffer on every access: read it once
  return chars.filter((_, i) => {
    const x0 = (i % COLUMNS) * CELL, y0 = Math.floor(i / COLUMNS) * CELL;
    for (let y = y0; y < y0 + CELL; y++) for (let x = x0; x < x0 + CELL; x++) if (pixels[(y * image.width + x) * 4 + 3]! > 0) return false;
    return true;
  });
}

export function renderGanttPng(estimate: Extract<GanttResult, { ok: true }>, options: GanttPngOptions = {}): GanttPngResult {
  const scale = options.scale ?? 2;
  if (!Number.isFinite(scale) || scale < 1 || scale > 4) return { ok: false, errors: [{ code: 'bad-scale', message: '縮放倍率須介於 1 與 4' }] };
  const missingFiles = (options.fontFiles ?? []).filter(file => !existsSync(file));
  if (missingFiles.length > 0) {
    return { ok: false, errors: missingFiles.map(file => ({ code: 'font-file' as const, message: `找不到字型檔：${file}` })) };
  }
  const font = options.fontFiles ? { loadSystemFonts: false, fontFiles: options.fontFiles } : { loadSystemFonts: true };
  const svg = renderGanttSvg(estimate);
  try {
    const family = /<svg\b[^>]*\bfont-family="([^"]*)"/.exec(svg)?.[1] ?? 'sans-serif';
    const chars = visibleChars(svg);
    const missing = missingGlyphs(chars, family, font);
    if (missing.length > 0) {
      return { ok: false, errors: [{ code: 'font-missing', message: `字型缺少 ${missing.length} 個字元，圖上文字會消失；請用 fontFiles 指定含這些字的字型`, chars: missing }] };
    }
    const image = new Resvg(svg, { font, fitTo: { mode: 'zoom', value: scale } }).render();
    return { ok: true, png: new Uint8Array(image.asPng()), width: image.width, height: image.height, scale };
  } catch (error) {
    return { ok: false, errors: [{ code: 'render', message: error instanceof Error ? error.message : String(error) }] };
  }
}
