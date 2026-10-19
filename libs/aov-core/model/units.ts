/**
 * 數量與單位。
 * - 同維度自動換算；跨維度運算是錯誤（必須由節點宣告換算參數）。
 * - 溫度是仿射單位：只支援比較，不支援加減（v1）。
 */

export type Dimension = 'count' | 'mass' | 'volume' | 'length' | 'area' | 'time' | 'temperature' | 'ratio';

interface UnitDef {
  dim: Dimension;
  /** base = value * factor + offset */
  factor: number;
  offset?: number;
}

export const UNITS: Record<string, UnitDef> = {
  pcs: { dim: 'count', factor: 1 },
  ea: { dim: 'count', factor: 1 },
  mg: { dim: 'mass', factor: 1e-6 },
  g: { dim: 'mass', factor: 1e-3 },
  kg: { dim: 'mass', factor: 1 },
  t: { dim: 'mass', factor: 1000 },
  ml: { dim: 'volume', factor: 1e-3 },
  L: { dim: 'volume', factor: 1 },
  l: { dim: 'volume', factor: 1 },
  m3: { dim: 'volume', factor: 1000 },
  mm: { dim: 'length', factor: 1e-3 },
  cm: { dim: 'length', factor: 1e-2 },
  m: { dim: 'length', factor: 1 },
  km: { dim: 'length', factor: 1000 },
  cm2: { dim: 'area', factor: 1e-4 },
  m2: { dim: 'area', factor: 1 },
  ms: { dim: 'time', factor: 1e-3 },
  s: { dim: 'time', factor: 1 },
  min: { dim: 'time', factor: 60 },
  h: { dim: 'time', factor: 3600 },
  d: { dim: 'time', factor: 86400 },
  K: { dim: 'temperature', factor: 1 },
  degC: { dim: 'temperature', factor: 1, offset: 273.15 },
  degF: { dim: 'temperature', factor: 5 / 9, offset: 255.37222222222223 },
  '%': { dim: 'ratio', factor: 0.01 },
};

export const BASE_UNIT: Record<Dimension, string> = {
  count: 'pcs',
  mass: 'kg',
  volume: 'L',
  length: 'm',
  area: 'm2',
  time: 's',
  temperature: 'K',
  ratio: '%',
};

export function isUnit(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(UNITS, name);
}

export function unitDim(unit: string): Dimension {
  const u = UNITS[unit];
  if (!u) throw new Error(`未知單位：${unit}`);
  return u.dim;
}

export function toBase(value: number, unit: string): number {
  const u = UNITS[unit];
  if (!u) throw new Error(`未知單位：${unit}`);
  return value * u.factor + (u.offset ?? 0);
}

export function fromBase(base: number, unit: string): number {
  const u = UNITS[unit];
  if (!u) throw new Error(`未知單位：${unit}`);
  return (base - (u.offset ?? 0)) / u.factor;
}

export function convert(value: number, from: string, to: string): number {
  if (unitDim(from) !== unitDim(to)) {
    throw new Error(`無法換算 ${from} → ${to}：維度不同`);
  }
  return fromBase(toBase(value, from), to);
}

/** 解析時間字串，例如 "30min"、"1h"、"2d"、"90s"，回傳毫秒 */
export function parseDuration(text: string): number {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(ms|s|min|h|d)\s*$/.exec(text);
  if (!m) throw new Error(`無效的時間長度：${text}（例：30min、1h、2d）`);
  return toBase(Number(m[1]), m[2]) * 1000;
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e6) / 1e6);
}
