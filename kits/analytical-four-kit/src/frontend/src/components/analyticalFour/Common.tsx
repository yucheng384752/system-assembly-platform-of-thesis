import type { ReactNode } from "react";
import { ApiError, type Finding, type Report } from "../../services/analyticalFour";
import type { Labels } from "./labels";

/** The words a person should see for a failed call: the server's own explanation when it gave one. */
export function errorText(error: unknown, L: Labels): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return L.common.network;
    if (error.status === 403 && !error.message) return L.common.forbidden;
    return error.message ? `${error.message}` : `${L.common.error} (${error.status})`;
  }
  return L.common.error;
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

function FindingList({ title, items, kind }: { title: string; items: Finding[]; kind: "error" | "warning" }) {
  if (!items.length) return null;
  return (
    <div className={`a4-findings a4-findings-${kind}`}>
      <h4 className="a4-h4">
        {title}（{items.length}）
      </h4>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.code}-${index}`}>
            <span className="a4-code">{item.code}</span> {item.message}
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
      <FindingList title={L.common.errors} items={report.errors} kind="error" />
      <FindingList title={L.common.warnings} items={report.warnings} kind="warning" />
      <FindingList title={L.common.other} items={other} kind="warning" />
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

export function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
