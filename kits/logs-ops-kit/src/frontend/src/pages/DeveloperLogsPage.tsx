import { useCallback, useEffect, useRef, useState } from 'react'
import { getApiKeyHeaderName, getApiKeyValue } from '../services/auth'

function apiHeaders(): HeadersInit {
  const apiKey = getApiKeyValue()
  return apiKey ? { [getApiKeyHeaderName()]: apiKey } : {}
}

type LogType = 'user_action' | 'system_error' | 'system_warning' | 'system' | ''
type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | ''

interface LogEntry {
  id: string
  timestamp: string
  log_type: string
  level: string
  action: string
  state: string
  describe: string
  metadata: Record<string, unknown>
}

interface LogsResponse {
  total: number
  offset: number
  limit: number
  items: LogEntry[]
}

const PAGE_SIZE = 50

const LEVEL_COLOR: Record<string, string> = {
  INFO: '#1a7f3c',
  WARNING: '#b45309',
  ERROR: '#dc2626',
  CRITICAL: '#7c3aed',
}

const TYPE_LABEL: Record<string, string> = {
  user_action: '使用者操作', system_error: '系統錯誤', system_warning: '系統警告', system: '系統',
}

const LEVEL_LABEL: Record<string, string> = {
  INFO: '資訊', WARNING: '警告', ERROR: '錯誤', CRITICAL: '嚴重',
}

const TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  user_action:     { bg: '#dbeafe', text: '#1e40af' },
  system_error:    { bg: '#fee2e2', text: '#991b1b' },
  system_warning:  { bg: '#fef3c7', text: '#92400e' },
  system:          { bg: '#f3f4f6', text: '#374151' },
}

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

export function DeveloperLogsPage() {
  const [items, setItems] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [filterType, setFilterType] = useState<LogType>('')
  const [filterLevel, setFilterLevel] = useState<LogLevel>('')
  const [filterAction, setFilterAction] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (pageOffset = 0) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('offset', String(pageOffset))
      if (filterType)   params.set('log_type', filterType)
      if (filterLevel)  params.set('level', filterLevel)
      if (filterAction) params.set('action', filterAction)

      const res = await fetch(`/api/logs/?${params}`, { headers: apiHeaders() })
      if (res.status === 401) throw new Error('登入已逾時，請重新登入。')
      if (res.status === 403) throw new Error('您的角色沒有查看日誌的權限，請洽管理者。')
      if (!res.ok) throw new Error(`讀取日誌失敗（${res.status}）`)
      const data: LogsResponse = await res.json()
      setItems(data.items)
      setTotal(data.total)
      setOffset(pageOffset)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [filterType, filterLevel, filterAction])

  useEffect(() => {
    load(0)
  }, [load])

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (autoRefresh) {
      timerRef.current = setInterval(() => load(offset), 10_000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [autoRefresh, load, offset])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'sans-serif', maxWidth: 1100 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>系統日誌</h2>
        <span style={{ color: '#6b7280', fontSize: 13 }}>
          共 {total} 筆
        </span>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          每 10 秒自動更新
        </label>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as LogType)}
          style={selectStyle}
        >
          <option value="">全部類型</option>
          <option value="user_action">{TYPE_LABEL.user_action}</option>
          <option value="system_error">{TYPE_LABEL.system_error}</option>
          <option value="system_warning">{TYPE_LABEL.system_warning}</option>
          <option value="system">{TYPE_LABEL.system}</option>
        </select>

        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value as LogLevel)}
          style={selectStyle}
        >
          <option value="">全部層級</option>
          <option value="INFO">{LEVEL_LABEL.INFO}</option>
          <option value="WARNING">{LEVEL_LABEL.WARNING}</option>
          <option value="ERROR">{LEVEL_LABEL.ERROR}</option>
          <option value="CRITICAL">{LEVEL_LABEL.CRITICAL}</option>
        </select>

        <input
          placeholder="依動作關鍵字篩選…"
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          style={{ ...selectStyle, width: 180 }}
        />

        <button onClick={() => load(0)} style={btnStyle} disabled={loading}>
          {loading ? '載入中…' : '搜尋'}
        </button>
        <button
          onClick={() => { setFilterType(''); setFilterLevel(''); setFilterAction('') }}
          style={{ ...btnStyle, background: '#f3f4f6', color: '#374151' }}
        >
          清除
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
              {['時間', '類型', '層級', '動作', '狀態', '說明'].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '24px 0', color: '#9ca3af' }}>
                  沒有符合的日誌
                </td>
              </tr>
            )}
            {items.map(row => (
              <tr
                key={row.id}
                style={{ borderBottom: '1px solid #f3f4f6' }}
                title={Object.keys(row.metadata).length ? JSON.stringify(row.metadata, null, 2) : undefined}
              >
                <td style={tdStyle}>{fmt(row.timestamp)}</td>
                <td style={tdStyle}>
                  <span style={{
                    background: TYPE_BADGE[row.log_type]?.bg ?? '#f3f4f6',
                    color: TYPE_BADGE[row.log_type]?.text ?? '#374151',
                    padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap',
                  }}>
                    {TYPE_LABEL[row.log_type] ?? row.log_type}
                  </span>
                </td>
                <td style={tdStyle}>
                  <span style={{ color: LEVEL_COLOR[row.level] ?? '#374151', fontWeight: 600 }}>
                    {LEVEL_LABEL[row.level] ?? row.level}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{row.action}</td>
                <td style={tdStyle}>{row.state}</td>
                <td style={{ ...tdStyle, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.describe}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', fontSize: 13 }}>
          <button
            onClick={() => load(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            style={btnStyle}
          >
            ‹ 上一頁
          </button>
          <span style={{ color: '#6b7280' }}>
            第 {currentPage} / {totalPages} 頁
          </span>
          <button
            onClick={() => load(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || loading}
            style={btnStyle}
          >
            下一頁 ›
          </button>
        </div>
      )}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '5px 10px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  background: '#fff',
}

const btnStyle: React.CSSProperties = {
  padding: '5px 14px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 13,
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
}

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontWeight: 600,
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
}

const tdStyle: React.CSSProperties = {
  padding: '7px 12px',
  verticalAlign: 'top',
}
