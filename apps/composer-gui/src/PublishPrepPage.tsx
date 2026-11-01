import { useState } from 'react';
import { preparePlan, type PrepResult } from '../../../libs/aov-integration/publishPrep';
import type { ProjectDetails } from '../../../libs/aov-integration/projectDetails';
import { Column } from './Column';
import { downloadJson } from './fileTransfer';
import { Icon } from './Icons';
import type { AovGraphDocument } from './workflowGraph';

interface Logic { key: string; factoryId: string; graphId: string; label: string; name: string }
const logicsOf = (graph: AovGraphDocument): Logic[] => graph.factories.flatMap(factory => factory.logicGraphIds.flatMap(graphId => {
  const logic = graph.graphs.find(g => g.id === graphId);
  const name = logic?.name.trim() ?? '';
  return logic ? [{ key: `${factory.id}/${graphId}`, factoryId: factory.id, graphId, name, label: `${factory.name.trim() || '（未命名工廠）'} / ${name || '（未命名生產邏輯）'}` }] : [];
}));

export function PublishPrepPage({ graph, details }: { graph: AovGraphDocument; details: ProjectDetails }) {
  const logics = logicsOf(graph);
  const [choice, setChoice] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [version, setVersion] = useState('1');
  const [result, setResult] = useState<PrepResult>();
  const [busy, setBusy] = useState(false);
  const logic = logics.find(l => l.key === choice);
  const change = (apply: () => void) => { apply(); setResult(undefined); }; // a result describes the inputs it was made from

  async function generate() {
    if (!logic) return;
    setBusy(true);
    try {
      setResult(await preparePlan({ doc: graph, factoryId: logic.factoryId, graphId: logic.graphId, details, projectId: projectId.trim(), projectName, version: Number(version) }));
    } finally { setBusy(false); }
  }

  return <main id="publish-main" tabIndex={-1}>
    <div className="page-head"><h1>發布準備</h1></div>
    <p className="lead">把一個生產邏輯整理成計畫檔與表單檔包，交給工廠端使用。</p>
    <div className="step-content"><div className="columns production-columns">
    <Column id="publish-source" title="要發布的生產邏輯" scroll lead="選一個生產邏輯，產生給工廠使用的計畫檔。檔案由工程師帶到工廠端上傳，這裡不會連線到工廠。">
      {!logics.length && <p>請先在「流程畫布」建立工廠與生產邏輯。</p>}
      {logics.length > 0 && <>
        <label>生產邏輯<select value={choice} onChange={e => change(() => { setChoice(e.target.value); const next = logics.find(l => l.key === e.target.value); setProjectName(next?.name ?? ''); })}>
          <option value="">請選擇</option>{logics.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
        <label>專案名稱<input maxLength={80} value={projectName} onChange={e => change(() => setProjectName(e.target.value))} /></label>
        <label>專案識別碼（英文字母、數字、底線與連字號）<input maxLength={60} value={projectId} onChange={e => change(() => setProjectId(e.target.value))} /></label>
        <label>版本<input type="number" min={1} step={1} value={version} onChange={e => change(() => setVersion(e.target.value))} /></label>
        <button className="primary" disabled={!logic || busy} onClick={generate}>產生計畫</button>
      </>}
    </Column>

    <Column id="publish-result" title="產生結果" scroll>
      <div role="status">
        {!result && <p><Icon name="info" />選好生產邏輯並按「產生計畫」後，這裡會顯示結果。</p>}
        {result && !result.ok && <><p><Icon name="warning" />無法產生計畫：</p><ul>{result.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></>}
        {result?.ok && <>
          <p><Icon name="check" />計畫已產生：共 {result.summary.nodes} 個節點，{result.summary.forms} 張表單。</p>
          {result.summary.notExecutable.length > 0 && <>
            <p><Icon name="warning" />有 {result.summary.notExecutable.length} 個節點目前不可執行，工廠端無法據此開工：</p>
            <ul>{result.summary.notExecutable.map(n => <li key={n.nodeId}>{n.name}：{n.reason}</li>)}</ul>
          </>}
        </>}
      </div>
      {result?.ok && <div className="actions">
        <button className="primary" onClick={() => downloadJson(result.plan.text, result.plan.name)}><Icon name="download" />下載計畫檔</button>
        {result.forms && <button onClick={() => downloadJson(result.forms!.text, result.forms!.name)}><Icon name="download" />下載表單檔包</button>}
        <details><summary>進階</summary><p>計畫識別碼：{result.planId}</p><p>檔名：{result.plan.name}</p></details>
      </div>}
    </Column>

    <Column id="publish-notes" title="說明" scroll>
      <p>計畫檔產生後內容不會再改變；同一份流程與設定每次產生的結果相同。要修改請回到前面的步驟，再重新產生並提高版本。</p>
      <p>領料、入庫與出庫目前沒有對應的系統功能，產生的計畫會把這些節點標為不可執行。</p>
      <p>設定保留在本次工作階段，尚未納入設定交付包。</p>
    </Column>
    </div></div>
  </main>;
}
