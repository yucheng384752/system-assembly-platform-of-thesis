import { actionCatalog } from './workflow';
import { nodeErrors, type AovGraphDocument, type GraphNode } from './workflowGraph';
import { patchCanvasNode } from './canvasEditing';
import { NodeForm } from './NodeForm';
import { NodeRelations } from './NodeRelations';

export function NodeDetails({ value, node, onChange }: { value: AovGraphDocument; node: GraphNode; onChange: (next: AovGraphDocument) => boolean }) {
  const action = actionCatalog.actions.find(a => a.id === node.actionId);
  const patch = (next: Partial<GraphNode>) => onChange(patchCanvasNode(value, node.id, next));
  const problems = nodeErrors(value, node);
  return <>
    {(['name', 'when', 'owner'] as const).map((key, i) => <div key={key}>
      <label htmlFor={`node-${key}`}>{['名稱', '時機', '負責職務'][i]}</label>
      <input id={`node-${key}`} maxLength={key === 'when' ? 300 : 100} required={key === 'name'} value={node[key]} onChange={e => patch({ [key]: e.target.value })} />
    </div>)}
    <label htmlFor="node-action">動作</label><select id="node-action" value={node.actionId ?? ''} onChange={e => {
      const selected = actionCatalog.actions.find(a => a.id === e.target.value);
      patch({ actionId: selected?.id ?? null, params: Object.fromEntries(selected?.parameters.filter(p => p.default !== undefined).map(p => [p.id, p.default!]) ?? []) });
    }}><option value="">無（純業務節點）：只描述工作內容</option>{actionCatalog.actions.map(a => <option key={a.id} value={a.id}>{a.name}：{a.description}</option>)}</select>
    {action?.parameters.map(p => {
      const current = node.params[p.id] ?? p.default;
      return <div key={p.id}><label htmlFor={`param-${p.id}`}>{p.name}{p.required ? '（必填）' : ''}
        {p.type === 'boolean' && <input id={`param-${p.id}`} type="checkbox" role="switch" checked={current === true} onChange={e => patch({ params: { ...node.params, [p.id]: e.target.checked } })} />}
      </label>{p.type !== 'boolean' && <input id={`param-${p.id}`} type={p.type === 'number' ? 'number' : 'text'} step="any" maxLength={100} min={p.minimum} max={p.maximum} required={p.required} value={typeof current === 'boolean' ? '' : current ?? ''} onChange={e => {
        const params = { ...node.params };
        if (p.type === 'text') params[p.id] = e.target.value;
        else if (e.target.value === '') delete params[p.id];
        else if (Number.isFinite(e.target.valueAsNumber)) params[p.id] = e.target.valueAsNumber;
        patch({ params });
      }} />}</div>;
    })}
    <div role="status">{problems.length ? <><h3>尚未完成</h3><ul>{problems.map(p => <li key={p}>{p}</li>)}</ul></> : <p>節點基本設定已完成。</p>}</div>
    <NodeForm key={node.id} value={value} node={node} onChange={onChange} />
    {node.formId && <NodeRelations key={node.formId} value={value} formId={node.formId} onChange={onChange} />}
  </>;
}
