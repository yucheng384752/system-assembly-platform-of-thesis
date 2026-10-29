import { FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SessionUser, setSessionToken } from '../services/auth'
import '../styles/login.css'

interface Props {
  onSignedIn: (user: SessionUser) => void
}

// Sign-in plus the forced first password change; the backend refuses every other route until it is done.
export function LoginPage({ onSignedIn }: Props) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mustChange, setMustChange] = useState(false)
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function signIn(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      if (!response.ok) {
        setError(response.status === 401 ? t('login.invalid') : t('login.unavailable', { status: response.status }))
        return
      }
      const body = await response.json()
      setSessionToken(body.access_token)
      if (body.must_change_password) {
        setMustChange(true)
        return
      }
      setPassword('')
      onSignedIn(body.user)
    } catch {
      setError(t('login.network'))
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (next !== confirm) {
      setError(t('login.mismatch'))
      return
    }
    setBusy(true)
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: password, new_password: next }),
      })
      if (!response.ok) {
        setError(response.status === 400 || response.status === 422 ? t('login.rejected') : t('login.unavailable', { status: response.status }))
        return
      }
      const user = await response.json()
      setPassword('')
      setNext('')
      setConfirm('')
      onSignedIn(user)
    } catch {
      setError(t('login.network'))
    } finally {
      setBusy(false)
    }
  }

  if (mustChange) {
    return (
      <form className="login-card" onSubmit={changePassword}>
        <h2>{t('login.changeTitle')}</h2>
        <p>{t('login.changeHint')}</p>
        <label>
          {t('login.current')}
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label>
          {t('login.new')}
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label>
          {t('login.confirm')}
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </label>
        {error ? <p className="login-error" role="alert">{error}</p> : null}
        <button type="submit" className="btn-primary" disabled={busy}>{t('login.changeSubmit')}</button>
      </form>
    )
  }

  return (
    <form className="login-card" onSubmit={signIn}>
      <h2>{t('login.title')}</h2>
      <label>
        {t('login.username')}
        <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label>
        {t('login.password')}
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn-primary" disabled={busy}>{t('login.submit')}</button>
    </form>
  )
}
