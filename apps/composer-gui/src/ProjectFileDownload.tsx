import { useState } from 'react';
import { convertCanvas } from '../../../libs/aov-integration/canvasToProject';
import { preparePlan } from '../../../libs/aov-integration/publishPrep';
import type { ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import type { FormLibrary } from '../../../libs/aov-integration/formLibrary';
import type { AovGraphDocument } from './workflowGraph';
import { downloadJson } from './fileTransfer';

export function ProjectFileDownload({ graph, details, forms }: { graph: AovGraphDocument; details: ProjectDetails; forms: FormLibrary }) {
  const logics = graph.factories.flatMap(f => f.logicGraphIds.flatMap(id => {
    const g = graph.graphs.find(g => g.id === id);
    return g ? [{ key: `${f.id}/${id}`, factoryId: f.id, graphId: id, name: g.name, label: `${f.name.trim() || '（未命名工廠）'} / ${g.name.trim() || '（未命名生產邏輯）'}` }] : [];
  }));
  const [choice, setChoice] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [version, setVersion] = useState('1');
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const logic = logics.find(l => l.key === choice);
  const issueText = (issue: { message: string; nodeId?: string }) => {
    const node = graph.graphs.flatMap(g => g.nodes).find(n => n.id === issue.nodeId);
    return node ? issue.message.replaceAll(`節點「${issue.nodeId}」`, `節點「${node.name.trim() || '（未命名節點）'}」`) : issue.message;
  };
  const change = (apply: () => void) => { apply(); setErrors([]); setStatus(''); };
  async function download() {
    if (!logic) return;
    setBusy(true); setErrors([]); setStatus('');
    try {
      const input = { doc: graph, factoryId: logic.factoryId, graphId: logic.graphId, details, forms, projectId: projectId.trim(), projectName, version: Number(version) };
      const checked = await preparePlan(input);
      if (!checked.ok) { setErrors(checked.issues.map(issueText)); return; }
      const result = convertCanvas({ ...input, meta: { id: input.projectId, name: projectName.trim(), version: input.version, status: 'published' } });
      if (!result.ok) { setErrors(result.issues.map(issueText)); return; }
      downloadJson(JSON.stringify(result.project, null, 2) + '\n', `${input.projectId}.aov-project.json`);
      setStatus('已下載專案檔');
    } catch { setErrors(['專案檔無法下載，請確認設定後再試。']); }
    finally { setBusy(false); }
  }
  return <section className="project-file-section" aria-label="專案檔">
    <h2>專案檔</h2>
    {!logics.length && <p>請先建立工廠與生產邏輯</p>}
    {logics.length > 0 && <>
      <label>生產邏輯<select value={choice} onChange={e => change(() => { setChoice(e.target.value); setProjectName(logics.find(l => l.key === e.target.value)?.name ?? ''); })}>
        <option value="">請選擇</option>{logics.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
      <label>專案名稱<input maxLength={80} value={projectName} onChange={e => change(() => setProjectName(e.target.value))} /></label>
      <label>專案識別碼（英文字母、數字、底線與連字號）<input maxLength={60} value={projectId} onChange={e => change(() => setProjectId(e.target.value))} /></label>
      <label>版本<input type="number" min={1} step={1} value={version} onChange={e => change(() => setVersion(e.target.value))} /></label>
    </>}
    <button className="primary" disabled={!logic || busy} onClick={download}>下載專案檔</button>
    {errors.length > 0 && <ul role="alert">{errors.map((error, i) => <li key={i}>{error}</li>)}</ul>}
    {status && <p role="status">{status}</p>}
  </section>;
}
