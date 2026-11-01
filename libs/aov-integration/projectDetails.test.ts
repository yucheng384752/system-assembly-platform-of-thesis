import { describe, expect, it } from 'vitest';
import { checkProjectDetails, emptyProjectDetails, materialTypeId, type ProjectDetails } from './projectDetails';

const details = (patch: Partial<ProjectDetails> = {}): ProjectDetails => ({
  ...emptyProjectDetails,
  materials: [{ key: 'ingot', name: '原料錫錠', dimension: 'mass', baseUnit: 'kg' }, { key: 'bar', name: '錫棒', dimension: 'mass', baseUnit: 'kg' }],
  nodes: {
    n1: { kind: 'pick', location: 'wh.raw', material: 'ingot' },
    n2: { kind: 'sink', direction: 'stock-in', location: 'wh.fg', material: 'bar' },
  },
  ...patch,
});
const codes = (raw: unknown) => checkProjectDetails(raw).map(i => i.code);

describe('專案細項檔：物料型別與節點的物料流設定', () => {
  it('完整的細項與空檔案通過；型別識別碼固定為 lot.<key>', () => {
    expect(checkProjectDetails(details())).toEqual([]);
    expect(checkProjectDetails(emptyProjectDetails)).toEqual([]);
    expect(materialTypeId('ingot')).toBe('lot.ingot');
  });

  it('物料型別：中文識別碼、缺名稱、重複識別碼都被指出', () => {
    const bad = (m: object[]) => codes(details({ materials: m as never, nodes: {} }));
    expect(bad([{ key: '錫錠', name: 'x', dimension: 'mass', baseUnit: 'kg' }])).toEqual(['material-key']);
    expect(bad([{ key: 'a', name: ' ', dimension: 'mass', baseUnit: 'kg' }])).toContain('material-name');
    const duplicate = bad([{ key: 'ingot', name: 'a', dimension: 'mass', baseUnit: 'kg' }, { key: 'ingot', name: 'b', dimension: 'mass', baseUnit: 'kg' }]);
    expect(duplicate).toContain('material-duplicate');
  });

  it('單位必須屬於所選量綱：以公斤計的物料不能寫成公升，也不接受未知單位', () => {
    const bad = (dimension: string, baseUnit: string) => codes(details({ materials: [{ key: 'a', name: 'a', dimension, baseUnit } as never], nodes: {} }));
    expect(bad('mass', 'L')).toEqual(['material-unit']);
    expect(bad('mass', 'furlong')).toEqual(['material-unit']);
    expect(bad('temperature', 'K')).toEqual(['material-dimension']); // not something a lot is made of
    expect(bad('count', 'pcs')).toEqual([]);
  });

  it('領料與入庫出庫節點都要有倉位代碼與存在的物料型別', () => {
    const nodes = (n: object) => codes(details({ nodes: { n1: n } as never }));
    expect(nodes({ kind: 'pick', location: 'wh.raw', material: 'ghost' })).toEqual(['behavior-material']);
    expect(nodes({ kind: 'pick', location: '原料倉', material: 'ingot' })).toEqual(['behavior-location']);
    expect(nodes({ kind: 'pick', location: '', material: 'ingot' })).toEqual(['behavior-location']);
  });

  it('入庫出庫節點沒有選方向就不成立：不預設成入庫', () => {
    const nodes = (n: object) => codes(details({ nodes: { n1: n } as never }));
    expect(nodes({ kind: 'sink', location: 'wh.fg', material: 'bar' })).toEqual(['behavior-direction']);
    expect(nodes({ kind: 'sink', direction: 'toString', location: 'wh.fg', material: 'bar' })).toEqual(['behavior-direction']);
    for (const direction of ['stock-in', 'ship-customer', 'ship-external']) {
      expect(nodes({ kind: 'sink', direction, location: 'x1', material: 'bar' })).toEqual([]);
    }
  });

  it('未知類別、結構不對都回報錯誤而不是丟出例外；錯誤帶節點識別碼', () => {
    const issues = checkProjectDetails(details({ nodes: { n7: { kind: 'transform' } as never } }));
    expect(issues).toEqual([expect.objectContaining({ code: 'behavior-kind', nodeId: 'n7' })]);
    for (const raw of [null, [], {}, { ...emptyProjectDetails, version: 2 }, { ...emptyProjectDetails, materials: {} }, { ...emptyProjectDetails, nodes: { a: 5 } }]) {
      expect(checkProjectDetails(raw).length, JSON.stringify(raw)).toBeGreaterThan(0);
    }
  });
});
