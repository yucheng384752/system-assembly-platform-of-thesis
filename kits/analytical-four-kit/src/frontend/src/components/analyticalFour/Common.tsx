import type { ReactNode } from "react";
import { ApiError, type Finding, type Param, type Report } from "../../services/analyticalFour";
import type { Labels } from "./labels";

/** The words a person should see for a failed call: the server's own explanation when it gave one. */
export function errorText(error: unknown, L: Labels): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return L.common.network;
    // The gateway answers a refused role with the bare English word; say it in the page's own language instead.
    if (error.status === 403 && (!error.message || /^forbidden$/i.test(error.message.trim()))) return L.common.forbidden;
    return error.message ? `${error.message}` : `${L.common.error} (${error.status})`;
  }
  return L.common.error;
}

function paramText(value: Param | undefined, L: Labels): string {
  if (Array.isArray(value)) return value.map((item) => paramText(item, L)).join(L.list);
  if (value && typeof value === "object") {
    if ("term" in value) return L.terms[String(value.term)] ?? String(value.term);
    if ("items" in value && Array.isArray(value.items)) {
      const shown = paramText(value.items, L);
      const total = Number(value.total ?? value.items.length);
      return total > value.items.length ? shown + L.more.replace("{total}", String(total)) : shown;
    }
    if ("key" in value) return fill(L.problems[String(value.key)] ?? String(value.key), (value.params ?? {}) as Record<string, Param>, L);
  }
  return value === null || value === undefined ? "" : String(value);
}

function fill(template: string, params: Record<string, Param>, L: Labels): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? paramText(params[name], L) : whole));
}

/** A report sentence in the page's language; without a table entry for its key it is the server's own (Chinese) sentence. */
export function findingText(item: Finding, L: Labels): string {
  const template = item.key ? L.findings[item.key] : undefined;
  return template && item.params ? fill(template, item.params, L) : item.message;
}

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="a4-section">
      <h3 className="a4-h3">{title}</h3>
      {hint ? <p className="a4-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

/** Status and failure text is always words, never only a color (role="status" / role="alert" so it is announced). */
export function Notice({ kind, children }: { kind: "info" | "ok" | "error"; children: ReactNode }) {
  return (
    <p className={`a4-notice a4-notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

function FindingList({ title, items, kind, L }: { title: string; items: Finding[]; kind: "error" | "warning"; L: Labels }) {
  if (!items.length) return null;
  return (
    <div className={`a4-findings a4-findings-${kind}`}>
      <h4 className="a4-h4">
        {title}{L.open}{items.length}{L.close}
      </h4>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.code}-${index}`}>
            <span className="a4-code">{item.code}</span> {findingText(item, L)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReportView({ report, L }: { report: Report; L: Labels }) {
  const other = report.otherIssues ?? [];
  const clean = !report.errors.length && !report.warnings.length && !other.length;
  const summary = Object.entries(report.summary ?? {}).filter(([, value]) => value !== null && value !== undefined && typeof value !== "object");
  return (
    <div className="a4-report">
      {clean ? <Notice kind="ok">{L.common.noProblems}</Notice> : null}
      <FindingList title={L.common.errors} items={report.errors} kind="error" L={L} />
      <FindingList title={L.common.warnings} items={report.warnings} kind="warning" L={L} />
      <FindingList title={L.common.other} items={other} kind="warning" L={L} />
      {summary.length ? (
        <details className="a4-details">
          <summary>{L.prepare.summary}</summary>
          <dl className="a4-dl">
            {summary.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

export function stateLabel(L: Labels, state: string): string {
  return (L.states as Record<string, string>)[state] ?? state;
}

export function formatTime(value: string | null | undefined, L: Labels): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(L.locale);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
