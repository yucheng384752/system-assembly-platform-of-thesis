import { useEffect, useRef, useState } from 'react';
import { actionCatalog } from './workflow';
import { downloadJson } from './fileTransfer';
import { caseStoreClient, type CaseStoreClient, type CaseResult, type FlowCase, type VersionSummary, type FlowVersion, type Lifecycle, type Usage } from './caseStoreClient';

const actionName = (id: string) => actionCatalog.actions.find(a => a.id === id)?.name ?? '未列於工具箱的節點';
const validText = (text: string, max: number) => Boolean(text.trim()) && [...text].length <= max && !text.includes('\0');
type Failure = Extract<CaseResult<never>, { ok: false }>;
const isOffline = (failure: Failure) => failure.errors.some(e => e.code === 'E-CONNECTION' || e.code === 'E-RESPONSE');
const explanations: Record<string, string> = {
  'E-VERSION-CONFLICT': '其他人已先保存版本，請重新載入後再保存。',
  'E-NOT-VERIFIED': '整合包驗證未通過。', 'E-INVALID-INPUT': '填寫內容不符合要求，請檢查必填欄位與字數。',
  'E-BAD-CONTENT': '整合包內容不完整或超過大小限制。', 'E-NOT-FOUND': '找不到所選案例或版本，請重新載入。',
  'E-BUSY': '案例庫忙碌中，請稍後重試。', 'E-CORRUPT': '保存的內容已損壞，請聯絡管理人員。',
  'E-ALIAS-CYCLE': '這兩個節點無法合併，請重新選擇保留方。',
  size: '整合包超過大小限制。', json: '整合包檔案格式無法讀取。', depth: '整合包內容層次過多。',
  secret: '整合包含有機密資訊，請先移除。', data: '整合包不得包含實際資料列。',
  'S0-shape': '整合包結構不完整。', format: '整合包格式不受支援。', version: '整合包版本不受支援。',
  'duplicate-id': '整合包有重複的項目。', 'version-conflict': '所引用的動作版本不一致。',
  dependency: '整合包缺少所引用的內容或對應不一致。', checksum: '整合包內容與保存時的紀錄不符。', manifest: '整合包內容清單不完整。',
  'S0-format': '流程格式不受支援。', 'S1-id': '流程有重複的項目。', 'S2-flow': '連線的起點或終點不存在。',
  'S4-cycle': '流程連線形成循環。', 'S5-type': '節點使用了未定義的資料型別。', 'S5-card': '節點數量設定不合法。',
  'S6-type': '資料型別設定不完整。', 'R1-linearity': '實體輸出不能連到多個下游。', 'R2-terminate': '實體路徑尚未接到終點。',
  'R3-carrier': '載具必須回到載具倉。', 'R4-compat': '相連節點的資料型別不相容。', 'R8-yield': '產出比例必須介於零與一。',
};
function Problems({ failure }: { failure?: Failure }) {
  if (!failure) return null;
  const report = failure.report;
  const diagnostics = typeof report === 'object' && report !== null && 'diagnostics' in report && Array.isArray(report.diagnostics)
    ? report.diagnostics.filter((d: unknown): d is { code: string; message: string } => typeof d === 'object' && d !== null && 'code' in d && typeof d.code === 'string' && 'message' in d && typeof d.message === 'string') : [];
  return <div role="alert"><p>操作未完成；本次變更未保存。</p><ul>{failure.errors.map((e, i) => <li key={i}>{e.code === 'E-DEPRECATED'
    ? e.nodeId ? `${actionName(e.nodeId)}已淘汰或已合併${e.replacement ? `，請改用${actionName(e.replacement)}` : ''}。` : '所選節點或組合已淘汰或已合併，請重新載入現況。'
    : explanations[e.code] ?? '案例庫無法完成要求，請重試或查看進階說明。'}</li>)}</ul>
    {diagnostics.length > 0 && <ol aria-label="驗證原因">{diagnostics.map((d, i) => <li key={i}>{explanations[d.code] ?? '流程規則未通過，請檢查該項驗證說明。'}</li>)}</ol>}
    <details><summary>進階：錯誤與驗證報告</summary><pre>{JSON.stringify({ errors: failure.errors, report }, null, 2)}</pre></details>
  </div>;
}

function CaseVersions({ caseId, client, onOffline }: { caseId: string; client: CaseStoreClient; onOffline: () => void }) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [selected, setSelected] = useState<FlowVersion>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [failure, setFailure] = useState<Failure>();
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File>();
  const [reason, setReason] = useState('');
  const [author, setAuthor] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function failed(result: Failure) { setFailure(result); if (isOffline(result)) onOffline(); }
  useEffect(() => {
    let current = true;
    setLoaded(false); setSelected(undefined); setFailure(undefined); setNotice('');
    void client.listVersions(caseId).then(result => {
      if (!current) return;
      if (result.ok) { setVersions(result.value); setLoaded(true); } else failed(result);
    });
    return () => { current = false; };
  }, [caseId, client, reload]);
  const latest = versions.reduce<number | null>((n, v) => Math.max(n ?? 0, v.version), null);
  const conflict = failure?.errors.some(e => e.code === 'E-VERSION-CONFLICT');
  async function readVersion(n: number) {
    setBusy(true); setFailure(undefined); setSelected(undefined); setNotice('正在讀取版本。');
    const result = await client.getVersion(caseId, n);
    if (!alive.current) return;
    setBusy(false); setNotice('');
    if (result.ok) setSelected(result.value); else failed(result);
  }
  async function save() {
    if (!file || !loaded || conflict || !validText(reason, 2000) || !validText(author, 100) || busy) return;
    setBusy(true); setFailure(undefined); setNotice('正在驗證並保存。');
    try {
      if (file.size > 10000000 || !/\.json$/i.test(file.name)) {
        setNotice(''); setFailure({ ok: false, errors: [{ code: 'E-BAD-CONTENT', message: '請選擇不超過 10 MB 的整合包 JSON 檔。' }] }); return;
      }
      const content = (await file.text()).replace(/^\uFEFF/, '');
      if (!alive.current) return;
      const result = await client.saveVersion(caseId, { expectedParent: latest, content, changeReason: reason, author });
      if (!alive.current) return;
      setNotice('');
      if (result.ok) { setVersions([...versions, result.value]); setSelected(result.value); setNotice(`已保存版本 ${result.value.version}。`); }
      else failed(result);
    } catch { if (alive.current) { setNotice(''); setFailure({ ok: false, errors: [{ code: 'E-BAD-CONTENT', message: '無法讀取選擇的檔案，請重新選擇。' }] }); } }
    finally { if (alive.current) setBusy(false); }
  }
  return <section className="column case-versions" aria-label="案例版本">
    <h2>版本時間軸</h2><p>已保存的版本不能修改，要改請保存新版本。</p>
    {!loaded && !failure && <p role="status">正在載入版本。</p>}
    {loaded && versions.length === 0 && <p role="status">此案例尚無版本。</p>}
    <ol className="case-timeline">{[...versions].sort((a, b) => b.version - a.version).map(v => <li key={v.version}>
      <button disabled={busy} aria-current={selected?.version === v.version ? 'true' : undefined} onClick={() => void readVersion(v.version)}>版本 {v.version}</button>
      {v.version === latest && <span className="badge">目前最新</span>}
      <p><time dateTime={v.created_at}>{v.created_at}</time>　作者：{v.author}</p><p>修改原因：{v.change_reason}</p>
    </li>)}</ol>
    <h2>保存新版本</h2><p>目前畫布上的流程不能直接保存為版本，整合包的產生尚未提供。請選擇既有整合包檔。</p>
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <input className="file-input" id="case-bundle" type="file" accept=".json,application/json" disabled={busy} onChange={e => { setFile(e.target.files?.[0]); setNotice(''); }} />
      <label className="file-button" htmlFor="case-bundle">選擇整合包檔</label><p>{file?.name ?? '尚未選擇檔案'}</p>
      <label>修改原因（必填，1 至 2000 字）<textarea value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      <label>作者（必填，1 至 100 字）<input value={author} disabled={busy} aria-describedby="case-author-note" onChange={e => setAuthor(e.target.value)} /></label>
      <p id="case-author-note">作者自填，無法驗證身分。</p>
      <button className="primary" disabled={busy || !loaded || conflict || !file || !validText(reason, 2000) || !validText(author, 100)}>保存新版本</button>
    </form>
    <p>只檢查整合包與流程規則，未重跑瀏覽器內的互動模擬及正式執行環境。</p>
    {notice && <p role="status">{notice}</p>}<Problems failure={failure} />
    {failure && <button disabled={busy} onClick={() => setReload(n => n + 1)}>重新載入</button>}
    <button disabled={!selected || busy || Boolean(conflict)} onClick={() => {
      if (!selected) return;
      try { downloadJson(selected.content, `case-version-${selected.version}.json`); setNotice(`已下載版本 ${selected.version}。`); }
      catch { setNotice(''); setFailure({ ok: false, errors: [{ code: 'E-DOWNLOAD', message: '下載失敗，請重試。' }] }); }
    }}>下載此版本</button>
    {selected && <details><summary>進階：版本內容與驗證報告</summary><dl><dt>版本識別</dt><dd>{selected.case_id} / {selected.version}</dd><dt>內容雜湊</dt><dd>{selected.content_hash}</dd></dl><pre>{selected.verified_report}</pre><pre>{selected.content}</pre></details>}
  </section>;
}

type ManagementTarget = { nodeId: string; combo?: never } | { combo: string[]; nodeId?: never };
type Pending = { target: ManagementTarget; operation: 'deprecate' | 'reactivate'; usage?: Usage[] };
function LifecycleManagement({ client, lifecycle, cases, onRefresh, onOffline }: {
  client: CaseStoreClient; lifecycle: Lifecycle; cases: FlowCase[]; onRefresh: () => Promise<void>; onOffline: () => void;
}) {
  const [pending, setPending] = useState<Pending>();
  const [reason, setReason] = useState('');
  const [keep, setKeep] = useState('');
  const [drop, setDrop] = useState('');
  const [mergeReason, setMergeReason] = useState('');
  const [sequence, setSequence] = useState<string[]>([]);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  const [notice, setNotice] = useState('');
  const state = (id: string) => lifecycle.nodes.find(n => n.node_id === id)?.state ?? 'active';
  function failed(result: Failure) { setFailure(result); if (isOffline(result)) onOffline(); }
  async function begin(target: ManagementTarget, operation: Pending['operation']) {
    setReason(''); setFailure(undefined); setNotice(''); setPending({ target, operation });
    if (operation !== 'deprecate') return;
    setBusy(true);
    const result = await client.usage(target);
    setBusy(false);
    if (result.ok) setPending({ target, operation, usage: result.value }); else { setPending(undefined); failed(result); }
  }
  async function finish(work: () => Promise<CaseResult<null>>) {
    if (busy) return;
    setBusy(true); setFailure(undefined); setNotice('');
    const result = await work();
    if (result.ok) { setPending(undefined); setReason(''); setKeep(''); setDrop(''); setMergeReason(''); await onRefresh(); setNotice('已更新現況。'); }
    else failed(result);
    setBusy(false);
  }
  const pendingName = pending && (pending.target.nodeId !== undefined ? actionName(pending.target.nodeId) : pending.target.combo.map(actionName).join(' → '));
  const referencedCases = new Set(pending?.usage?.map(u => u.case_id));
  const referencedVersions = new Set(pending?.usage?.map(u => JSON.stringify([u.case_id, u.version])));
  const retiredCombos = lifecycle.combos.filter(c => c.state === 'deprecated');
  return <section className="column case-management" aria-label="工具節點與組合管理">
    <h2>工具節點管理</h2>
    <ul className="case-tools">{actionCatalog.actions.map(action => {
      const current = lifecycle.nodes.find(n => n.node_id === action.id);
      return <li key={action.id}><h3>{action.name}</h3><p className="badge">{current?.state === 'merged' ? `已合併為${actionName(current.replaced_by ?? '')}` : current?.state === 'deprecated' ? '已淘汰' : '使用中'}</p>
        {current && <p>原因：{current.reason}</p>}
        {current?.state !== 'merged' && <button disabled={busy} className={current?.state === 'deprecated' ? undefined : 'danger'} onClick={() => void begin({ nodeId: action.id }, current?.state === 'deprecated' ? 'reactivate' : 'deprecate')}>{current?.state === 'deprecated' ? '重新啟用' : '淘汰'}<span className="visually-hidden">：{action.name}</span></button>}
      </li>;
    })}</ul>
    <h3>合併節點</h3><form onSubmit={e => { e.preventDefault(); if (keep && drop && keep !== drop && state(keep) === 'active' && state(drop) !== 'merged' && validText(mergeReason, 2000)) void finish(() => client.merge(keep, drop, mergeReason)); }}>
      <label>保留的節點<select value={keep} disabled={busy} onChange={e => setKeep(e.target.value)}><option value="">請選擇</option>{actionCatalog.actions.filter(a => state(a.id) === 'active').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>併入的節點<select value={drop} disabled={busy} onChange={e => setDrop(e.target.value)}><option value="">請選擇</option>{actionCatalog.actions.filter(a => state(a.id) !== 'merged' && a.id !== keep).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>兩者差異與合併原因<textarea value={mergeReason} disabled={busy} onChange={e => setMergeReason(e.target.value)} /></label><p>請填 1 至 2000 字。合併後只能使用保留方，既有版本不變。</p>
      <button disabled={busy || !keep || !drop || keep === drop || state(keep) !== 'active' || state(drop) === 'merged' || !validText(mergeReason, 2000)}>合併節點</button>
    </form>
    <h2>組合管理</h2><p>依序加入至少兩個節點，只比對直接相連的節點。</p>
    <label>下一個節點<select value={next} disabled={busy} onChange={e => setNext(e.target.value)}><option value="">請選擇</option>{actionCatalog.actions.filter(a => state(a.id) !== 'merged').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    <div className="actions"><button disabled={busy || !next} onClick={() => { setSequence([...sequence, next]); setPending(undefined); }}>加入組合末端</button><button disabled={busy || sequence.length === 0} onClick={() => { setSequence([]); setPending(undefined); }}>清空組合</button></div>
    <ol aria-label="組合順序">{sequence.map((id, i) => <li key={i}>{actionName(id)}</li>)}</ol>
    <button className="danger" disabled={busy || sequence.length < 2} onClick={() => void begin({ combo: sequence }, 'deprecate')}>淘汰此組合</button>
    <h3>已淘汰的組合</h3>{retiredCombos.length === 0 && <p role="status">尚無已淘汰的組合。</p>}
    <ul>{retiredCombos.map(c => <li key={JSON.stringify(c.combo)}><p>{c.combo.map(actionName).join(' → ')}（已淘汰）</p><p>原因：{c.reason}</p><button disabled={busy} onClick={() => void begin({ combo: c.combo }, 'reactivate')}>重新啟用組合<span className="visually-hidden">：{c.combo.map(actionName).join(' → ')}</span></button></li>)}</ul>
    {pending && <section className="note case-confirm" aria-label="確認現況變更"><h3>{pending.operation === 'deprecate' ? '淘汰' : '重新啟用'}：{pendingName}</h3>
      {pending.operation === 'deprecate' && (pending.usage ? <><p role="status">仍有 {referencedCases.size} 個案例、{referencedVersions.size} 個版本引用。</p><ul>{[...referencedCases].map(id => <li key={id}>{cases.find(c => c.case_id === id)?.name ?? '未列於清單的案例'}：版本 {[...new Set(pending.usage?.filter(u => u.case_id === id).map(u => u.version))].join('、')}</li>)}</ul></> : <p role="status">正在查詢引用。</p>)}
      <label>變更原因（必填，1 至 2000 字）<textarea value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>
      <div className="actions"><button className={pending.operation === 'deprecate' ? 'danger' : undefined} disabled={busy || !validText(reason, 2000) || (pending.operation === 'deprecate' && !pending.usage)} onClick={() => {
        if (!validText(reason, 2000) || (pending.operation === 'deprecate' && !pending.usage)) return;
        void finish(() => pending.target.nodeId !== undefined ? client.setNode(pending.target.nodeId, pending.operation, reason) : client.setCombo(pending.target.combo, pending.operation, reason));
      }}>確認{pending.operation === 'deprecate' ? '淘汰' : '重新啟用'}</button><button disabled={busy} onClick={() => setPending(undefined)}>取消</button></div>
    </section>}
    {busy && <p role="status">正在處理現況。</p>}{notice && <p role="status">{notice}</p>}<Problems failure={failure} />
  </section>;
}

export function CaseLibraryPage({ client = caseStoreClient, onLifecycle }: { client?: CaseStoreClient; onLifecycle?: (value: Lifecycle | undefined) => void }) {
  const [cases, setCases] = useState<FlowCase[]>([]);
  const [lifecycle, setLifecycle] = useState<Lifecycle>();
  const [status, setStatus] = useState<'loading' | 'offline' | 'ready'>('loading');
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>();
  function offline() { setStatus('offline'); onLifecycle?.(undefined); }
  useEffect(() => {
    let current = true;
    setStatus('loading'); setFailure(undefined);
    void Promise.all([client.listCases(), client.lifecycle()]).then(([list, life]) => {
      if (!current) return;
      if (!list.ok || !life.ok) { setFailure(!list.ok ? list : !life.ok ? life : undefined); offline(); return; }
      setCases(list.value); setLifecycle(life.value); onLifecycle?.(life.value);
      setSelected(previous => list.value.some(c => c.case_id === previous) ? previous : list.value[0]?.case_id ?? ''); setStatus('ready');
    });
    return () => { current = false; };
  }, [client, reload, onLifecycle]);
  async function refreshLifecycle() {
    const result = await client.lifecycle();
    if (result.ok) { setLifecycle(result.value); onLifecycle?.(result.value); }
    else { setFailure(result); offline(); }
  }
  async function create() {
    if (busy || !validText(name, 300)) return;
    setBusy(true); setFailure(undefined);
    const result = await client.createCase(name);
    setBusy(false);
    if (result.ok) { setCases([...cases, result.value]); setSelected(result.value.case_id); setName(''); }
    else { setFailure(result); if (isOffline(result)) offline(); }
  }
  return <main id="main-content" tabIndex={-1} className="case-library"><div className="page-head"><h1>案例庫</h1></div><p className="lead">保存流程的歷次版本與修改原因，管理工具節點及組合。</p>
    {status === 'loading' ? <p role="status">正在載入案例庫。</p> : status === 'offline' ? <section className="column" role="alert"><p>案例庫服務尚未啟動，目前只能瀏覽既有流程，無法保存版本。</p><p>請聯絡管理人員啟動案例庫後重試。</p><details><summary>進階：啟動方式</summary><p>在專案根目錄執行：</p><pre>npm.cmd run case-store</pre>{failure && <pre>{JSON.stringify(failure.errors, null, 2)}</pre>}</details><button onClick={() => setReload(n => n + 1)}>重新連線</button></section> : <>
      <div className="case-columns"><section className="column" aria-label="案例清單"><h2>建立案例</h2><form onSubmit={e => { e.preventDefault(); void create(); }}><label>案例名稱<input value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label><button disabled={busy || !validText(name, 300)}>建立案例</button></form>
        {busy && <p role="status">正在建立案例。</p>}<Problems failure={failure} />
        <h2>案例清單</h2>{cases.length === 0 && <p role="status">尚無案例，請先建立案例。</p>}
        <ul className="case-list">{cases.map(c => <li key={c.case_id}><button aria-current={selected === c.case_id ? 'true' : undefined} onClick={() => setSelected(c.case_id)}>{c.name}</button></li>)}</ul>
      </section>{selected ? <CaseVersions key={selected} caseId={selected} client={client} onOffline={offline} /> : <section className="column"><p role="status">建立案例後即可保存版本。</p></section>}</div>
      {lifecycle && <LifecycleManagement client={client} lifecycle={lifecycle} cases={cases} onRefresh={refreshLifecycle} onOffline={offline} />}
    </>}
  </main>;
}
