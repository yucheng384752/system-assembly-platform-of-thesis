import { UNITS } from '../../../libs/aov-core';
import { reportLogics } from '../../../libs/aov-integration/canvasToProject';
import {
  checkProjectDetails, MATERIAL_DIMENSIONS, orphanNodeIds, SINK_DIRECTIONS, type MaterialDimension, type MaterialType, type NodeBehavior, type ProjectDetails, type SinkDirection,
} from '../../../libs/aov-integration/projectDetails';
import type { FormLibrary } from '../../../libs/aov-integration/formLibrary';
import type { FormRequirement } from '../../../libs/aov-integration/formRequirement';
import { Column } from './Column';
import { FormLibraryPanel } from './FormLibraryPanel';
import { Icon } from './Icons';
import type { AovGraphDocument } from './workflowGraph';

const DIMENSION_LABEL: Record<MaterialDimension, string> = { count: '個數', mass: '質量', volume: '體積', length: '長度', area: '面積' };
const unitsOf = (dimension: MaterialDimension) => Object.entries(UNITS).filter(([, u]) => u.dim === dimension).map(([name]) => name);
type Kind = '' | NodeBehavior['kind'];

// The first message to show while the step cannot be confirmed: a half-filled setting, never a node that simply has none yet.
export const nodeDetailsError = (details: ProjectDetails) => checkProjectDetails(details)[0]?.message ?? '';

export function NodeDetailsStep({ graph, details, forms, onChange, onFormsChange }: {
  graph: AovGraphDocument; details: ProjectDetails; forms: FormLibrary; onChange: (next: ProjectDetails) => void; onFormsChange: (next: FormLibrary) => void;
}) {
  const issues = checkProjectDetails(details);
  const orphans = orphanNodeIds(details, new Set(graph.graphs.flatMap(g => g.nodes.map(n => n.id))));
  const reports = reportLogics(graph, details, forms);
  const used = new Set(Object.values(details.nodes).map(b => b.material));
  const usedForms = new Set(Object.values(details.nodes).flatMap(b => b.kind === 'fill' && b.form ? [b.form] : []));
  const setMaterial = (index: number, patch: Partial<MaterialType>) => onChange({ ...details, materials: details.materials.map((m, i) => i === index ? { ...m, ...patch } : m) });
  const setNode = (id: string, behavior: NodeBehavior | undefined) => {
    const { [id]: _removed, ...rest } = details.nodes;
    onChange({ ...details, nodes: behavior ? { ...rest, [id]: behavior } : rest });
  };
  const changeKind = (id: string, kind: Kind) => {
    const current = details.nodes[id];
    const keep = { location: current && current.kind !== 'fill' ? current.location : '', material: current?.material ?? '' };
    if (kind === '') setNode(id, undefined);
    else if (kind === 'fill') setNode(id, { kind, material: keep.material, form: '', requires: {} });
    else setNode(id, kind === 'pick' ? { kind, ...keep } : { kind, direction: current?.kind === 'sink' ? current.direction : '', ...keep });
  };
  const nextKey = () => { let n = details.materials.length + 1; while (details.materials.some(m => m.key === `material${n}`)) n++; return `material${n}`; };

  return <div className="columns production-columns">
    <Column id="materials" title="物料型別與表單" scroll lead="流程中流動的實體，例如原料與成品。每個節點要選擇它處理哪一種物料。">
      {details.materials.map((m, i) => {
        const inUse = used.has(m.key);
        return <fieldset key={i}><legend>物料型別 {i + 1}{m.name.trim() ? `：${m.name.trim()}` : ''}</legend>
          <label>名稱<input maxLength={60} value={m.name} onChange={e => setMaterial(i, { name: e.target.value })} /></label>
          <label>量綱<select value={m.dimension} onChange={e => { const dimension = e.target.value as MaterialDimension; setMaterial(i, { dimension, baseUnit: unitsOf(dimension)[0] }); }}>
            {MATERIAL_DIMENSIONS.map(d => <option key={d} value={d}>{DIMENSION_LABEL[d]}</option>)}</select></label>
          <label>計量單位<select value={m.baseUnit} onChange={e => setMaterial(i, { baseUnit: e.target.value })}>{unitsOf(m.dimension).map(u => <option key={u} value={u}>{u}</option>)}</select></label>
          <details><summary>進階</summary>
            <label>識別碼（英文字母、數字與底線）<input maxLength={40} value={m.key} readOnly={inUse} aria-describedby={inUse ? `material-${i}-locked` : undefined} onChange={e => setMaterial(i, { key: e.target.value })} /></label>
            {inUse && <p id={`material-${i}-locked`}>已有節點使用，不能更改識別碼。</p>}
          </details>
          <button disabled={inUse} aria-describedby={inUse ? `material-${i}-in-use` : undefined} onClick={() => onChange({ ...details, materials: details.materials.filter((_, j) => j !== i) })}>移除物料型別</button>
          {inUse && <p id={`material-${i}-in-use`}>已有節點使用，請先改掉節點的選擇再移除。</p>}
        </fieldset>;
      })}
      <button onClick={() => onChange({ ...details, materials: [...details.materials, { key: nextKey(), name: '', dimension: 'mass', baseUnit: 'kg' }] })}>新增物料型別</button>
      <FormLibraryPanel forms={forms} materials={details.materials} usedFormIds={usedForms} onChange={onFormsChange} />
    </Column>

    <Column id="node-settings" title="節點的物料流" scroll lead="只列出流程最上層的節點。目前可設定領料、入庫與出庫；其他節點尚未支援，會在右側標示。">
      {!graph.factories.length && <p>請先在「流程畫布」建立工廠與生產邏輯。</p>}
      {graph.factories.map(factory => factory.logicGraphIds.map(graphId => graph.graphs.find(g => g.id === graphId)).map(logic => logic && <section key={logic.id} aria-label={`${factory.name.trim() || '（未命名工廠）'} / ${logic.name.trim() || '（未命名生產邏輯）'}`}>
        <h3>{factory.name.trim() || '（未命名工廠）'} / {logic.name.trim() || '（未命名生產邏輯）'}</h3>
        {!logic.nodes.some(n => n.kind === 'node') && <p>這個生產邏輯還沒有節點。</p>}
        {logic.nodes.filter(n => n.kind === 'node').map(node => {
          const behavior = details.nodes[node.id];
          const name = node.name.trim() || '（未命名節點）';
          return <fieldset key={node.id}><legend>{name}</legend>
            <label>物料流類別<select value={behavior?.kind ?? ''} onChange={e => changeKind(node.id, e.target.value as Kind)}>
              <option value="">尚未設定</option><option value="pick">領料</option><option value="fill">填單</option><option value="sink">入庫或出庫</option></select></label>
            {behavior?.kind === 'sink' && <label>方向<select value={behavior.direction} onChange={e => setNode(node.id, { ...behavior, direction: e.target.value as SinkDirection | '' })}>
              <option value="">請選擇</option>{(Object.keys(SINK_DIRECTIONS) as SinkDirection[]).map(d => <option key={d} value={d}>{SINK_DIRECTIONS[d]}</option>)}</select></label>}
            {behavior && <>
              {behavior.kind !== 'fill' && <label>倉位代碼<input maxLength={60} value={behavior.location} placeholder="例如 wh.raw" onChange={e => setNode(node.id, { ...behavior, location: e.target.value })} /></label>}
              <label>物料型別<select value={behavior.material} onChange={e => setNode(node.id, { ...behavior, material: e.target.value })}>
                <option value="">請選擇</option>{details.materials.map(m => <option key={m.key} value={m.key}>{m.name.trim() || m.key}</option>)}</select></label>
            </>}
            {behavior?.kind === 'fill' && <FillSettings behavior={behavior} forms={forms} onChange={next => setNode(node.id, next)} />}
          </fieldset>;
        })}
      </section>))}
    </Column>

    <Column id="details-status" title="設定檢查" scroll>
      <div role="status">
        {issues.length > 0 && <><p><Icon name="warning" />尚有未填完的設定：</p><ul>{issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></>}
        {issues.length === 0 && !reports.length && <p><Icon name="info" />建立生產邏輯與節點後，這裡會顯示每個生產邏輯是否可以轉成專案。</p>}
        {issues.length === 0 && reports.map(report => <div key={report.graphId}>
          <h3>{report.label}</h3>
          {report.ok ? <p><Icon name="check" />可以轉成專案。</p> : <><p><Icon name="warning" />尚不能轉成專案：</p><ul>{report.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></>}
        </div>)}
      </div>
      {orphans.length > 0 && <p role="status"><Icon name="warning" />有 {orphans.length} 個設定對應的節點已不在目前的流程中（{orphans.join('、')}），轉成專案時不會用到。載入了別的流程的設定嗎？</p>}
      <p>設定會放進設定交付包；也可以到「輸出」的「進階」個別下載與載入。重新整理頁面會清空，請先下載。</p>
    </Column>
  </div>;
}

type FillBehavior = Extract<NodeBehavior, { kind: 'fill' }>;

// A fill node names its form and ticks the fields the flow depends on; each tick records the field's type and unit as they are now.
function FillSettings({ behavior, forms, onChange }: { behavior: FillBehavior; forms: FormLibrary; onChange: (next: FillBehavior) => void }) {
  const form = forms.forms.find(f => f.id === behavior.form);
  const toggle = (key: string, on: boolean) => {
    const { [key]: _removed, ...rest } = behavior.requires;
    const field = form?.fields[key];
    const requires: FormRequirement = on && field ? { ...rest, [key]: { type: field.type, ...(field.unit ? { unit: field.unit } : {}), ...(field.type === 'enum' ? { values: [...(field.values ?? [])] } : {}) } } : rest;
    onChange({ ...behavior, requires });
  };
  return <>
    <label>表單<select value={behavior.form} onChange={e => onChange({ ...behavior, form: e.target.value, requires: {} })}>
      <option value="">請選擇</option>{forms.forms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
    {behavior.form && !form && <p>表單庫裡找不到這張表單。</p>}
    {form && <fieldset><legend>流程會用到的欄位</legend>
      <p>勾選流程之後要引用的欄位；沒勾選的欄位修改時不影響流程。</p>
      {Object.entries(form.fields).map(([key, f]) => <label key={key} className="check-row"><input type="checkbox" checked={key in behavior.requires} onChange={e => toggle(key, e.target.checked)} />{f.label?.trim() || key}</label>)}
    </fieldset>}
  </>;
}
