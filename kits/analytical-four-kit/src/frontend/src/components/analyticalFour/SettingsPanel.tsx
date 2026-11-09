import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Readiness, type Settings } from "../../services/analyticalFour";
import { Notice, Section, errorText } from "./Common";
import { useLabels } from "./labels";

type Row = { site: string; engine: string };

const toRows = (mapping: Record<string, string>): Row[] => Object.entries(mapping).map(([site, engine]) => ({ site, engine }));
const fromRows = (rows: Row[]): Record<string, string> => Object.fromEntries(rows.filter((row) => row.site !== "" || row.engine !== "").map((row) => [row.site, row.engine]));

export function SettingsPanel() {
  const L = useLabels();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settings, status] = await Promise.all([api.getSettings(), api.status()]);
      setSaved(settings);
      setDraft(settings);
      setRows(toRows(settings.columnMapping));
      setReadiness(status.readiness);
      setMessage(null);
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error, L) });
    }
  }, [L]);

  useEffect(() => {
    void load();
  }, [load]);

  const candidate = useMemo(() => (draft ? { ...draft, columnMapping: fromRows(rows) } : null), [draft, rows]);
  const dirty = useMemo(() => JSON.stringify(candidate) !== JSON.stringify(saved), [candidate, saved]);

  if (!draft || !candidate) {
    return <div className="a4-panel">{message ? <Notice kind="error">{message.text}</Notice> : <p className="a4-muted">{L.common.loading}</p>}</div>;
  }

  const update = (change: Partial<Settings>) => setDraft({ ...draft, ...change });
  const setLayer = (key: "a" | "b" | "c", value: boolean) => update({ layers: { ...draft.layers, [key]: value } });

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const done = await api.putSettings(candidate);
      setSaved(done.settings);
      setDraft(done.settings);
      setRows(toRows(done.settings.columnMapping));
      setReadiness(done.readiness);
      setMessage({ kind: "ok", text: L.settings.saved });
    } catch (error) {
      setMessage({ kind: "error", text: `${L.settings.saveFailed}${L.colon}${errorText(error, L)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="a4-panel">
      {message ? (
        <div className="a4-flash">
          <Notice kind={message.kind}>{message.text}</Notice>
        </div>
      ) : null}

      <Section title={L.settings.layersTitle} hint={L.settings.layersHint}>
        <div className="a4-checks">
          {(["a", "b", "c"] as const).map((key) => (
            <label key={key} className="a4-check">
              <input type="checkbox" role="switch" checked={draft.layers[key]} onChange={(event) => setLayer(key, event.target.checked)} />
              <span>{L.layers[key]}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title={L.settings.modeTitle} hint={L.settings.modeHint}>
        <div className="a4-checks" role="radiogroup" aria-label={L.settings.modeTitle}>
          {(["daily", "complain"] as const).map((mode) => (
            <label key={mode} className="a4-check">
              <input type="radio" name="a4-mode" checked={draft.mode === mode} onChange={() => update({ mode })} />
              <span>{L.mode[mode]}</span>
            </label>
          ))}
        </div>
      </Section>

      <Section title={L.settings.configTitle}>
        <label className="a4-field">
          <span>{L.settings.configLabel}</span>
          <input className="a4-input" value={draft.analysisConfig} onChange={(event) => update({ analysisConfig: event.target.value })} />
        </label>
      </Section>

      <Section title={L.settings.llmTitle} hint={L.settings.llmHint}>
        <div className="a4-form">
          <label className="a4-field">
            <span>{L.settings.endpoint}</span>
            <input className="a4-input" inputMode="url" autoComplete="off" value={draft.llm.endpoint} onChange={(event) => update({ llm: { ...draft.llm, endpoint: event.target.value } })} />
          </label>
          <label className="a4-field">
            <span>{L.settings.timeout}</span>
            <input className="a4-input" type="number" min={1} max={900} value={draft.llm.timeoutSeconds} onChange={(event) => update({ llm: { ...draft.llm, timeoutSeconds: Number(event.target.value) } })} />
          </label>
          <label className="a4-field">
            <span>{L.settings.apiKeyEnv}</span>
            <input className="a4-input" autoComplete="off" value={draft.llm.apiKeyEnv} onChange={(event) => update({ llm: { ...draft.llm, apiKeyEnv: event.target.value } })} />
          </label>
        </div>
      </Section>

      <Section title={L.settings.mappingTitle} hint={L.settings.mappingHint}>
        {rows.length ? (
          <div className="a4-table-wrap">
            <table className="a4-table">
              <thead>
                <tr>
                  <th>{L.settings.siteColumn}</th>
                  <th>{L.settings.engineColumn}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    <td>
                      <input className="a4-input" aria-label={`${L.settings.siteColumn} ${index + 1}`} value={row.site} onChange={(event) => setRows(rows.map((r, i) => (i === index ? { ...r, site: event.target.value } : r)))} />
                    </td>
                    <td>
                      <input className="a4-input" aria-label={`${L.settings.engineColumn} ${index + 1}`} value={row.engine} onChange={(event) => setRows(rows.map((r, i) => (i === index ? { ...r, engine: event.target.value } : r)))} />
                    </td>
                    <td>
                      <button type="button" className="a4-btn a4-btn-danger" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                        {L.settings.removeRow}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <button type="button" className="a4-btn" onClick={() => setRows([...rows, { site: "", engine: "" }])}>
          {L.settings.addRow}
        </button>
      </Section>

      <div className="a4-actions">
        <button type="button" className="a4-btn a4-btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
          {L.settings.save}
        </button>
        <button type="button" className="a4-btn" disabled={busy} onClick={() => void load()}>
          {L.common.retry}
        </button>
        {/* Next to the buttons, not at the top: a notice that appears above the controls pushes them down while they are being clicked. */}
        {dirty ? <span className="a4-muted" role="status">{L.settings.unsaved}</span> : <span className="a4-muted" role="status" />}
      </div>

      {readiness ? (
        <Section title={L.settings.readiness}>
          <ul className="a4-list">
            {Object.entries(readiness).map(([layer, info]) => (
              <li key={layer}>
                <strong>{L.layers[layer as "a" | "b" | "c"] ?? layer}</strong>{L.colon}{info.ready ? L.settings.ready : L.settings.notReady}
                {info.problems.length ? (
                  <ul>
                    {info.problems.map((problem, index) => (
                      <li key={index}>{problem.message}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}
