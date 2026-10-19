import type { Kit, Recipe } from '../../../libs/ui-runtime/types';
import { summarizeKitWorkflows, workflowStatus } from './kitWorkflows';

export function KitWorkflowSummary({ recipe, kits }: { recipe: Recipe; kits: Kit[] }) {
  const rows = summarizeKitWorkflows(recipe, kits);
  return <details>
    <summary>所選功能流程總表</summary>
    <p>依目前選配列出步驟與已定義連線，完整總表會附在設定交付包。草稿與缺漏不代表系統已可執行。</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="所選功能流程總表">
      <table><caption>所選功能的流程定義狀態</caption><thead><tr><th scope="col">功能</th><th scope="col">狀態</th><th scope="col">步驟與連線</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.kitId}><th scope="row">{row.name}</th><td>{workflowStatus[row.status]}</td><td>
          {row.workflow ? <>
            <p>{row.workflow.nodes.map(node => node.name).join('、') || '無啟用步驟'}</p>
            <p>{row.workflow.edges.map(edge => `${row.workflow!.nodes.find(n => n.id === edge.from)!.name} → ${row.workflow!.nodes.find(n => n.id === edge.to)!.name}`).join('；') || '無連線'}</p>
          </> : '尚無可顯示的流程'}
          <details><summary>進階：流程範圍與檢查說明</summary><p>{row.note}</p></details>
        </td></tr>)}</tbody>
      </table>
    </div>
  </details>;
}
