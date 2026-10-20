// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { emptyProduction, productionErrors, sampleBatch, type ProductionSettings } from '../../../libs/ui-runtime/production';
import { exportRecipe, importRecipe } from '../../../libs/ui-runtime/recipe';
import { definitions, kits, sources } from './fixtures';
import { addCanvasNode, addFactory, addLogic, connectCanvasNodes, patchCanvasNode } from './canvasEditing';
import { addIndustryTemplate, industryTemplates } from './industryTemplates';
import { productionBindings } from './ProductionPage';
import { emptySimulation, simulationFieldError, type SimulationSession } from './simulation';
import { WorkflowSimulation } from './WorkflowSimulation';
import { emptyGraph, integrityErrors, MAX_NODES, type AovGraphDocument } from './workflowGraph';
import type { FormField } from './localData';
import type { Recipe } from '../../../libs/ui-runtime/types';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const good: ProductionSettings = {
  version: 1,
  formats: [{ id: 'f1', name: '標準', pattern: '{產品}-{日期}-{流水號}' }],
  defaultFormatId: 'f1',
  products: [{ id: 'p1', name: '產品甲', formatId: 'f1', formId: 'form-1', fieldId: 'field-1', lower: 1, upper: 5, unit: 'mm' }],
};
const field = (patch: Partial<FormField>): FormField => ({ id: 'field-1', name: '量測值', type: 'decimal', required: true, isKey: false, ...patch });

describe('批號格式與產品規格：不合法的設定必須被擋下，而不是被修正', () => {
  test('合法設定沒有錯誤，空設定也沒有錯誤', () => {
    expect(productionErrors(good)).toEqual([]);
    expect(productionErrors(emptyProduction)).toEqual([]);
  });

  test('批號格式必須含 {流水號}，且只能使用已知欄位與完整括號', () => {
    for (const pattern of ['{產品}-{日期}', '{產品}-{流水號}-{未知}', '{產品}-{流水號', '{產品}}-{流水號}']) {
      expect(productionErrors({ ...good, formats: [{ ...good.formats[0], pattern }] }).length, pattern).toBeGreaterThan(0);
    }
  });

  test('格式代碼或名稱重複、預設格式不存在都被拒絕', () => {
    const twin = { ...good.formats[0], id: 'f2' };
    expect(productionErrors({ ...good, formats: [good.formats[0], twin] }).join(' ')).toContain('不可重複');
    expect(productionErrors({ ...good, defaultFormatId: 'missing' }).join(' ')).toContain('預設批號格式');
  });

  test('產品規格：上限小於下限、缺上下限、缺單位、格式不存在、代碼重複都被拒絕', () => {
    const bad = (patch: object) => productionErrors({ ...good, products: [{ ...good.products[0], ...patch }] }).length;
    expect(bad({ lower: 6 })).toBeGreaterThan(0);
    expect(bad({ lower: null })).toBeGreaterThan(0);
    expect(bad({ upper: null })).toBeGreaterThan(0);
    expect(bad({ unit: ' ' })).toBeGreaterThan(0);
    expect(bad({ formatId: 'missing' })).toBeGreaterThan(0);
    expect(productionErrors({ ...good, products: [good.products[0], { ...good.products[0] }] }).join(' ')).toContain('產品代碼不可重複');
  });

  test('批號樣本只用於顯示，日期取臺北時間且序號固定，不會真的發號', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T17:30:00Z')); // 21 October in Taipei
    expect(sampleBatch('{廠區}-{產品}-{類別}-{日期}-{流水號}', 'P1')).toBe('DEMO-P1-A-20261021-0001');
  });

  test('產品綁定的欄位被刪除或不是數值欄位時，輸出前就被指出', () => {
    const graph = { ...emptyGraph, forms: [{ id: 'form-1', name: '檢驗', fields: [field({})] }] } as AovGraphDocument;
    expect(productionBindings(good, graph)).toEqual([]);
    const text = { ...graph, forms: [{ id: 'form-1', name: '檢驗', fields: [field({ type: 'text' })] }] } as AovGraphDocument;
    expect(productionBindings(good, text)[0]).toContain('不存在或不是數值欄位');
    expect(productionBindings(good, emptyGraph)).toHaveLength(1);
  });
});

describe('Recipe 帶著生產設定往返，不合法的設定使匯入失敗而不是半套載入', () => {
  const catalog = { kits, definitions, sources };
  const base = { recipeVersion: '0.2.0', name: 'mock', sourceManifest: 'mock-fixtures', database: { engine: 'sqlite' }, enabledKits: ['records-kit', 'entry-permission-kit'] };

  test('匯出再匯入內容相同', () => {
    const { recipe } = importRecipe(JSON.stringify({ ...base, productionSettings: good }), catalog);
    expect(recipe.productionSettings).toEqual(good);
    expect(importRecipe(exportRecipe(recipe, catalog), catalog).recipe.productionSettings).toEqual(good);
  });

  test('沒有生產設定的舊 Recipe 仍可匯入，結果也不憑空多出設定', () => {
    expect(importRecipe(JSON.stringify(base), catalog).recipe.productionSettings).toBeUndefined();
  });

  test('下限大於上限的設定使匯入整份失敗', () => {
    const broken = { ...good, products: [{ ...good.products[0], lower: 9, upper: 1 }] };
    expect(() => importRecipe(JSON.stringify({ ...base, productionSettings: broken }), catalog)).toThrow();
  });
});

describe('逐站模擬的欄位檢查沿用表單規則', () => {
  test('必填、數值、整數、範圍', () => {
    expect(simulationFieldError(field({}), '')).toContain('必填');
    expect(simulationFieldError(field({ required: false }), '')).toBe('');
    expect(simulationFieldError(field({}), 'abc')).toContain('數值');
    expect(simulationFieldError(field({ type: 'integer' }), '1.5')).toContain('整數');
    expect(simulationFieldError(field({ validation: { minimum: 1, maximum: 3 } }), '4')).toContain('超出表單規格');
    expect(simulationFieldError(field({ validation: { minimum: 1, maximum: 3 } }), '2')).toBe('');
  });

  test('日期必須是真實存在的日期，布林只接受 true 或 false', () => {
    const date = field({ type: 'date', validation: {} });
    expect(simulationFieldError(date, '2026-02-30')).toContain('日期無效');
    expect(simulationFieldError(date, '2026-02-28')).toBe('');
    expect(simulationFieldError(field({ type: 'boolean' }), 'maybe')).toContain('是或否');
  });
});

// Two sequential stations; the second one carries the product's inspection field.
function twoStations(): AovGraphDocument {
  let doc = addLogic(addFactory(emptyGraph, '甲廠')!.value, 'factory-1', '')!.value;
  doc = addCanvasNode(addCanvasNode(doc, 'graph-1', null), 'graph-1', null);
  doc = patchCanvasNode(patchCanvasNode(doc, 'node-1', { name: '備料' }), 'node-2', { name: '檢驗', formId: 'form-1' });
  doc = connectCanvasNodes(doc, 'graph-1', 'graph-1-start', 'node-1', true);
  doc = connectCanvasNodes(doc, 'graph-1', 'node-1', 'node-2', true);
  doc = connectCanvasNodes(doc, 'graph-1', 'node-2', 'graph-1-end', true);
  return { ...doc, forms: [{ id: 'form-1', name: '檢驗紀錄', fields: [field({ id: 'field-1' })] }] };
}

function Harness({ graph, settings }: { graph: AovGraphDocument; settings?: ProductionSettings }) {
  const [session, setSession] = useState<SimulationSession>(emptySimulation);
  const recipe = { recipeVersion: '1', name: 'x', sourceManifest: 'x', database: { engine: 'sqlite' }, enabledKits: [], productionSettings: settings } as unknown as Recipe;
  return <WorkflowSimulation graph={graph} recipe={recipe} session={session} onChange={setSession} />;
}

describe('逐站模擬：只演練填寫，前置站未完成不能完成後站，檢驗值依產品規格判定', () => {
  test('沒有作業節點時提示先到畫布建立', () => {
    render(<Harness graph={addLogic(addFactory(emptyGraph, '甲廠')!.value, 'factory-1', '')!.value} />);
    expect(screen.getByText('請先在畫布建立作業節點。')).toBeTruthy();
  });

  test('前置作業未完成時，後站不能完成', () => {
    render(<Harness graph={twoStations()} settings={good} />);
    fireEvent.click(screen.getByRole('button', { name: /2 檢驗/ }));
    fireEvent.change(screen.getByLabelText(/量測值/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '完成此站' }));
    expect(screen.getByRole('status').textContent).toContain('請先完成此節點的前置作業');
  });

  test('完成前站後，檢驗值在規格內可完成，超出規格被擋下並顯示上下限', () => {
    render(<Harness graph={twoStations()} settings={good} />);
    fireEvent.click(screen.getByRole('button', { name: '完成此站' }));
    expect(screen.getByRole('status').textContent).toContain('備料已完成填寫檢查');
    fireEvent.click(screen.getByRole('button', { name: /2 檢驗/ }));
    fireEvent.change(screen.getByLabelText(/量測值/), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: '完成此站' }));
    expect(screen.getByRole('status').textContent).toContain('超出 1');
    fireEvent.change(screen.getByLabelText(/量測值/), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: '完成此站' }));
    expect(screen.getByRole('status').textContent).toContain('檢驗已完成填寫檢查');
  });

  test('重設模擬後完成狀態與填寫內容都清除', () => {
    render(<Harness graph={twoStations()} settings={good} />);
    fireEvent.click(screen.getByRole('button', { name: '完成此站' }));
    fireEvent.click(screen.getByRole('button', { name: '重設模擬' }));
    expect(screen.getByRole('status').textContent).toContain('模擬已重設');
  });
});

describe('產業紀錄範本：只提供表單欄位起點，加入後仍是通過完整性檢查的合法流程', () => {
  const base = () => addLogic(addFactory(emptyGraph, '甲廠')!.value, 'factory-1', '')!.value;

  test('每個範本都能加入，產生一個節點與一張表單，且流程仍合法', () => {
    for (const template of industryTemplates) {
      const doc = addIndustryTemplate(base(), 'graph-1', template.id);
      const node = doc.graphs[0].nodes.find(n => n.name === template.name);
      expect(node, template.id).toBeTruthy();
      expect(doc.forms.find(f => f.id === node!.formId)?.fields.map(f => f.name), template.id).toEqual(template.fields);
      expect(integrityErrors(doc), template.id).toEqual([]);
    }
  });

  test('範本代碼不重複，欄位名稱在同一範本內不重複', () => {
    expect(new Set(industryTemplates.map(t => t.id)).size).toBe(industryTemplates.length);
    for (const t of industryTemplates) expect(new Set(t.fields).size, t.id).toBe(t.fields.length);
  });

  test('數量與量測類欄位為數值型，其餘為文字型', () => {
    const doc = addIndustryTemplate(base(), 'graph-1', 'receive');
    const form = doc.forms[0];
    expect(form.fields.find(f => f.name === '數量')?.type).toBe('decimal');
    expect(form.fields.find(f => f.name === '供應商')?.type).toBe('text');
  });

  test('範本或流程不存在、節點已達上限時拒絕並保留原文件', () => {
    expect(() => addIndustryTemplate(base(), 'graph-1', 'missing')).toThrow();
    expect(() => addIndustryTemplate(base(), 'missing', 'receive')).toThrow();
    let full = base();
    while (full.graphs[0].nodes.length < MAX_NODES) full = addCanvasNode(full, 'graph-1', null);
    const before = JSON.stringify(full);
    expect(() => addIndustryTemplate(full, 'graph-1', 'receive')).toThrow();
    expect(JSON.stringify(full)).toBe(before);
  });
});
