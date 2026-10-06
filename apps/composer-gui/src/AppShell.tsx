import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icons';
import { workingNodes, type AovGraphDocument } from './workflowGraph';

// Application shell (D63): five navigation entries; the five required steps (D30) live inside the "流程" page.
export type PageId = 'home' | 'flow' | 'datasets' | 'runs' | 'settings';
export const pages: { id: PageId; title: string; icon: IconName }[] = [
  { id: 'home', title: '首頁', icon: 'logo' },
  { id: 'flow', title: '流程', icon: 'link' },
  { id: 'datasets', title: '資料集', icon: 'folder' },
  { id: 'runs', title: '執行記錄', icon: 'file' },
  { id: 'settings', title: '系統設定', icon: 'lock' },
];

export function AppShell({ page, onNavigate, children }: {
  page: PageId; onNavigate: (page: PageId) => void; children: ReactNode;
}) {
  // Collapsing keeps every label for assistive technology and only hides the text (wide viewports; narrow ones use the top bar).
  const [collapsed, setCollapsed] = useState(false);
  const hidden = collapsed ? 'visually-hidden' : undefined;
  return <div className={collapsed ? 'app-shell sidebar-collapsed' : 'app-shell'}>
    <aside className="sidebar">
      <p className="brand"><Icon name="logo" className="brand-logo" /><strong className={hidden}>Composer</strong></p>
            <nav id="app-nav" aria-label="主要導覽"><ul>{pages.map(item => <li key={item.id}>
        <button aria-current={item.id === page ? 'page' : undefined} title={collapsed ? item.title : undefined} onClick={() => onNavigate(item.id)}><Icon name={item.icon} /><span className={hidden}>{item.title}</span></button>
      </li>)}</ul></nav>
      <button className="sidebar-toggle" aria-expanded={!collapsed} aria-controls="app-nav" title={collapsed ? '展開導覽' : '收合導覽'} onClick={() => setCollapsed(!collapsed)}><Icon name="chevron" className="toggle-icon" /><span className="visually-hidden">{collapsed ? '展開導覽' : '收合導覽'}</span></button>
    </aside>
    <div className="shell-content">{children}</div>
  </div>;
}

// Skeleton page: states what is not provided yet instead of showing made-up data (D63, DESIGN.md).
export function PlaceholderPage({ title, lead, items }: { title: string; lead: string; items: string[] }) {
  return <main id="main-content" tabIndex={-1}>
    <div className="page-head"><h1>{title}</h1></div>
    <p className="lead">{lead}</p>
    <section className="column" aria-labelledby={`${title}-todo`}>
      <h2 id={`${title}-todo`}>規劃中的內容</h2>
      <ul className="check-list">{items.map(item => <li key={item}><span>{item}</span><span className="badge badge-pending">尚未提供</span></li>)}</ul>
    </section>
  </main>;
}

// Home shows only counts derived from the current session; there is no execution history (D16).
export function HomePage({ aov, enabledKits, onNavigate }: { aov: AovGraphDocument; enabledKits: number; onNavigate: (page: PageId) => void }) {
  const counts: [string, number][] = [['工廠', aov.factories.length], ['流程節點', aov.graphs.reduce((count, graph) => count + workingNodes(graph).length, 0)], ['表單', aov.forms.length], ['已確認關聯', aov.relations.length], ['已啟用功能', enabledKits]];
  return <main id="main-content" tabIndex={-1}>
    <div className="page-head"><h1>首頁</h1></div>
    <p className="lead">目前工作階段的設定概況。</p>
    <section className="column" aria-labelledby="home-summary">
      <h2 id="home-summary">設定概況</h2>
      <dl className="summary-grid">{counts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="actions"><button className="primary" onClick={() => onNavigate('flow')}>前往流程</button></div>
    </section>
    <p className="note"><Icon name="info" /><span>目前只做設定期，系統尚無執行紀錄與待處理事項；這些數字只來自本次工作階段，關閉頁面後不保留。</span></p>
  </main>;
}
