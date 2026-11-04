// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CaseLibraryPage } from './CaseLibraryPage';
import { createCaseStoreClient, type CaseStoreClient, type CaseResult, type FlowVersion, type VersionSummary, type Lifecycle, type Usage } from './caseStoreClient';
import { WorkflowCanvas } from './WorkflowCanvas';
import { App } from './App';
import { actionCatalog } from './workflow';
import { emptyGraph, type AovGraphDocument } from './workflowGraph';
import { addCanvasNode, addFactory, addLogic } from './canvasEditing';
import { openToolGroups, startLogic } from './testNav';
import * as transfers from './fileTransfer';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const ok = <T,>(value: T): CaseResult<T> => ({ ok: true, value });
const fail = (code: string): CaseResult<never> => ({ ok: false, errors: [{ code, message: '原始說明' }] });
const caseA = { case_id: 'a', name: '案例甲', created_at: '2026-11-04' };
const caseB = { case_id: 'b', name: '案例乙', created_at: '2026-11-04' };
const version = (n: number, caseId = 'a'): FlowVersion => ({ case_id: caseId, version: n, parent_version: n === 1 ? null : n - 1, change_reason: `修改 ${n}`, author: `作者 ${n}`, created_at: `2026-11-0${n}`, content: `{"saved":${n}}`, content_hash: `hash-${n}`, verified_report: '{"passed":true}' });
const initialLife: Lifecycle = { nodes: [], combos: [] };
function clientMock() {
  return {
    listCases: vi.fn<CaseStoreClient['listCases']>().mockResolvedValue(ok([caseA])),
    createCase: vi.fn<CaseStoreClient['createCase']>().mockResolvedValue(ok(caseB)),
    listVersions: vi.fn<CaseStoreClient['listVersions']>().mockResolvedValue(ok([version(1), version(2)])),
    getVersion: vi.fn<CaseStoreClient['getVersion']>().mockImplementation(async (id, n) => ok(version(n, id))),
    saveVersion: vi.fn<CaseStoreClient['saveVersion']>().mockResolvedValue(ok(version(3))),
    lifecycle: vi.fn<CaseStoreClient['lifecycle']>().mockResolvedValue(ok(initialLife)),
    setNode: vi.fn<CaseStoreClient['setNode']>().mockResolvedValue(ok(null)),
    merge: vi.fn<CaseStoreClient['merge']>().mockResolvedValue(ok(null)),
    setCombo: vi.fn<CaseStoreClient['setCombo']>().mockResolvedValue(ok(null)),
    usage: vi.fn<CaseStoreClient['usage']>().mockResolvedValue(ok([])),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const button = (name: string | RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const click = (name: string | RegExp) => fireEvent.click(button(name));
const change = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function ready(client = clientMock()) {
  const view = render(<CaseLibraryPage client={client} />);
  await screen.findByRole('button', { name: '版本 2' });
  return { client, ...view };
}
function upload(text = '{"bundle":"test"}', name = 'bundle.json') {
  const file = new File([text], name);
  Object.defineProperty(file, 'text', { value: async () => text });
  fireEvent.change(screen.getByLabelText('選擇整合包檔'), { target: { files: [file] } });
  return file;
}
function fillSave() { upload(); change(/修改原因（必填/, '更新檢驗流程'); change(/作者（必填/, '測試者'); }
const nodeLife = (state: 'deprecated' | 'merged', id = 'define-form'): Lifecycle => ({ nodes: [{ node_id: id, state, reason: '改用新版', replaced_by: state === 'merged' ? 'import-records' : null, at: '2026-11-04' }], combos: [] });

test.each(['network', 'html', 'object'] as const)('offline %s shows startup guidance instead of an empty library and can reconnect', async mode => {
  let online = false;
  const client = createCaseStoreClient(async url => {
    if (online) return new Response(JSON.stringify(url.endsWith('/lifecycle') ? initialLife : []));
    if (mode === 'network') throw new Error('offline');
    return new Response(mode === 'html' ? '<html>fallback</html>' : '{}');
  });
  const onLifecycle = vi.fn();
  render(<CaseLibraryPage client={client} onLifecycle={onLifecycle} />);
  expect(screen.getByRole('status').textContent).toContain('正在載入');
  expect((await screen.findByRole('alert')).textContent).toContain('案例庫服務尚未啟動');
  expect(screen.queryByText('尚無案例，請先建立案例。')).toBeNull();
  expect(screen.queryByRole('button', { name: '建立案例' })).toBeNull();
  expect(screen.getByText('npm.cmd run case-store').closest('details')?.open).toBe(false);
  expect(onLifecycle).toHaveBeenLastCalledWith(undefined);
  online = true; click('重新連線');
  await screen.findByText('尚無案例，請先建立案例。');
  expect(onLifecycle).toHaveBeenLastCalledWith(initialLife);
});

test('create requires a nonblank name, submits on the form, selects the new case and renders user text literally', async () => {
  const client = clientMock();
  const name = '<img src=x onerror=alert(1)>';
  client.listCases.mockResolvedValue(ok([])); client.createCase.mockResolvedValue(ok({ ...caseB, name })); client.listVersions.mockResolvedValue(ok([]));
  const { container } = render(<CaseLibraryPage client={client} />);
  await screen.findByText('尚無案例，請先建立案例。');
  expect(button('建立案例').disabled).toBe(true);
  change('案例名稱', '  '); expect(button('建立案例').disabled).toBe(true);
  change('案例名稱', name); expect(button('建立案例').disabled).toBe(false);
  fireEvent.submit(screen.getByLabelText('案例名稱').closest('form')!);
  const selected = await screen.findByRole('button', { name });
  expect(selected.getAttribute('aria-current')).toBe('true');
  expect(client.createCase).toHaveBeenCalledWith(name);
  expect(client.listVersions).toHaveBeenCalledWith('b');
  expect(await screen.findByText('此案例尚無版本。')).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
});

test('timeline is newest first, shows attribution, selects and downloads exact saved content without edit/delete controls', async () => {
  const { client, container } = await ready();
  const download = vi.spyOn(transfers, 'downloadJson').mockImplementation(() => {});
  const panel = screen.getByRole('region', { name: '案例版本' });
  const versions = within(panel).getAllByRole('button', { name: /^版本 / });
  expect(versions.map(b => b.textContent)).toEqual(['版本 2', '版本 1']);
  const newest = versions[0].closest('li')!;
  expect(newest.textContent).toContain('目前最新'); expect(newest.textContent).toContain('作者 2'); expect(newest.textContent).toContain('修改 2'); expect(newest.textContent).toContain('2026-11-02');
  expect(versions[1].closest('li')!.textContent).not.toContain('目前最新');
  expect(button('下載此版本').disabled).toBe(true);
  click('版本 1'); await waitFor(() => expect(button('下載此版本').disabled).toBe(false));
  expect(client.getVersion).toHaveBeenCalledWith('a', 1);
  expect(button('版本 1').getAttribute('aria-current')).toBe('true');
  click('下載此版本'); expect(download).toHaveBeenCalledWith(version(1).content, 'case-version-1.json');
  expect(screen.getByText('已下載版本 1。').getAttribute('role')).toBe('status');
  expect(screen.getByText('hash-1').closest('details')?.open).toBe(false);
  expect(within(panel).queryAllByRole('button', { name: /編輯|刪除/ })).toHaveLength(0);
  expect(container.querySelectorAll('input[value="修改 1"],textarea[value="修改 1"]')).toHaveLength(0);
  expect(screen.getByText('已保存的版本不能修改，要改請保存新版本。')).toBeTruthy();
  expect(screen.getByText(/目前畫布上的流程不能直接保存為版本/)).toBeTruthy();
  expect(screen.getByText(/無法驗證身分/)).toBeTruthy();
  expect(screen.getByText(/未重跑瀏覽器內的互動模擬/)).toBeTruthy();
});

test('save requires a file, nonblank bounded reason and author; sends the last read parent and displays the new version', async () => {
  const { client } = await ready();
  expect(button('保存新版本').disabled).toBe(true);
  change(/修改原因（必填/, '更新'); change(/作者（必填/, '作者');
  expect(button('保存新版本').disabled).toBe(true);
  upload();
  for (const [label, invalid, valid] of [[/修改原因（必填/, ' ', '原因'], [/修改原因（必填/, '字'.repeat(2001), '字'.repeat(2000)], [/作者（必填/, ' ', '作者'], [/作者（必填/, '字'.repeat(101), '字'.repeat(100)]] as const) {
    change(label, invalid); expect(button('保存新版本').disabled).toBe(true);
    fireEvent.submit(button('保存新版本').closest('form')!); expect(client.saveVersion).not.toHaveBeenCalled();
    change(label, valid); expect(button('保存新版本').disabled).toBe(false);
  }
  change(/修改原因（必填/, '更新檢驗流程'); change(/作者（必填/, '測試者'); click('保存新版本');
  await screen.findByText('已保存版本 3。');
  expect(client.saveVersion).toHaveBeenCalledWith('a', { expectedParent: 2, content: '{"bundle":"test"}', changeReason: '更新檢驗流程', author: '測試者' });
  expect(button('版本 3').getAttribute('aria-current')).toBe('true');
  expect(button('版本 3').closest('li')!.textContent).toContain('目前最新');
});

test('the first version uses a null parent and a pending save cannot be submitted twice', async () => {
  const client = clientMock(); client.listVersions.mockResolvedValue(ok([]));
  const saved = deferred<CaseResult<FlowVersion>>(); client.saveVersion.mockReturnValue(saved.promise);
  render(<CaseLibraryPage client={client} />); await screen.findByText('此案例尚無版本。');
  fillSave(); click('保存新版本');
  await waitFor(() => expect(client.saveVersion).toHaveBeenCalledTimes(1));
  expect(button('保存新版本').disabled).toBe(true); click('保存新版本');
  expect(client.saveVersion.mock.calls[0][1].expectedParent).toBeNull(); expect(client.saveVersion).toHaveBeenCalledTimes(1);
  await act(async () => saved.resolve(ok(version(1))));
  expect(screen.getByText('已保存版本 1。')).toBeTruthy();
});

test.each(['extension', 'size', 'read'] as const)('invalid file %s never reaches save', async kind => {
  const { client } = await ready(); fillSave();
  const file = upload('{}', kind === 'extension' ? 'bundle.txt' : 'bundle.json');
  if (kind === 'size') Object.defineProperty(file, 'size', { value: 10000001 });
  if (kind === 'read') { const broken = new File(['{}'], 'broken.json'); Object.defineProperty(broken, 'text', { value: async () => { throw new Error('read'); } }); fireEvent.change(screen.getByLabelText('選擇整合包檔'), { target: { files: [broken] } }); }
  click('保存新版本');
  expect((await screen.findByRole('alert')).textContent).toContain('未保存');
  expect(client.saveVersion).not.toHaveBeenCalled(); expect(screen.queryByText(/已保存版本/)).toBeNull();
});

test('failed validation lists each reason, keeps raw details folded and clears a previous success', async () => {
  const { client } = await ready(); fillSave(); click('保存新版本'); await screen.findByText('已保存版本 3。');
  client.saveVersion.mockResolvedValue({ ok: false, errors: [{ code: 'E-NOT-VERIFIED', message: '未保存' }], report: { diagnostics: [{ code: 'secret', message: '/secret_ref: private' }, { code: 'data', message: '/rows: private' }] } });
  click('保存新版本');
  await screen.findByText('整合包驗證未通過。');
  expect(within(screen.getByRole('list', { name: '驗證原因' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(['整合包含有機密資訊，請先移除。', '整合包不得包含實際資料列。']);
  expect(screen.getByRole('alert').textContent).toContain('未保存'); expect(screen.queryByText('已保存版本 3。')).toBeNull();
  expect(screen.getByText(/"\/secret_ref: private"/).closest('details')?.open).toBe(false);
});

test('a stale parent blocks resubmission until reload reads the new latest version', async () => {
  const { client } = await ready(); fillSave(); client.saveVersion.mockResolvedValueOnce(fail('E-VERSION-CONFLICT'));
  click('保存新版本'); await screen.findByText('其他人已先保存版本，請重新載入後再保存。');
  expect(button('保存新版本').disabled).toBe(true); expect(screen.queryByText(/已保存版本/)).toBeNull();
  client.listVersions.mockResolvedValue(ok([version(1), version(2), version(4)]));
  click('重新載入'); await screen.findByRole('button', { name: '版本 4' });
  expect(button('保存新版本').disabled).toBe(false); click('保存新版本');
  await waitFor(() => expect(client.saveVersion).toHaveBeenCalledTimes(2));
  expect(client.saveVersion.mock.calls[1][1].expectedParent).toBe(4);
});

test('case switch ignores stale list failures instead of replacing the new case with an offline screen', async () => {
  const client = clientMock(); client.listCases.mockResolvedValue(ok([caseA, caseB]));
  const old = deferred<CaseResult<VersionSummary[]>>();
  client.listVersions.mockImplementation(id => id === 'a' ? old.promise : Promise.resolve(ok([version(5, 'b')])));
  render(<CaseLibraryPage client={client} />); await screen.findByRole('button', { name: caseB.name }); click(caseB.name);
  await screen.findByRole('button', { name: '版本 5' });
  await act(async () => old.resolve(fail('E-CONNECTION')));
  expect(button(caseB.name).getAttribute('aria-current')).toBe('true'); expect(button('版本 5')).toBeTruthy(); expect(screen.queryByRole('alert')).toBeNull();
});

test.each(['success', 'offline'] as const)('case switch ignores stale version detail %s', async outcome => {
  const client = clientMock(); client.listCases.mockResolvedValue(ok([caseA, caseB]));
  const old = deferred<CaseResult<FlowVersion>>(); client.getVersion.mockImplementation((id, n) => id === 'a' ? old.promise : Promise.resolve(ok(version(n, id))));
  await ready(client); click('版本 1'); click(caseB.name); await screen.findByRole('button', { name: '版本 2' }); click('版本 2');
  await waitFor(() => expect(button('下載此版本').disabled).toBe(false));
  await act(async () => old.resolve(outcome === 'success' ? ok(version(1)) : fail('E-CONNECTION')));
  expect(button('版本 2').getAttribute('aria-current')).toBe('true'); expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('b / 2')).toBeTruthy(); expect(screen.queryByText('a / 1')).toBeNull();
});

test('late file reading after a case switch never saves to the previous case', async () => {
  const client = clientMock(); client.listCases.mockResolvedValue(ok([caseA, caseB])); await ready(client);
  fillSave(); const read = deferred<string>(); const file = new File(['{}'], 'slow.json'); Object.defineProperty(file, 'text', { value: () => read.promise });
  fireEvent.change(screen.getByLabelText('選擇整合包檔'), { target: { files: [file] } }); click('保存新版本'); click(caseB.name);
  await screen.findByRole('button', { name: '版本 2' }); await act(async () => read.resolve('{}'));
  expect(client.saveVersion).not.toHaveBeenCalled(); expect(button(caseB.name).getAttribute('aria-current')).toBe('true');
});

test('deprecation waits for usage, counts distinct cases/versions, requires a reason, and refreshes lifecycle', async () => {
  const { client } = await ready(); const usage = deferred<CaseResult<Usage[]>>(); client.usage.mockReturnValue(usage.promise);
  click('淘汰：建立表單'); expect(button('確認淘汰').disabled).toBe(true); expect(screen.getByText('正在查詢引用。')).toBeTruthy();
  expect(client.setNode).not.toHaveBeenCalled();
  await act(async () => usage.resolve(ok([{ case_id: 'a', version: 1, graph: 'g1' }, { case_id: 'a', version: 1, graph: 'g2' }, { case_id: 'a', version: 2, graph: 'g' }])));
  expect(screen.getByText('仍有 1 個案例、2 個版本引用。')).toBeTruthy(); expect(screen.getByText('案例甲：版本 1、2')).toBeTruthy();
  expect(client.usage).toHaveBeenCalledWith({ nodeId: 'define-form' });
  change(/變更原因（必填/, '  '); expect(button('確認淘汰').disabled).toBe(true);
  change(/變更原因（必填/, '字'.repeat(2001)); expect(button('確認淘汰').disabled).toBe(true);
  change(/變更原因（必填/, '<b>改版</b>'); expect(button('確認淘汰').disabled).toBe(false);
  client.lifecycle.mockResolvedValue(ok(nodeLife('deprecated'))); click('確認淘汰');
  await screen.findByRole('button', { name: '重新啟用：建立表單' }); expect(client.setNode).toHaveBeenCalledWith('define-form', 'deprecate', '<b>改版</b>');
  expect(client.lifecycle).toHaveBeenCalledTimes(2); expect(screen.getByText('已更新現況。')).toBeTruthy();
});

test('failed usage cannot be treated as zero references and cancel sends no mutation', async () => {
  const { client } = await ready(); client.usage.mockResolvedValueOnce(fail('E-CORRUPT'));
  click('淘汰：建立表單'); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: '確認淘汰' })).toBeNull(); expect(screen.queryByText(/仍有 0 個案例/)).toBeNull(); expect(client.setNode).not.toHaveBeenCalled();
  click('淘汰：建立表單'); await screen.findByText('仍有 0 個案例、0 個版本引用。'); click('取消');
  expect(screen.queryByRole('region', { name: '確認現況變更' })).toBeNull(); expect(client.setNode).not.toHaveBeenCalled();
});

test('reactivation requires a reason and merged nodes have no operations or merge choices', async () => {
  const client = clientMock(); client.lifecycle.mockResolvedValue(ok({ nodes: [...nodeLife('deprecated').nodes, ...nodeLife('merged', 'trace-records').nodes], combos: [] }));
  await ready(client);
  const merged = screen.getByRole('heading', { name: '查詢追溯' }).closest('li')!;
  expect(merged.textContent).toContain('已合併為匯入資料列'); expect(within(merged).queryAllByRole('button')).toHaveLength(0);
  for (const label of ['保留的節點', '併入的節點']) expect(within(screen.getByLabelText(label)).queryByRole('option', { name: '查詢追溯' })).toBeNull();
  click('重新啟用：建立表單'); expect(button('確認重新啟用').disabled).toBe(true); change(/變更原因（必填/, '重新驗證完成');
  client.lifecycle.mockResolvedValue(ok(initialLife)); click('確認重新啟用'); await screen.findByRole('button', { name: '淘汰：建立表單' });
  expect(client.setNode).toHaveBeenCalledWith('define-form', 'reactivate', '重新驗證完成'); expect(client.usage).not.toHaveBeenCalled();
});

test('merge requires distinct nodes, an active keeper and a difference reason and updates the replacement label', async () => {
  const { client } = await ready();
  expect(button('合併節點').disabled).toBe(true);
  change('保留的節點', 'define-form'); change('併入的節點', 'import-records'); change('兩者差異與合併原因', ' ');
  expect(button('合併節點').disabled).toBe(true);
  change('兩者差異與合併原因', '字'.repeat(2001)); expect(button('合併節點').disabled).toBe(true);
  change('兩者差異與合併原因', '功能相同，保留新版'); expect(button('合併節點').disabled).toBe(false);
  change('保留的節點', 'import-records'); expect(button('合併節點').disabled).toBe(true);
  fireEvent.submit(button('合併節點').closest('form')!); expect(client.merge).not.toHaveBeenCalled();
  change('保留的節點', 'define-form');
  client.lifecycle.mockResolvedValue(ok({ nodes: [{ node_id: 'import-records', state: 'merged', reason: '功能相同', replaced_by: 'define-form', at: 'today' }], combos: [] }));
  click('合併節點'); await screen.findByText('已合併為建立表單');
  expect(client.merge).toHaveBeenCalledWith('define-form', 'import-records', '功能相同，保留新版');
  expect(screen.queryByRole('button', { name: '淘汰：匯入資料列' })).toBeNull();
});

test('combos preserve sequence order, need two nodes and usage confirmation, then can be reactivated', async () => {
  const { client } = await ready(); expect(screen.getByText(/只比對直接相連的節點/)).toBeTruthy();
  expect(button('淘汰此組合').disabled).toBe(true);
  change('下一個節點', 'import-records'); click('加入組合末端'); expect(button('淘汰此組合').disabled).toBe(true);
  change('下一個節點', 'define-form'); click('加入組合末端'); expect(button('淘汰此組合').disabled).toBe(false);
  expect(within(screen.getByRole('list', { name: '組合順序' })).getAllByRole('listitem').map(n => n.textContent)).toEqual(['匯入資料列', '建立表單']);
  click('淘汰此組合'); await screen.findByText('仍有 0 個案例、0 個版本引用。');
  expect(client.usage).toHaveBeenCalledWith({ combo: ['import-records', 'define-form'] }); expect(button('確認淘汰').disabled).toBe(true);
  change(/變更原因（必填/, '順序不適用');
  client.lifecycle.mockResolvedValue(ok({ nodes: [], combos: [{ combo: ['import-records', 'define-form'], state: 'deprecated', reason: '順序不適用', at: 'today' }] }));
  click('確認淘汰'); await screen.findByText('原因：順序不適用');
  expect(client.setCombo).toHaveBeenCalledWith(['import-records', 'define-form'], 'deprecate', '順序不適用');
  click('重新啟用組合：匯入資料列 → 建立表單'); expect(button('確認重新啟用').disabled).toBe(true); change(/變更原因（必填/, '已確認');
  client.lifecycle.mockResolvedValue(ok(initialLife)); click('確認重新啟用'); await screen.findByText('尚無已淘汰的組合。');
  expect(client.setCombo).toHaveBeenLastCalledWith(['import-records', 'define-form'], 'reactivate', '已確認');
  click('清空組合'); expect(within(screen.getByRole('list', { name: '組合順序' })).queryAllByRole('listitem')).toHaveLength(0);
});

test('failed lifecycle mutations show errors and never display success or change the state', async () => {
  const { client } = await ready(); client.setNode.mockResolvedValue(fail('E-DEPRECATED'));
  click('淘汰：建立表單'); await screen.findByText('仍有 0 個案例、0 個版本引用。'); change(/變更原因（必填/, '原因'); click('確認淘汰');
  await screen.findByRole('alert'); expect(screen.queryByText('已更新現況。')).toBeNull(); expect(button('淘汰：建立表單')).toBeTruthy(); expect(client.lifecycle).toHaveBeenCalledTimes(1);
});

function CanvasEditor({ lifecycle, initial, onChange }: { lifecycle?: Lifecycle; initial: AovGraphDocument; onChange: (doc: AovGraphDocument) => void }) {
  const [value, setValue] = useState(initial);
  return <WorkflowCanvas value={value} onChange={doc => { setValue(doc); onChange(doc); }} path={['graph-1']} onPathChange={() => {}} lifecycle={lifecycle} />;
}
function canvas(lifecycle?: Lifecycle, initial?: AovGraphDocument) {
  const doc = initial ?? addLogic(addFactory(emptyGraph, '測試廠')!.value, 'factory-1', '測試流程')!.value;
  const onChange = vi.fn(); const view = render(<CanvasEditor initial={doc} lifecycle={lifecycle} onChange={onChange} />); openToolGroups();
  return { ...view, onChange, doc };
}

test.each(['deprecated', 'merged'] as const)('toolbox %s disables adding and dragging but preserves existing nodes', state => {
  const initial = addCanvasNode(addLogic(addFactory(emptyGraph, '測試廠')!.value, 'factory-1', '測試流程')!.value, 'graph-1', 'define-form');
  const { onChange } = canvas(nodeLife(state), initial);
  const add = button('加入到畫布：建立表單'); expect(add.disabled).toBe(true);
  const card = add.closest<HTMLElement>('.tool-card')!; expect(card.draggable).toBe(false);
  expect(card.textContent).toContain(state === 'deprecated' ? '已淘汰：改用新版' : '已合併，請改用 匯入資料列');
  expect(add.getAttribute('aria-describedby')).toBe('case-tool-define-form');
  const setData = vi.fn(); fireEvent.dragStart(card, { dataTransfer: { setData } }); expect(setData).not.toHaveBeenCalled();
  fireEvent.click(add); expect(onChange).not.toHaveBeenCalled(); expect(button('建立表單')).toBeTruthy();
});

test('forged drop cannot bypass deprecated action guard', () => {
  const { container, onChange } = canvas(nodeLife('deprecated'));
  fireEvent.drop(container.querySelector('.workflow-canvas')!, { dataTransfer: { getData: () => 'define-form' }, clientX: 10, clientY: 10 });
  expect(onChange).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toBe('已淘汰：改用新版');
});

test('industry template add paths are disabled when their underlying action is retired', () => {
  const { container, onChange } = canvas(nodeLife('deprecated'));
  const details = container.querySelector<HTMLDetailsElement>('.workflow-tools details')!; details.open = true;
  const buttons = within(details).getAllByRole<HTMLButtonElement>('button', { name: /^加入產業節點/ }); expect(buttons.length).toBeGreaterThan(0);
  for (const add of buttons) { expect(add.disabled).toBe(true); fireEvent.click(add); }
  expect(onChange).not.toHaveBeenCalled();
});

test('suggestion add path is disabled for a retired action', () => {
  const doc = addLogic(addFactory(emptyGraph, '測試廠')!.value, 'factory-1', '測試流程')!.value;
  doc.relations = [{ id: 'relation', kind: 'shared-key', from: { formId: 'f1', fieldId: 'lot' }, to: { formId: 'f2', fieldId: 'lot' }, origin: 'user', confirmed: true }];
  const { onChange } = canvas(nodeLife('deprecated', 'trace-records'), doc);
  const add = button('加入「查詢追溯」節點'); expect(add.disabled).toBe(true); fireEvent.click(add); expect(onChange).not.toHaveBeenCalled();
});

test('offline toolbox has the original enabled buttons and accepts both button and drop additions', () => {
  const { container, onChange } = canvas();
  for (const action of actionCatalog.actions) expect(button(`加入到畫布：${action.name}`).disabled).toBe(false);
  expect(button('加入到畫布：建立表單').closest<HTMLElement>('.tool-card')!.draggable).toBe(true);
  click('加入到畫布：建立表單'); expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.drop(container.querySelector('.workflow-canvas')!, { dataTransfer: { getData: () => 'import-records' }, clientX: 10, clientY: 10 });
  expect(onChange).toHaveBeenCalledTimes(2);
  const final = onChange.mock.calls[1][0] as AovGraphDocument;
  expect(final.graphs[0].nodes.filter(n => n.kind === 'node').map(n => n.actionId)).toEqual(['define-form', 'import-records']);
});

test('App wires lifecycle into the canvas and an offline refresh restores original tools without losing the flow', async () => {
  let online = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!online) throw new Error('offline');
    return new Response(JSON.stringify(url.endsWith('/lifecycle') ? nodeLife('deprecated') : []));
  }));
  render(<App />);
  const nav = screen.getByRole('navigation', { name: '主要導覽' });
  expect(within(nav).getAllByRole('button').map(b => b.textContent)).toEqual(['首頁', '流程', '案例庫', '資料集', '執行記錄', '系統設定']);
  click('流程'); startLogic(); openToolGroups();
  await waitFor(() => expect(button('加入到畫布：建立表單').disabled).toBe(true));
  click('案例庫'); await screen.findByText('尚無案例，請先建立案例。');
  expect(button('案例庫').getAttribute('aria-current')).toBe('page');
  online = false; click('流程');
  await waitFor(() => expect(button('加入到畫布：建立表單').disabled).toBe(false));
  click('加入到畫布：建立表單'); expect(button('建立表單')).toBeTruthy();
});
