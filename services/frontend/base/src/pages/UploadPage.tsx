import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { getApiKeyHeaderName, getApiKeyValue } from '../services/auth'
import '../styles/upload-import.css'

interface FormType { code: string; name: string; schema_version: number | null }
interface Preview { total: number; valid_count: number; duplicate_count: number; errors: { row: number; errors: string[] }[]; preview_rows: Record<string, unknown>[] }
interface Result { total: number; imported: number; skipped: number; error_count: number; job_id: string | null }

const authHeaders = (): HeadersInit => {
  const value = getApiKeyValue()
  return value ? { [getApiKeyHeaderName()]: value } : {}
}

/** Reads the reason the server gave for a failed call; never shows raw HTML or a stack trace. */
async function failure(response: Response): Promise<string> {
  const body = await response.json().catch(() => null)
  return typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`
}

/** CSV import into a generic form: preview first, nothing is written until the operator commits. */
export function UploadPage() {
  const { t } = useTranslation()
  const [forms, setForms] = useState<FormType[] | null>(null)
  const [code, setCode] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/forms', { headers: authHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error(await failure(response))
        return response.json() as Promise<FormType[]>
      })
      .then((all) => { if (live) { setForms(all.filter((f) => f.schema_version !== null)); setError('') } })
      .catch((e: unknown) => { if (live) { setForms([]); setError(String(e instanceof Error ? e.message : e)) } })
    return () => { live = false }
  }, [])

  const run = async (step: 'preview' | 'commit') => {
    if (!file || !code) return
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.append('file', file)
      const response = await fetch(`/api/forms/${encodeURIComponent(code)}/import/${step}`, { method: 'POST', headers: authHeaders(), body })
      if (!response.ok) throw new Error(await failure(response))
      const data = await response.json()
      if (step === 'preview') { setPreview(data as Preview); setResult(null) } else { setResult(data as Result); setPreview(null) }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const choose = (next: { code?: string; file?: File | null }) => {
    if (next.code !== undefined) setCode(next.code)
    if (next.file !== undefined) setFile(next.file)
    setPreview(null)
    setResult(null)
    setError('')
  }

  const submit = (event: FormEvent) => { event.preventDefault(); void run('preview') }
  const columns = preview?.preview_rows[0] ? Object.keys(preview.preview_rows[0]) : []

  return (
    <section className="upload-import" aria-labelledby="upload-import-title">
      <h2 id="upload-import-title">{t('uploadImport.title')}</h2>
      <p>{t('uploadImport.intro')}</p>
      {forms !== null && forms.length === 0 && !error ? <p role="status">{t('uploadImport.noForms')}</p> : null}
      <form onSubmit={submit} className="upload-import-form">
        <label>
          {t('uploadImport.form')}
          <select value={code} onChange={(e) => choose({ code: e.target.value })} required>
            <option value="">{t('uploadImport.choose')}</option>
            {(forms ?? []).map((f) => <option key={f.code} value={f.code}>{f.name}（{f.code}）</option>)}
          </select>
        </label>
        <label>
          {t('uploadImport.file')}
          <input type="file" accept=".csv,text/csv" onChange={(e) => choose({ file: e.target.files?.[0] ?? null })} required />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || !file || !code}>{t('uploadImport.preview')}</button>
      </form>
      {error ? <p className="upload-import-error" role="alert">{error}</p> : null}

      {preview ? (
        <div className="upload-import-result" role="status">
          <p>{t('uploadImport.summary', { total: preview.total, valid: preview.valid_count, duplicate: preview.duplicate_count, errors: preview.errors.length })}</p>
          {preview.errors.length ? (
            <ul className="upload-import-errors">
              {preview.errors.slice(0, 20).map((row) => <li key={row.row}>{t('uploadImport.rowError', { row: row.row })}{row.errors.join('；')}</li>)}
            </ul>
          ) : null}
          {columns.length ? (
            <div className="upload-import-table" tabIndex={0} role="region" aria-label={t('uploadImport.sample')}>
              <table>
                <thead><tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
                <tbody>{preview.preview_rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : null}
          <button type="button" className="btn-primary" disabled={busy || preview.valid_count === 0} onClick={() => void run('commit')}>
            {t('uploadImport.commit', { count: preview.valid_count })}
          </button>
          {preview.valid_count === 0 ? <p>{t('uploadImport.nothingToImport')}</p> : null}
        </div>
      ) : null}

      {result ? (
        <p className="upload-import-result" role="status">
          {result.job_id ? t('uploadImport.queued', { id: result.job_id }) : t('uploadImport.done', { imported: result.imported, skipped: result.skipped, errors: result.error_count })}
        </p>
      ) : null}
    </section>
  )
}
