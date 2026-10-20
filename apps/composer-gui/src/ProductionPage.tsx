import { Column } from './Column';
import { emptyProduction, productionErrors, sampleBatch, type ProductionSettings } from '../../../libs/ui-runtime/production';
import type { Recipe } from '../../../libs/ui-runtime/types';
import type { AovGraphDocument } from './workflowGraph';
export function productionBindings(s: ProductionSettings, graph: AovGraphDocument): string[] {
  return s.products.filter(p => !graph.forms.some(f => f.id === p.formId && f.fields.some(x => x.id === p.fieldId && ['integer', 'decimal'].includes(x.type)))).map(p => `「${p.name}」的檢驗欄位不存在或不是數值欄位，請重新指定。`);
}
export function ProductionPage({ recipe, onChange, graph }: { recipe: Recipe; onChange: (r: Recipe) => void; graph: AovGraphDocument }) {
  const s = recipe.productionSettings ?? emptyProduction;
  const save = (next: ProductionSettings) => onChange({ ...recipe, productionSettings: next });
  const errors = [...productionErrors(s), ...productionBindings(s, graph)];
  return <div className="columns production-columns">
    <Column id="formats" title="批號格式" scroll lead="設定初始格式，可依產品使用不同格式。樣本不會實際發號。">
      {s.formats.map((f, i) => <fieldset key={f.id}><legend>格式 {i + 1}</legend>
        <label>格式名稱<input maxLength={60} value={f.name} onChange={e => save({ ...s, formats: s.formats.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} /></label>
        <label>格式內容<input maxLength={180} value={f.pattern} onChange={e => save({ ...s, formats: s.formats.map((x, j) => j === i ? { ...x, pattern: e.target.value } : x) })} /></label>
        <p>樣本：{sampleBatch(f.pattern, 'PRODUCT')}</p><button disabled={f.id === s.defaultFormatId || s.products.some(p => p.formatId === f.id)} onClick={() => save({ ...s, formats: s.formats.filter(x => x.id !== f.id) })}>移除格式</button>
      </fieldset>)}
      <button onClick={() => { const id = crypto.randomUUID(); save({ ...s, formats: [...s.formats, { id, name: `格式 ${s.formats.length + 1}`, pattern: '{產品}-{日期}-{流水號}' }], defaultFormatId: s.defaultFormatId || id }); }}>新增批號格式</button>
      <label>預設格式<select value={s.defaultFormatId} onChange={e => save({ ...s, defaultFormatId: e.target.value })}><option value="">請選擇</option>{s.formats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <p>可用欄位：{'{廠區}、{產品}、{類別}、{日期}、{流水號}'}。預設或被產品引用的格式不可移除。</p>
    </Column>
    <Column id="products" title="產品與檢驗規格" scroll lead="綁定流程中的數值欄位，設定初始上下限；模擬會同步套用。">
      {s.products.map((p, i) => { const update = (patch: Partial<typeof p>) => save({ ...s, products: s.products.map((x, j) => j === i ? { ...x, ...patch } : x) }); return <fieldset key={i}><legend>產品 {i + 1}</legend>
        <label>產品代碼<input maxLength={60} value={p.id} onChange={e => update({ id: e.target.value })} /></label><label>產品名稱<input maxLength={100} value={p.name} onChange={e => update({ name: e.target.value })} /></label>
        <label>批號格式<select value={p.formatId} onChange={e => update({ formatId: e.target.value })}><option value="">請選擇</option>{s.formats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>檢驗表單<select value={p.formId} onChange={e => update({ formId: e.target.value, fieldId: '' })}><option value="">請選擇</option>{graph.forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>檢驗欄位<select value={p.fieldId} onChange={e => update({ fieldId: e.target.value })}><option value="">請選擇數值欄位</option>{graph.forms.find(f => f.id === p.formId)?.fields.filter(f => ['integer', 'decimal'].includes(f.type)).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        {(['lower', 'upper'] as const).map(k => <label key={k}>{k === 'lower' ? '下限' : '上限'}<input type="number" step="any" value={p[k] ?? ''} onChange={e => update({ [k]: e.target.value === '' ? null : e.target.valueAsNumber })} /></label>)}
        <label>單位<input maxLength={20} value={p.unit} onChange={e => update({ unit: e.target.value })} /></label><button onClick={() => save({ ...s, products: s.products.filter((_, j) => j !== i) })}>移除產品</button>
      </fieldset>; })}
      <button onClick={() => save({ ...s, products: [...s.products, { id: '', name: '', formatId: s.defaultFormatId, formId: '', fieldId: '', lower: null, upper: null, unit: '' }] })}>新增產品規格</button>
    </Column>
    <Column id="production-status" title="設定檢查" scroll><p>變更即時保留於本次工作階段，下載後可重新匯入。此處是初始設定，不覆寫場域鎖定的 Kit 設定，也不代表後端已套用。</p><div role="status">{errors.length ? <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : '設定檢查通過。'}</div></Column>
  </div>;
}
