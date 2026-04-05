import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate  = useNavigate()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [showPwd,  setShowPwd]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Please enter both username and password.'); return }
    setError('')
    setLoading(true)
    const result = await login(username.trim(), password)
    setLoading(false)
    if (result.ok) {
      navigate('/home', { replace: true })
    } else {
      setError(result.error || 'Authentication failed.')
    }
  }

  return (
    <div className="login-page">
      {/* Top strip */}
      <header className="login-header">
        <div style={{ width: 26, height: 26, background: '#ea6b1a', borderRadius: 4, display:'flex', alignItems:'center', justifyContent:'center', fontSize: 11, fontWeight: 800, color: '#fff' }}>BSP</div>
        <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, letterSpacing: '0.06em' }}>BHILAI STEEL PLANT — PLATE MILL</span>
        <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>SAIL · INTEGRATED MANAGEMENT SYSTEM</span>
      </header>

      {/* Center card */}
      <div className="login-content">
        <div className="login-card">
          <div className="login-card-top">
            <div className="login-logo">
              <SteelIcon />
            </div>
            <div className="login-org">Steel Authority of India Ltd.</div>
            <div className="login-system">Plate Loading System</div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.04em' }}>PLATE MILL · BHILAI STEEL PLANT</div>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            {error && (
              <div className="alert alert-danger" style={{ marginBottom: 16 }}>
                <ErrorIcon />
                <span>{error}</span>
              </div>
            )}

            <div className="form-group" style={{ marginBottom: 14 }}>
              <label className="form-label" htmlFor="username">
                Username <span className="req">*</span>
              </label>
              <input
                id="username"
                className="form-control"
                type="text"
                autoComplete="username"
                placeholder="Enter username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label" htmlFor="password">
                Password <span className="req">*</span>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="password"
                  className="form-control"
                  type={showPwd ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={loading}
                  style={{ paddingRight: 36 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:4 }}
                >
                  {showPwd ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
            </div>

            <button className="btn btn-primary btn-lg" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
              {loading ? <><span className="spinner spinner-sm" /> Authenticating…</> : 'Sign In'}
            </button>
          </form>

          <div className="login-footer">
            Bhilai Steel Plant · Plate Mill Division &nbsp;|&nbsp; SAIL
          </div>
        </div>

      </div>
    </div>
  )
}

function SteelIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="5" rx="1"/>
      <rect x="2" y="10" width="20" height="5" rx="1"/>
      <rect x="2" y="17" width="20" height="5" rx="1"/>
    </svg>
  )
}
function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}
function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  )
}
function ErrorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{flexShrink:0}}>
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  )
}
