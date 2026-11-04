import { useCallback, useEffect, useState } from "react";
import { api, downloadTemplate, type Report, type TemplateInfo, type Upload } from "../../services/analyticalFour";
import { Notice, ReportView, Section, errorText, formatBytes, formatTime, stateLabel } from "./Common";
import { useLabels } from "./labels";

const KINDS = ["current-data", "baseline-data", "ng-code", "topology", "knowledge", "case-records", "case-errors", "analysis-config"];

export function PreparePanel() {
  const L = useLabels();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [kind, setKind] = useState(KINDS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [current, setCurrent] = useState<Upload | null>(null);
  const [replace, setReplace] = useState(false);
  const [check, setCheck] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [t, u] = await Promise.all([api.templates(), api.uploads()]);
      setTemplates(t.templates);
      setUploads(u.uploads);
      setLoadError("");
    } catch (error) {
      setLoadError(errorText(error, L));
    }
  }, [L]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      setMessage({ kind: "error", text: errorText(error, L) });
    } finally {
      setBusy("");
    }
  };

  const upload = () =>
    run("upload", async () => {
      if (!file) {
        setMessage({ kind: "error", text: L.prepare.needChoose });
        return;
      }
      const made = await api.createUpload(kind, file);
      setCurrent(made);
      setReplace(false);
      await refresh();
    });

  const open = (id: string) =>
    run("open", async () => {
      setCurrent(await api.upload(id));
      setReplace(false);
    });

  const accept = () =>
    run("accept", async () => {
      if (!current) return;
      const done = await api.acceptUpload(current.uploadId, replace);
      setCurrent(done);
      setMessage({ kind: "ok", text: `${L.prepare.accepted}：${done.target ?? ""}${done.replacedBackup ? `；${L.prepare.backup} ${done.replacedBackup}` : ""}` });
      await refresh();
    });

  const discard = () =>
    run("discard", async () => {
      if (!current) return;
      setCurrent(await api.discardUpload(current.uploadId));
      setMessage({ kind: "info", text: L.prepare.discarded });
      await refresh();
    });

  const loadDemo = () =>
    run("demo", async () => {
      const done = await api.loadDemo();
      setMessage({ kind: "ok", text: done.copied.length ? `${L.prepare.demoDone}：${done.copied.length}` : L.prepare.demoNone });
    });

  const checkData = () =>
    run("check", async () => {
      setCheck(await api.dataCheck());
    });

  const download = (name: string) => run("download", () => downloadTemplate(name));

  return (
    <div className="a4-panel">
      {loadError ? <Notice kind="error">{loadError}</Notice> : null}
      {message ? (
        <div className="a4-flash">
          <Notice kind={message.kind}>{message.text}</Notice>
        </div>
      ) : null}

      <Section title={L.prepare.templatesTitle} hint={L.prepare.templatesHint}>
        <ul className="a4-list">
          {templates.map((item) => (
            <li key={item.name} className="a4-row">
              <div>
                <strong>{item.name}</strong>
                <div className="a4-muted">{item.description}</div>
              </div>
              <button type="button" className="a4-btn" disabled={busy !== ""} onClick={() => void download(item.name)}>
                {L.prepare.download}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={L.prepare.uploadTitle} hint={L.prepare.uploadHint}>
        <div className="a4-form">
          <label className="a4-field">
            <span>{L.prepare.kind}</span>
            <select className="a4-input" value={kind} onChange={(event) => setKind(event.target.value)}>
              {KINDS.map((item) => (
                <option key={item} value={item}>
                  {L.kinds[item]}
                </option>
              ))}
            </select>
          </label>
          <div className="a4-field">
            <span>{L.prepare.file}</span>
            <label className="a4-file">
              <input type="file" className="a4-file-input" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              <span className="a4-btn">{L.prepare.file}</span>
            </label>
            <span className="a4-muted" role="status">
              {file ? `${L.prepare.chosen}：${file.name}（${formatBytes(file.size)}）` : L.prepare.notChosen}
            </span>
          </div>
          <div>
            <button type="button" className="a4-btn a4-btn-primary" disabled={busy !== ""} onClick={() => void upload()}>
              {busy === "upload" ? L.prepare.uploading : L.prepare.upload}
            </button>
          </div>
        </div>

        {current ? (
          <div className="a4-card" aria-label={L.prepare.report}>
            <h4 className="a4-h4">
              {L.prepare.report}：{L.kinds[current.kind] ?? current.kind}（{current.filename || "-"}，{formatBytes(current.bytes)}）
            </h4>
            <p className="a4-muted">
              {L.prepare.status}：{stateLabel(L, current.status)}
              {current.target ? `　${L.prepare.target}：${current.target}` : ""}
            </p>
            {current.report ? <ReportView report={current.report} L={L} /> : null}
            {current.status === "staged" ? (
              <div className="a4-actions">
                <label className="a4-check">
                  <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
                  <span>{L.prepare.replace}</span>
                </label>
                <button type="button" className="a4-btn a4-btn-primary" disabled={busy !== "" || current.report?.ok === false} onClick={() => void accept()}>
                  {L.prepare.accept}
                </button>
                <button type="button" className="a4-btn a4-btn-danger" disabled={busy !== ""} onClick={() => void discard()}>
                  {L.prepare.discard}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <h4 className="a4-h4">{L.prepare.list}</h4>
        {uploads.length ? (
          <div className="a4-table-wrap">
            <table className="a4-table">
              <thead>
                <tr>
                  <th>{L.prepare.kind}</th>
                  <th>{L.prepare.createdAt}</th>
                  <th>{L.prepare.bytes}</th>
                  <th>{L.prepare.status}</th>
                  <th>{L.common.errors}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {uploads.map((item) => (
                  <tr key={item.uploadId}>
                    <td>{L.kinds[item.kind] ?? item.kind}</td>
                    <td>{formatTime(item.createdAt)}</td>
                    <td>{formatBytes(item.bytes)}</td>
                    <td>{stateLabel(L, item.status)}</td>
                    <td>{item.errorCount ?? 0}</td>
                    <td>
                      <button type="button" className="a4-btn" disabled={busy !== ""} onClick={() => void open(item.uploadId)}>
                        {L.prepare.view}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="a4-muted">{L.common.none}</p>
        )}
      </Section>

      <Section title={L.prepare.checkTitle} hint={L.prepare.checkHint}>
        <button type="button" className="a4-btn a4-btn-primary" disabled={busy !== ""} onClick={() => void checkData()}>
          {L.prepare.check}
        </button>
        {check ? (
          <div className="a4-card">
            <Notice kind={check.ok ? "ok" : "error"}>{check.ok ? L.prepare.checkPassed : L.prepare.checkFailed}</Notice>
            <ReportView report={check} L={L} />
          </div>
        ) : null}
      </Section>

      <Section title={L.prepare.demoTitle} hint={L.prepare.demoHint}>
        <button type="button" className="a4-btn" disabled={busy !== ""} onClick={() => void loadDemo()}>
          {L.prepare.demo}
        </button>
      </Section>
    </div>
  );
}
