import { useCallback, useEffect, useState } from "react";
import { api, type FeedbackItem, type LibraryVersion, type Run } from "../../services/analyticalFour";
import { Notice, Section, errorText, formatTime, stateLabel } from "./Common";
import { useLabels } from "./labels";

type EventChoice = { id: string; suggested: string };

function eventsOf(value: unknown): EventChoice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = item as { event_id?: unknown; diagnosis_results?: { suggested_ng_code?: unknown } };
    return typeof record?.event_id === "string" ? [{ id: record.event_id, suggested: String(record.diagnosis_results?.suggested_ng_code ?? "") }] : [];
  });
}

export function FeedbackPanel() {
  const L = useLabels();
  const [runs, setRuns] = useState<Run[]>([]);
  const [runId, setRunId] = useState("");
  const [events, setEvents] = useState<EventChoice[]>([]);
  const [eventId, setEventId] = useState("");
  const [code, setCode] = useState("");
  const [cause, setCause] = useState("");
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [versions, setVersions] = useState<LibraryVersion[]>([]);
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [eventsMessage, setEventsMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [list, feedback, library] = await Promise.all([api.runs(), api.feedback(filter), api.versions()]);
      setRuns(list.runs.filter((run) => run.mode === "complain" && run.state === "succeeded"));
      setItems(feedback.feedback);
      setVersions(library.versions);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error, L) });
    }
  }, [filter, L]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setEvents([]);
    setEventId("");
    setEventsMessage("");
    if (!runId) return;
    let cancelled = false;
    api
      .result(runId, "search_key_results.json")
      .then((value) => {
        if (cancelled) return;
        const found = eventsOf(value);
        setEvents(found);
        if (!found.length) setEventsMessage(L.feedback.noEvents);
      })
      .catch(() => {
        if (!cancelled) setEventsMessage(L.feedback.noEvents);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, L]);

  const guarded = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage({ kind: "ok", text });
      await refresh();
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error, L) });
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    guarded(async () => {
      if (!runId || !eventId) {
        throw new Error("missing");
      }
      await api.submitFeedback({ runId, eventId, confirmedNg: code.trim(), actualCause: cause, note });
      setCode("");
      setCause("");
      setNote("");
      return L.feedback.submitted;
    });

  const importFile = (file: File | undefined) => {
    if (!file) return;
    void guarded(async () => {
      const parsed = JSON.parse(await file.text()) as unknown;
      const records = Array.isArray(parsed) ? parsed : (parsed as { records?: unknown[] })?.records;
      if (!Array.isArray(records)) throw new Error("records");
      const done = await api.importFeedback(records);
      return `${L.feedback.imported}：${done.feedback.length}`;
    });
  };

  const decide = (id: string, approve: boolean) => guarded(async () => void (await api.decideFeedback(id, approve, decisionNote)));
  const [restoring, setRestoring] = useState<number | null>(null);
  const restore = (version: number) => guarded(async () => {
    setRestoring(null);
    return `${L.feedback.restored}：v${(await api.restoreLibrary(version)).version}`;
  });
  const publish = () => guarded(async () => `${L.feedback.published2}：v${(await api.publishLibrary()).version}`);

  const canSubmit = Boolean(runId && eventId && code.trim());

  return (
    <div className="a4-panel">
      {message ? (
        <div className="a4-flash">
          <Notice kind={message.kind}>{message.text}</Notice>
        </div>
      ) : null}

      <Section title={L.feedback.submitTitle} hint={L.feedback.submitHint}>
        {runs.length ? (
          <div className="a4-form">
            <label className="a4-field">
              <span>{L.feedback.run}</span>
              <select className="a4-input" value={runId} onChange={(event) => setRunId(event.target.value)}>
                <option value="">{L.run.pick}</option>
                {runs.map((run) => (
                  <option key={run.runId} value={run.runId}>
                    {formatTime(run.startedAt ?? run.createdAt)}　{run.runId}
                  </option>
                ))}
              </select>
            </label>
            <label className="a4-field">
              <span>{L.feedback.event}</span>
              <select className="a4-input" value={eventId} disabled={!events.length} onChange={(event) => setEventId(event.target.value)}>
                <option value="" />
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id}
                    {item.suggested ? `（${item.suggested}）` : ""}
                  </option>
                ))}
              </select>
            </label>
            {eventsMessage ? <p className="a4-muted" role="status">{eventsMessage}</p> : null}
            <label className="a4-field">
              <span>{L.feedback.code}</span>
              <input className="a4-input" value={code} maxLength={50} onChange={(event) => setCode(event.target.value)} />
            </label>
            <label className="a4-field">
              <span>{L.feedback.cause}</span>
              <textarea className="a4-input" rows={3} maxLength={500} value={cause} onChange={(event) => setCause(event.target.value)} />
            </label>
            <label className="a4-field">
              <span>{L.feedback.note}</span>
              <input className="a4-input" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
            <div>
              <button type="button" className="a4-btn a4-btn-primary" disabled={busy || !canSubmit} onClick={() => void submit()}>
                {L.feedback.submit}
              </button>
              {!runId ? <span className="a4-muted">　{L.feedback.needRun}</span> : null}
            </div>
          </div>
        ) : (
          <p className="a4-muted">{L.feedback.needRun}</p>
        )}
      </Section>

      <Section title={L.feedback.importTitle} hint={L.feedback.importHint}>
        <label className="a4-file">
          <input type="file" accept=".json,application/json" className="a4-file-input" onChange={(event) => { importFile(event.target.files?.[0]); event.target.value = ""; }} />
          <span className="a4-btn">{L.feedback.importFile}</span>
        </label>
      </Section>

      <Section title={L.feedback.listTitle}>
        <div className="a4-form">
          <label className="a4-field">
            <span>{L.feedback.filter}</span>
            <select className="a4-input" value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="">{L.feedback.all}</option>
              {["pending", "approved", "rejected"].map((state) => (
                <option key={state} value={state}>
                  {stateLabel(L, state === "pending" ? "pending" : state)}
                </option>
              ))}
            </select>
          </label>
          <label className="a4-field">
            <span>{L.feedback.decisionNote}</span>
            <input className="a4-input" maxLength={500} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} />
          </label>
        </div>
        {items.length ? (
          <div className="a4-table-wrap">
            <table className="a4-table">
              <thead>
                <tr>
                  <th>{L.feedback.event2}</th>
                  <th>{L.feedback.code}</th>
                  <th>{L.feedback.cause}</th>
                  <th>{L.feedback.by}</th>
                  <th>{L.feedback.status}</th>
                  <th>{L.feedback.actions}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.feedbackId}>
                    <td className="a4-mono">{item.eventId}</td>
                    <td>
                      {item.confirmedNg}
                      {item.isNewCode ? `（${L.feedback.newCode}）` : ""}
                    </td>
                    <td>{item.actualCause ?? ""}</td>
                    <td>
                      {item.submittedBy}（{item.submittedRole}）
                    </td>
                    <td>
                      {item.status === "pending" ? L.states.pending : stateLabel(L, item.status)}
                      {item.status === "approved" ? `；${item.published ? L.feedback.published : L.feedback.notPublished}` : ""}
                    </td>
                    <td>
                      {item.status === "pending" ? (
                        <div className="a4-actions">
                          <button type="button" className="a4-btn a4-btn-primary" disabled={busy} onClick={() => void decide(item.feedbackId, true)}>
                            {L.feedback.approve}
                          </button>
                          <button type="button" className="a4-btn a4-btn-danger" disabled={busy} onClick={() => void decide(item.feedbackId, false)}>
                            {L.feedback.reject}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="a4-muted">{L.feedback.noFeedback}</p>
        )}
      </Section>

      <Section title={L.feedback.publishTitle} hint={L.feedback.publishHint}>
        <button type="button" className="a4-btn a4-btn-primary" disabled={busy} onClick={() => void publish()}>
          {L.feedback.publish}
        </button>
        {versions.length ? (
          <div className="a4-table-wrap">
            <table className="a4-table">
              <caption className="a4-caption">{L.feedback.published2}</caption>
              <thead>
                <tr>
                  <th>{L.feedback.version}</th>
                  <th>{L.prepare.createdAt}</th>
                  <th>{L.feedback.records}</th>
                  <th>{L.feedback.errorsCount}</th>
                  <th>{L.feedback.added}</th>
                  <th>{L.feedback.replaced}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {versions.map((version, index) => (
                  <tr key={version.version}>
                    <td>v{version.version}</td>
                    <td>{formatTime(version.createdAt)}</td>
                    <td>{version.recordCount}</td>
                    <td>{version.errorRecordCount}</td>
                    <td>{version.addedFeedbackIds.length}</td>
                    <td>{version.replacedEventIds.length}</td>
                    <td>
                      {index === 0 ? null : restoring === version.version ? (
                        <button type="button" className="a4-btn a4-btn-danger" disabled={busy} onClick={() => void restore(version.version)}>
                          {L.feedback.restoreSure} v{version.version}
                        </button>
                      ) : (
                        <button type="button" className="a4-btn" disabled={busy} onClick={() => setRestoring(version.version)}>
                          {L.feedback.restore}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="a4-muted">{L.feedback.restoreHint}</p>
          </div>
        ) : (
          <p className="a4-muted">{L.feedback.noVersions}</p>
        )}
      </Section>
    </div>
  );
}
