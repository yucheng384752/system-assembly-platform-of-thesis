import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

export function LoadError({ error }: { error: unknown }) {
  return <main>
    <h1>無法開啟系統組裝畫面</h1>
    <p role="alert">功能目錄或設定檔內容有誤，畫面無法載入。請聯絡系統管理者確認設定檔後重新整理。</p>
    <details><summary>進階：錯誤詳情</summary><p>{error instanceof Error ? error.message : String(error)}</p></details>
  </main>;
}
// Catalog files are parsed while the App module loads; a failure there must show an explanation instead of a blank page.
export async function mount(element: HTMLElement, load: () => Promise<{ App: ComponentType }>) {
  const root = createRoot(element);
  try {
    const { App } = await load();
    root.render(<StrictMode><App /></StrictMode>);
  } catch (error) {
    console.error('Composer 載入失敗', error);
    root.render(<LoadError error={error} />);
  }
}
