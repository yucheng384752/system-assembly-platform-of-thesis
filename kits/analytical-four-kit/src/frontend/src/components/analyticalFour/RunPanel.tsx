import { useCallback, useEffect, useState } from "react";
import { api, type Run } from "../../services/analyticalFour";
import { Notice, Section, errorText, formatTime, stateLabel } from "./Common";
import { useLabels } from "./labels";

const MAX_SHOWN = 20000;
const live = (run: Run | null) => run !== null && (run.state === "queued" || run.state === "running");

export function RunPanel() {
  const L = useLabels();
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState<Run | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [shown, setShown] = useState<{ name: string; text: string; truncated: boolean } | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const list = (await api.runs()).runs;
      setRuns(list);
      return list;
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error, L) });
      return [];
    }
  }, [L]);

  const open = useCallback(
    async (id: string) => {
      try {
        const [run, files] = await Promise.all([api.run(id), api.results(id)]);
        setSelected(run);
        setResults(files.results);
        setShown(null);
      } catch (error) {
        setMessage({ kind: "error", text: errorText(error, L) });
      }
    },
    [L],
  );

  useEffect(() => {
    void loadRuns().then((list) => {
      if (list[0]) void open(list[0].runId);
    });
  }, [loadRuns, open]);

  // While a run is live, ask for its state every two seconds; stop as soon as it has ended.
  const liveId = live(selected) ? selected!.runId : "";
  useEffect(() => {
    if (!liveId) return undefined;
    const timer = window.setInterval(() => {
      void api
        .run(liveId)
        .then(async (run) => {
          setSelected(run);
          if (!live(run)) {
            setResults((await api.results(liveId)).results);
            await loadRuns();
          }
        })
        .catch((error) => setMessage({ kind: "error", text: errorText(error, L) }));
    }, 2000);
    return () => window.clearInterval(timer);
  }, [liveId, L, loadRuns]);

  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const run = await api.createRun();
      setSelected(run);
      setResults([]);
      setShown(null);
      await loadRuns();
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error, L) });
    } finally {
      setBusy(false);
    }
  };

  const view = async (name: string) => {
    if (!selected) return;
    try {
      const text = JSON.stringify(await api.result(selected.runId, name), null, 2);
      setShown({ name, text: text.length > MAX_SHOWN ? text.slice(0, MAX_SHOWN) : text, truncated: text.length > MAX_SHOWN });
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error, L) });
    }
  };

  return (
    <div className="a4-panel">
      {message ? (
        <div className="a4-flash">
          <Notice kind={message.kind}>{message.text}</Notice>
        </div>
      ) : null}

      <Section title={L.run.startTitle} hint={L.run.startHint}>
        <button type="button" className="a4-btn a4-btn-primary" disabled={busy || live(selected)} onClick={() => void start()}>
          {busy ? L.run.starting : L.run.start}
        </button>
        {live(selected) ? <Notice kind="info">{L.run.active}</Notice> : null}
      </Section>

      {selected ? (
        <Section title={`${stateLabel(L, selected.state)}：${selected.runId}`}>
          <p className="a4-muted">
            {L.mode[selected.mode as "daily" | "complain"] ?? selected.mode}
            {(["a", "b", "c"] as const).filter((key) => selected.layers[key]).map((key) => L.layers[key]).join("、")}　{L.run.started}：{formatTime(selected.startedAt)}　{L.run.finished}：{formatTime(selected.finishedAt)}
          </p>
          {selected.error ? (
            <Notice kind="error">
              {L.run.error}：{selected.error.message}
              {selected.error.stage ? `（${L.run.failedAt}：${selected.error.stage}）` : ""}
            </Notice>
          ) : null}
          <div className="a4-table-wrap">
            <table className="a4-table">
              <caption className="a4-caption">{L.run.stages}</caption>
              <thead>
                <tr>
                  <th>{L.run.stage}</th>
                  <th>{L.run.state}</th>
                  <th>{L.run.detail}</th>
                </tr>
              </thead>
              <tbody>
                {selected.stages.map((stage) => (
                  <tr key={stage.id}>
                    <td>{stage.name}</td>
                    <td>{stateLabel(L, stage.state)}</td>
                    <td>{stage.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected.warnings?.length ? (
            <div className="a4-findings a4-findings-warning">
              <h4 className="a4-h4">
                {L.run.warnings}（{selected.warnings.length}）
              </h4>
              <ul>
                {selected.warnings.map((item, index) => (
                  <li key={index}>
                    <span className="a4-code">{item.code}</span> {item.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      ) : null}

      {selected ? (
        <Section title={L.run.resultsTitle} hint={L.run.resultsHint}>
          {results.length ? (
            <ul className="a4-list a4-results">
              {results.map((name) => (
                <li key={name} className="a4-row">
                  <span className="a4-mono">{name}</span>
                  <button type="button" className="a4-btn" onClick={() => void view(name)} aria-label={`${L.run.viewResult} ${name}`}>
                    {L.run.viewResult}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="a4-muted">{L.run.noResults}</p>
          )}
          {shown ? (
            <div className="a4-card">
              <h4 className="a4-h4">
                {L.run.resultOf}：{shown.name}
              </h4>
              {shown.truncated ? <Notice kind="info">{L.run.truncated}</Notice> : null}
              <pre className="a4-pre" tabIndex={0}>
                {shown.text}
              </pre>
              <button type="button" className="a4-btn" onClick={() => setShown(null)}>
                {L.common.close}
              </button>
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section title={L.run.history}>
        {runs.length ? (
          <div className="a4-table-wrap">
            <table className="a4-table">
              <thead>
                <tr>
                  <th>{L.run.started}</th>
                  <th>{L.run.state}</th>
                  <th>ID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId}>
                    <td>{formatTime(run.startedAt ?? run.createdAt)}</td>
                    <td>{stateLabel(L, run.state)}</td>
                    <td className="a4-mono">{run.runId}</td>
                    <td>
                      <button type="button" className="a4-btn" onClick={() => void open(run.runId)}>
                        {L.run.open}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="a4-muted">{L.run.noRuns}</p>
        )}
      </Section>
    </div>
  );
}
