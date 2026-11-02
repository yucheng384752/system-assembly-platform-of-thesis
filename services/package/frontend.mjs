// Frontend source assembly: shared base + the pages of the selected Kits, nothing else.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(repository, 'services/frontend/base');

/** Pages a Kit contributes, in tab order. `label` is an i18n key under `tabs`. */
export const KIT_PAGES = /** @type {Record<string, {id: string, component: string, file: string, label: string}[]>} */ ({
  'upload-validation-kit': [{ id: 'upload', component: 'UploadPage', file: 'UploadPage', label: 'upload' }],
  'query-traceability-kit': [{ id: 'query', component: 'QueryPage', file: 'QueryPage', label: 'query' }],
  'analytics-kit': [{ id: 'analysis', component: 'AnalyticsPage', file: 'AnalyticsPage', label: 'analysis' }],
  'generic-forms-kit': [
    { id: 'forms', component: 'FormsPage', file: 'FormsPage', label: 'forms' },
    { id: 'dataflows', component: 'DataflowPage', file: 'DataflowPage', label: 'dataflows' },
  ],
  'audit-edit-kit': [{ id: 'editReasons', component: 'EditReasonsPage', file: 'EditReasonsPage', label: 'editReasons' }],
  'logs-ops-kit': [{ id: 'logs', component: 'DeveloperLogsPage', file: 'DeveloperLogsPage', label: 'logs' }],
});

// Base files that only the upload page needs; they are left out when upload-validation-kit is not selected.
const UPLOAD_ONLY = ['src/pages/UploadPage.tsx', 'src/styles/upload-import.css'];

/** @param {string} directory @returns {Promise<string[]>} */
async function walk(directory) {
  const names = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) names.push(...(await walk(full)).map(name => `${entry.name}/${name}`));
    else names.push(entry.name);
  }
  return names;
}

/** @param {string[]} selected @returns {{id: string, component: string, file: string, label: string}[]} */
export function selectedPages(selected) {
  if (selected.includes('generic-forms-kit') && !selected.includes('audit-edit-kit')) {
    throw new Error('generic-forms-kit 的通用表格頁在執行期使用 audit-edit-kit 的編輯視窗，前端無法單獨納入');
  }
  if (selected.includes('upload-validation-kit') && !selected.includes('generic-forms-kit')) {
    throw new Error('upload-validation-kit 的檔案上傳頁把 CSV 匯入通用表單（D152），前端無法在沒有 generic-forms-kit 時納入');
  }
  return selected.flatMap(kit => KIT_PAGES[kit] ?? []);
}

/** @param {{id: string, component: string, file: string, label: string}[]} pages */
export function appSource(pages) {
  const imports = pages.map(page => `import { ${page.component} } from "./pages/${page.file}";`).join('\n');
  const ids = pages.map(page => `"${page.id}"`).join(' | ');
  const tabs = pages.map(page => `    { id: "${page.id}", label: t("tabs.${page.label}") },`).join('\n');
  const views = pages.map(page => `        {signedIn && tab === "${page.id}" ? <${page.component} /> : null}`).join('\n');
  return `// Generated at assembly time from the selected Kits. Do not edit.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
${imports}
import { LoginPage } from "./pages/LoginPage";
import { ToastContainer } from "./components/common/ToastContainer";
import "./styles/app.css";
import { AUTH_REQUIRED_EVENT, getSessionToken, setSessionToken } from "./services/auth";
import { getFontScaleId, setFontScaleId, type FontScaleId } from "./services/a11y";

type MainTab = ${ids};

function App() {
  const { t, i18n } = useTranslation();
  const [signedIn, setSignedIn] = useState<boolean>(() => Boolean(getSessionToken()));
  const [tab, setTab] = useState<MainTab>("${pages[0].id}");
  const [fontScale, setFontScale] = useState<FontScaleId>(() => getFontScaleId());

  const currentLang = useMemo(() => ((i18n.resolvedLanguage || i18n.language || "zh-TW").toLowerCase().startsWith("zh") ? "zh-TW" : "en"), [i18n.language, i18n.resolvedLanguage]);
  const tabs: { id: MainTab; label: string }[] = [
${tabs}
  ];

  useEffect(() => {
    const back = () => setSignedIn(false);
    window.addEventListener(AUTH_REQUIRED_EVENT, back);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, back);
  }, []);

  return (
    <div className="app-root">
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
          <div>
            <h1 className="app-title">{t("app.title")}</h1>
            <p className="app-subtitle">{t("app.subtitle")}</p>
          </div>
          <div className="app-lang-switch" aria-label={t("language.label")}>
            <span className="app-lang-label">{t("language.label")}</span>
            <div className="app-lang-tabs" role="tablist" aria-label={t("language.label")}>
              <button type="button" role="tab" aria-selected={currentLang === "zh-TW"} className={\`app-lang-tab \${currentLang === "zh-TW" ? "is-active" : ""}\`} onClick={() => i18n.changeLanguage("zh-TW")}>{t("language.zhTW")}</button>
              <button type="button" role="tab" aria-selected={currentLang === "en"} className={\`app-lang-tab \${currentLang === "en" ? "is-active" : ""}\`} onClick={() => i18n.changeLanguage("en")}>{t("language.en")}</button>
            </div>
          </div>
          <div className="app-a11y" aria-label={t("a11y.fontSize.label")}>
            <span className="app-a11y-label">{t("a11y.fontSize.label")}</span>
            <select className="app-a11y-select" value={fontScale} onChange={(e) => { const next = (e.target.value || "md") as FontScaleId; setFontScale(next); setFontScaleId(next); }}>
              <option value="sm">{t("a11y.fontSize.small")}</option>
              <option value="md">{t("a11y.fontSize.medium")}</option>
              <option value="lg">{t("a11y.fontSize.large")}</option>
            </select>
          </div>
          {signedIn ? <button type="button" className="app-main-tab" onClick={() => { setSessionToken(""); setSignedIn(false); }}>{t("login.signOut")}</button> : null}
        </div>
        {signedIn ? (
          <div className="app-main-tabs">
            {tabs.map((item) => (
              <button key={item.id} className={\`app-main-tab \${tab === item.id ? "is-active" : ""}\`} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>
        ) : null}
      </header>
      <main className="app-main">
        {!signedIn ? <LoginPage onSignedIn={() => setSignedIn(true)} /> : null}
${views}
      </main>
      <ToastContainer />
    </div>
  );
}

export default App;
`;
}

/**
 * Files of the frontend source tree, keyed by path under `frontend/`.
 * @param {string} kitsDirectory @param {string[]} selected
 * @returns {Promise<Map<string, Buffer>>}
 */
export async function frontendTree(kitsDirectory, selected) {
  const pages = selectedPages(selected);
  if (!pages.length) throw new Error('所選 Kit 沒有任何前端頁面，無法產生前端');
  /** @type {Map<string, Buffer>} */
  const tree = new Map();
  /** @param {string} name @param {Buffer} data */
  const put = (name, data) => {
    if (tree.has(name)) throw new Error(`前端檔案重複：${name}`);
    tree.set(name, data);
  };
  // Checkouts with autocrlf differ in line endings; the package must not.
  const text = /** @param {string} name @param {Buffer} data */ (name, data) =>
    /\.(tsx?|css|json|html)$/.test(name) ? Buffer.from(data.toString('utf8').replaceAll('\r\n', '\n')) : data;
  const withUpload = selected.includes('upload-validation-kit');
  for (const name of (await walk(base)).sort()) {
    if (!withUpload && UPLOAD_ONLY.some(prefix => name === prefix || (prefix.endsWith('/') && name.startsWith(prefix)))) continue;
    if (name === 'src/App.tsx') continue;
    put(name, text(name, await readFile(path.join(base, name))));
  }
  for (const kit of selected) {
    const root = path.join(kitsDirectory, kit, 'src/frontend');
    /** @type {string[]} */
    let names = [];
    try { names = await walk(root); } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    }
    for (const name of names.sort()) {
      if (name === 'src/App.tsx') continue;
      put(name, text(name, await readFile(path.join(root, name))));
    }
  }
  put('src/App.tsx', Buffer.from(appSource(pages)));
  return new Map([...tree].map(([name, data]) => [`frontend/${name}`, data]));
}
