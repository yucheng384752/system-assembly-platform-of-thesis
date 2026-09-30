import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { getApiKeyHeaderName, getApiKeyValue } from "../services/auth";
import { TENANT_STORAGE_KEY } from "../services/tenant";

type FormType = { code: string; name: string };
type DataflowLink = {
  id: string;
  flow_code: string;
  from_station_code: string;
  to_station_code: string;
  parent_column: string | null;
  child_column: string | null;
  sort_order: number;
};

const emptyLink = (): Omit<DataflowLink, "id"> => ({
  flow_code: "default", from_station_code: "", to_station_code: "",
  parent_column: "", child_column: "", sort_order: 0,
});

function apiHeaders(extra: Record<string, string> = {}): HeadersInit {
  const headers: Record<string, string> = { ...extra };
  const tenantId = localStorage.getItem(TENANT_STORAGE_KEY);
  const apiKey = getApiKeyValue();
  if (tenantId) headers["X-Tenant-Id"] = tenantId;
  if (apiKey) headers[getApiKeyHeaderName()] = apiKey;
  return headers;
}

async function detail(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return body.detail || `HTTP ${response.status}`;
}

const input: CSSProperties = { padding: "6px 8px", border: "1px solid #d1d5db", borderRadius: 4 };
const button = (color = "#2563eb"): CSSProperties => ({
  padding: "6px 12px", border: 0, borderRadius: 4, color: "white", background: color, cursor: "pointer",
});

export function DataflowPage() {
  const [forms, setForms] = useState<FormType[]>([]);
  const [links, setLinks] = useState<DataflowLink[]>([]);
  const [draft, setDraft] = useState(emptyLink());
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  async function load(flowCode = draft.flow_code) {
    setError("");
    const [formsResponse, linksResponse] = await Promise.all([
      fetch("/api/forms", { headers: apiHeaders() }),
      fetch(`/api/dataflows/links?flow_code=${encodeURIComponent(flowCode.trim() || "default")}`, { headers: apiHeaders() }),
    ]);
    if (!formsResponse.ok || !linksResponse.ok) {
      setError(await detail(!formsResponse.ok ? formsResponse : linksResponse));
      return;
    }
    setForms(await formsResponse.json());
    setLinks(await linksResponse.json());
  }

  useEffect(() => { void load("default"); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/dataflows/links", {
      method: editing ? "PUT" : "POST",
      headers: apiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...draft, flow_code: draft.flow_code.trim() || "default" }),
    });
    if (!response.ok) {
      setError(await detail(response));
      return;
    }
    const flowCode = draft.flow_code.trim() || "default";
    setDraft({ ...emptyLink(), flow_code: flowCode });
    setEditing(false);
    await load(flowCode);
  }

  async function remove(link: DataflowLink) {
    if (!confirm(`確定刪除 ${link.from_station_code} → ${link.to_station_code}？`)) return;
    const response = await fetch(
      `/api/dataflows/links/${encodeURIComponent(link.from_station_code)}/${encodeURIComponent(link.to_station_code)}?flow_code=${encodeURIComponent(link.flow_code)}`,
      { method: "DELETE", headers: apiHeaders() },
    );
    if (!response.ok) setError(await detail(response));
    else await load(link.flow_code);
  }

  function edit(link: DataflowLink) {
    setDraft({
      flow_code: link.flow_code, from_station_code: link.from_station_code,
      to_station_code: link.to_station_code, parent_column: link.parent_column ?? "",
      child_column: link.child_column ?? "", sort_order: link.sort_order,
    });
    setEditing(true);
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h2 style={{ margin: 0 }}>資料流管理</h2>
      {error && <div style={{ color: "#b91c1c" }}>{error}</div>}
      <form onSubmit={save} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
        <label>資料流<br /><input required value={draft.flow_code} onChange={(e) => setDraft({ ...draft, flow_code: e.target.value })} style={input} /></label>
        <label>上游站別<br /><select required disabled={editing} value={draft.from_station_code} onChange={(e) => setDraft({ ...draft, from_station_code: e.target.value })} style={input}><option value="">請選擇</option>{forms.map((form) => <option key={form.code} value={form.code}>{form.name} ({form.code})</option>)}</select></label>
        <label>下游站別<br /><select required disabled={editing} value={draft.to_station_code} onChange={(e) => setDraft({ ...draft, to_station_code: e.target.value })} style={input}><option value="">請選擇</option>{forms.map((form) => <option key={form.code} value={form.code}>{form.name} ({form.code})</option>)}</select></label>
        <label>上游欄位（選填）<br /><input value={draft.parent_column ?? ""} onChange={(e) => setDraft({ ...draft, parent_column: e.target.value })} style={input} /></label>
        <label>下游欄位（選填）<br /><input value={draft.child_column ?? ""} onChange={(e) => setDraft({ ...draft, child_column: e.target.value })} style={input} /></label>
        <button type="submit" style={button()}>{editing ? "更新" : "新增"}</button>
        {editing && <button type="button" style={button("#6b7280")} onClick={() => { setDraft(emptyLink()); setEditing(false); }}>取消</button>}
        <button type="button" style={button("#6b7280")} onClick={() => void load()}>重新整理</button>
      </form>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th>資料流</th><th>上游</th><th>下游</th><th>欄位對應</th><th>操作</th></tr></thead>
        <tbody>
          {links.map((link) => <tr key={link.id}>
            <td>{link.flow_code}</td><td>{link.from_station_code}</td><td>{link.to_station_code}</td>
            <td>{link.parent_column || "—"} → {link.child_column || "—"}</td>
            <td><button type="button" onClick={() => edit(link)}>編輯</button> <button type="button" onClick={() => void remove(link)}>刪除</button></td>
          </tr>)}
          {links.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "#6b7280", padding: 16 }}>尚無連結</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
