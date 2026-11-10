// Client for the analytical-four-kit routes. Same-origin; the global fetch wrapper adds the session token.

export type Layers = { a: boolean; b: boolean; c: boolean };
export type Settings = {
  schemaVersion: 1;
  layers: Layers;
  mode: "daily" | "complain";
  analysisConfig: string;
  llm: { endpoint: string; timeoutSeconds: number; apiKeyEnv: string };
  columnMapping: Record<string, string>;
};
// A finding carries the server's Chinese sentence and, for the sentences that have one, a key and the values to put in it.
export type Param = string | number | boolean | null | Param[] | { [name: string]: Param };
export type Finding = { layer: string; code: string; message: string; source?: string; key?: string; params?: Record<string, Param> };
export type Report = {
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
  otherIssues?: Finding[];
  summary: Record<string, unknown>;
};
export type Readiness = Record<string, { ready: boolean; problems: { code: string; message: string }[] }>;
export type Stage = { id: string; layer: string; name: string; state: string; detail: string };
export type Run = {
  runId: string;
  state: "queued" | "running" | "succeeded" | "failed";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  mode: string;
  layers: Layers;
  stages: Stage[];
  error: { stage: string | null; message: string } | null;
  warnings: Finding[];
};
export type Upload = {
  uploadId: string;
  kind: string;
  filename: string;
  bytes: number;
  status: "staged" | "accepted" | "discarded";
  createdAt: string;
  target: string | null;
  ok?: boolean;
  errorCount?: number;
  warningCount?: number;
  report?: Report;
  replacedBackup?: string | null;
};
export type TemplateInfo = { name: string; description: string; contentType: string; bytes: number };
export type FeedbackItem = {
  feedbackId: string;
  eventId: string;
  confirmedNg: string;
  actualCause: string | null;
  status: "pending" | "approved" | "rejected";
  submittedBy: string;
  submittedRole: string;
  submittedAt: string;
  source: string;
  isNewCode: boolean | null;
  published: boolean;
};
export type LibraryVersion = { version: number; createdAt: string; createdBy: string; recordCount: number; errorRecordCount: number; addedFeedbackIds: string[]; replacedEventIds: string[] };

const BASE = "/api/analytical-four";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((item) => (typeof item === "string" ? item : `${item?.field ?? ""} ${item?.message ?? item?.msg ?? ""}`.trim())).join("；");
  return "";
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(0, "network");
  }
  if (!response.ok) {
    let message = "";
    try {
      message = detailText((await response.json())?.detail);
    } catch {
      /* the body was not JSON; the status code is all there is */
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  getSettings: () => call<Settings>("/settings"),
  putSettings: (settings: Settings) => call<{ settings: Settings; readiness: Readiness }>("/settings", json("PUT", settings)),
  status: () => call<{ enabledLayers: string[]; mode: string; llmEndpointSet: boolean; activeRun: string | null; readiness: Readiness }>("/status"),
  dataCheck: () => call<Report>("/data-check"),
  loadDemo: () => call<{ copied: string[] }>("/demo", { method: "POST" }),
  templates: () => call<{ templates: TemplateInfo[] }>("/templates"),
  createRun: () => call<Run>("/runs", { method: "POST" }),
  runs: () => call<{ runs: Run[] }>("/runs"),
  run: (id: string) => call<Run>(`/runs/${encodeURIComponent(id)}`),
  results: (id: string) => call<{ results: string[] }>(`/runs/${encodeURIComponent(id)}/results`),
  result: (id: string, name: string) => call<unknown>(`/runs/${encodeURIComponent(id)}/result?name=${encodeURIComponent(name)}`),
  uploads: () => call<{ uploads: Upload[] }>("/uploads"),
  upload: (id: string) => call<Upload>(`/uploads/${encodeURIComponent(id)}`),
  createUpload: (kind: string, file: File) =>
    call<Upload>(`/uploads?kind=${encodeURIComponent(kind)}&filename=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }),
  acceptUpload: (id: string, replace: boolean) => call<Upload>(`/uploads/${encodeURIComponent(id)}/accept`, json("POST", { replace })),
  discardUpload: (id: string) => call<Upload>(`/uploads/${encodeURIComponent(id)}`, { method: "DELETE" }),
  feedback: (status = "") => {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";
    return call<{ feedback: FeedbackItem[] }>(`/feedback${query}`);
  },
  submitFeedback: (body: { runId: string; eventId: string; confirmedNg: string; actualCause: string; note: string }) => call<FeedbackItem>("/feedback", json("POST", body)),
  importFeedback: (records: unknown[]) => call<{ feedback: FeedbackItem[] }>("/feedback/import", json("POST", { records })),
  decideFeedback: (id: string, approve: boolean, note: string) => call<FeedbackItem>(`/feedback/${encodeURIComponent(id)}/decision`, json("POST", { approve, note })),
  publishLibrary: () => call<LibraryVersion>("/library/publish", { method: "POST" }),
  restoreLibrary: (version: number) => call<LibraryVersion>("/library/restore", json("POST", { version })),
  versions: () => call<{ versions: LibraryVersion[] }>("/library/versions"),
};

/** Downloads a template. A plain link would not carry the session token, so the file is fetched and saved from memory. */
export async function downloadTemplate(name: string): Promise<void> {
  const response = await fetch(`${BASE}/templates/${encodeURIComponent(name)}`);
  if (!response.ok) throw new ApiError(response.status, "");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
