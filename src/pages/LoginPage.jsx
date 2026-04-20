import React, { useState, useEffect } from 'react'
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
  const [time,     setTime]     = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Username and password are required.'); return }
    setError('')
    setLoading(true)
    const result = await login(username.trim(), password)
    setLoading(false)
    if (result.ok) {
      navigate('/home', { replace: true })
    } else {
      setError(result.error || 'Authentication failed. Verify credentials and try again.')
    }
  }

  const timeStr = time.toLocaleTimeString('en-IN', { hour12: false })
  const dateStr = time.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Serif:wght@400;600&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .lp-root {
          --lp-blue-deep: #152b52;
          --lp-blue: #1b3865;
          --lp-accent: #ea6b1a;
          --lp-bg: #ffffff;
          --lp-surface: #f3f7ff;
          --lp-border: #d3deee;
          --lp-text: #152b52;
          --lp-text-soft: #405777;
          --lp-muted: #6d7f99;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          background: var(--lp-bg);
          font-family: 'IBM Plex Sans', sans-serif;
          color: var(--lp-text);
          position: relative;
          overflow: hidden;
        }

        /* ── Grid texture ── */
        .lp-root::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            linear-gradient(rgba(21,43,82,0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(21,43,82,0.045) 1px, transparent 1px);
          background-size: 40px 40px;
          pointer-events: none;
          z-index: 0;
        }

        /* ── Accent glow ── */
        .lp-root::after {
          content: '';
          position: absolute;
          width: 600px; height: 600px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(27,56,101,0.14) 0%, rgba(234,107,26,0.07) 35%, transparent 72%);
          top: -220px; left: -180px;
          pointer-events: none;
          z-index: 0;
        }

        /* ── Top classified bar ── */
        .lp-classified {
          position: relative;
          z-index: 10;
          background: linear-gradient(90deg, var(--lp-blue), var(--lp-blue-deep));
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          height: 26px;
          gap: 10px;
        }
        .lp-classified-text {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.18em;
          color: #fff;
          text-transform: uppercase;
        }
        .lp-classified-sep {
          width: 4px; height: 4px;
          background: rgba(234,107,26,0.7);
          border-radius: 50%;
        }

        /* ── Top nav strip ── */
        .lp-topnav {
          position: relative;
          z-index: 10;
          display: flex;
          align-items: center;
          padding: 0 28px;
          height: 48px;
          border-bottom: 1px solid rgba(21,43,82,0.12);
          background: rgba(255,255,255,0.88);
          backdrop-filter: blur(8px);
          gap: 16px;
        }
        .lp-topnav-logo {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .lp-topnav-emblem {
          width: 28px; height: 28px;
          background: var(--lp-blue);
          border-radius: 2px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 10px;
          font-family: 'IBM Plex Mono', monospace;
          letter-spacing: -0.02em;
          color: #fff;
          flex-shrink: 0;
        }
        .lp-topnav-org {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.1em;
          color: rgba(21,43,82,0.72);
          text-transform: uppercase;
          white-space: nowrap;
        }
        .lp-topnav-sep {
          width: 1px; height: 20px;
          background: rgba(21,43,82,0.16);
          margin: 0 4px;
        }
        .lp-topnav-right {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .lp-topnav-clock {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: rgba(21,43,82,0.56);
          letter-spacing: 0.06em;
        }
        .lp-topnav-status {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          color: rgba(21,43,82,0.58);
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .lp-topnav-status-dot {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: #22c55e;
          box-shadow: 0 0 6px rgba(34,197,94,0.8);
          animation: pulse-dot 2s ease infinite;
        }
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* ── Main layout ── */
        .lp-main {
          position: relative;
          z-index: 5;
          flex: 1;
          display: flex;
          align-items: stretch;
          min-height: 0;
        }

        /* ── Left panel ── */
        .lp-left {
          display: flex;
          flex-direction: column;
          justify-content: center;
          width: 420px;
          flex-shrink: 0;
          padding: 48px 44px;
          border-right: 1px solid var(--lp-border);
          background: linear-gradient(180deg, #f8fbff 0%, var(--lp-surface) 100%);
          position: relative;
          overflow: hidden;
        }

        /* Geometric steel accent lines */
        .lp-left::before {
          content: '';
          position: absolute;
          bottom: 0; left: 0; right: 0;
          height: 3px;
          background: linear-gradient(90deg, var(--lp-blue), var(--lp-accent) 62%, transparent);
        }
        .lp-left::after {
          content: '';
          position: absolute;
          top: 0; bottom: 0; right: 0;
          width: 1px;
          background: linear-gradient(180deg, transparent, rgba(27,56,101,0.3), transparent);
        }

        .lp-left-top {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          margin-bottom: 40px;
        }
        .lp-coat {
          width: 52px; height: 52px;
          background: linear-gradient(135deg, #1b3865, #152b52);
          border: 1px solid rgba(21,43,82,0.55);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          position: relative;
          overflow: hidden;
        }
        .lp-coat::before {
          content: '';
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            45deg,
            transparent,
            transparent 4px,
            rgba(255,255,255,0.07) 4px,
            rgba(255,255,255,0.07) 5px
          );
        }
        .lp-coat-inner {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          position: relative;
          z-index: 1;
        }
        .lp-coat-bars {
          display: flex;
          flex-direction: column;
          gap: 2.5px;
        }
        .lp-coat-bar {
          width: 22px;
          height: 3px;
          border-radius: 1px;
        }
        .lp-coat-bar:nth-child(1) { background: rgba(255,255,255,0.9); }
        .lp-coat-bar:nth-child(2) { background: rgba(255,255,255,0.65); }
        .lp-coat-bar:nth-child(3) { background: rgba(255,255,255,0.4); }

        .lp-left-org {
          padding-top: 2px;
        }
        .lp-org-line1 {
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.16em;
          color: rgba(21,43,82,0.58);
          text-transform: uppercase;
          margin-bottom: 4px;
        }
        .lp-org-line2 {
          font-family: 'IBM Plex Serif', serif;
          font-size: 15px;
          font-weight: 600;
          color: var(--lp-blue-deep);
          line-height: 1.25;
          letter-spacing: -0.01em;
          margin-bottom: 3px;
        }
        .lp-org-line3 {
          font-size: 10px;
          font-weight: 500;
          color: var(--lp-muted);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .lp-divider-h {
          width: 100%;
          height: 1px;
          background: linear-gradient(90deg, rgba(21,43,82,0.24), transparent);
          margin-bottom: 36px;
        }

        .lp-system-block {
          margin-bottom: 0;
        }
        .lp-system-label {
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.2em;
          color: var(--lp-accent);
          text-transform: uppercase;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .lp-system-label::after {
          content: '';
          flex: 1;
          height: 1px;
          background: rgba(234,107,26,0.3);
        }
        .lp-system-name {
          font-size: 24px;
          font-weight: 700;
          color: var(--lp-blue-deep);
          letter-spacing: -0.02em;
          line-height: 1.2;
          margin-bottom: 8px;
        }
        .lp-system-desc {
          font-size: 12px;
          color: var(--lp-text-soft);
          line-height: 1.6;
          letter-spacing: 0.01em;
        }

        /* ── Right panel (form) ── */
        .lp-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 60px;
          background: #fff;
        }

        .lp-form-wrap {
          width: 100%;
          max-width: 380px;
        }

        .lp-form-header {
          margin-bottom: 32px;
        }
        .lp-form-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          background: rgba(27,56,101,0.1);
          border: 1px solid rgba(27,56,101,0.25);
          border-radius: 2px;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.16em;
          color: var(--lp-blue);
          text-transform: uppercase;
          margin-bottom: 14px;
        }
        .lp-form-tag-dot {
          width: 4px; height: 4px;
          border-radius: 50%;
          background: var(--lp-blue);
        }
        .lp-form-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--lp-blue-deep);
          letter-spacing: -0.02em;
          margin-bottom: 6px;
        }
        .lp-form-sub {
          font-size: 12px;
          color: var(--lp-text-soft);
          letter-spacing: 0.01em;
          line-height: 1.5;
        }

        /* ── Error ── */
        .lp-error {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 14px;
          background: rgba(185,28,28,0.08);
          border: 1px solid rgba(185,28,28,0.24);
          border-left: 3px solid #dc2626;
          border-radius: 3px;
          font-size: 12.5px;
          color: #991b1b;
          margin-bottom: 22px;
          line-height: 1.5;
        }
        .lp-error svg { flex-shrink: 0; margin-top: 1px; }

        /* ── Field ── */
        .lp-field {
          margin-bottom: 20px;
        }
        .lp-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.14em;
          color: rgba(21,43,82,0.7);
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .lp-label-req {
          width: 4px; height: 4px;
          border-radius: 50%;
          background: #ea6b1a;
          flex-shrink: 0;
        }
        .lp-input-wrap {
          position: relative;
        }
        .lp-input {
          width: 100%;
          height: 44px;
          padding: 0 14px;
          background: #ffffff;
          border: 1px solid #c3d1e6;
          border-radius: 3px;
          color: var(--lp-blue-deep);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 13.5px;
          font-weight: 500;
          letter-spacing: 0.02em;
          outline: none;
          transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
          appearance: none;
          -webkit-appearance: none;
        }
        .lp-input::placeholder {
          color: rgba(21,43,82,0.42);
          font-weight: 400;
          letter-spacing: 0;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 12.5px;
        }
        .lp-input:focus {
          border-color: rgba(27,56,101,0.65);
          background: #f9fbff;
          box-shadow: 0 0 0 3px rgba(27,56,101,0.12);
        }
        .lp-input:disabled {
          opacity: 0.7;
          background: #f1f5fb;
          cursor: not-allowed;
        }
        .lp-input-pwd { padding-right: 44px; }

        .lp-eye-btn {
          position: absolute;
          right: 0; top: 0; bottom: 0;
          width: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: none;
          border: none;
          color: rgba(21,43,82,0.45);
          cursor: pointer;
          transition: color 0.15s;
        }
        .lp-eye-btn:hover { color: var(--lp-blue); }

        /* ── Submit ── */
        .lp-submit {
          width: 100%;
          height: 46px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          background: var(--lp-blue);
          border: none;
          border-radius: 3px;
          color: #fff;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          cursor: pointer;
          transition: background 0.15s, box-shadow 0.15s;
          margin-top: 28px;
          position: relative;
          overflow: hidden;
        }
        .lp-submit::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 100%);
          pointer-events: none;
        }
        .lp-submit:hover:not(:disabled) {
          background: var(--lp-blue-deep);
          box-shadow: 0 4px 20px rgba(21,43,82,0.34);
        }
        .lp-submit:active:not(:disabled) { background: #102441; }
        .lp-submit:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── Spinner ── */
        .lp-spinner {
          width: 14px; height: 14px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
          flex-shrink: 0;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* ── Footer ── */
        .lp-form-footer {
          margin-top: 32px;
          padding-top: 20px;
          border-top: 1px solid rgba(21,43,82,0.12);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .lp-footer-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 10px;
          color: rgba(21,43,82,0.58);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .lp-footer-row svg { flex-shrink: 0; opacity: 0.55; }

        /* ── Bottom bar ── */
        .lp-bottom {
          position: relative;
          z-index: 10;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 28px;
          height: 32px;
          border-top: 1px solid rgba(21,43,82,0.12);
          background: rgba(243,247,255,0.9);
        }
        .lp-bottom-text {
          font-size: 9.5px;
          font-family: 'IBM Plex Mono', monospace;
          color: rgba(21,43,82,0.56);
          letter-spacing: 0.08em;
        }

        /* ── Responsive ── */
        @media (max-width: 768px) {
          .lp-left { display: none; }
          .lp-right { padding: 24px 20px; }
          .lp-form-wrap { max-width: 100%; }
        }
        @media (max-width: 480px) {
          .lp-classified { display: none; }
          .lp-topnav { padding: 0 16px; }
          .lp-topnav-status { display: none; }
        }

        /* ── Tab layout: stack left panel above ── */
        @media (min-width: 769px) and (max-width: 1024px) {
          .lp-main { flex-direction: column; }
          .lp-left {
            width: 100%;
            flex-direction: row;
            padding: 20px 32px;
            border-right: none;
            border-bottom: 1px solid var(--lp-border);
            gap: 24px;
            align-items: center;
          }
          .lp-left::before { display: none; }
          .lp-left::after { display: none; }
          .lp-left-top { margin-bottom: 0; flex-shrink: 0; }
          .lp-system-block { margin-bottom: 0; }
          .lp-divider-h { display: none; }
          .lp-right { padding: 36px 40px; }
        }
      `}</style>

      <div className="lp-root">
        {/* Classified strip */}
        <div className="lp-classified">
          <span className="lp-classified-text">Steel Authority of India Limited</span>
          <span className="lp-classified-sep" />
          <span className="lp-classified-text">Internal Use Only</span>
          <span className="lp-classified-sep" />
          <span className="lp-classified-text">Restricted Access</span>
        </div>

        {/* Top nav */}
        <div className="lp-topnav">
          <div className="lp-topnav-logo">
            <div className="lp-topnav-emblem">SAIL</div>
            <div className="lp-topnav-sep" />
            <span className="lp-topnav-org">Bhilai Steel Plant — Plate Mill Division</span>
          </div>
          <div className="lp-topnav-right">
            <div className="lp-topnav-clock">{dateStr}&nbsp;&nbsp;{timeStr}</div>
            <div className="lp-topnav-status">
              <span className="lp-topnav-status-dot" />
              System Online
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="lp-main">

          {/* Left brand panel */}
          <div className="lp-left">
            <div className="lp-left-top">
              <div className="lp-coat">
                <div className="lp-coat-inner">
                  <div className="lp-coat-bars">
                    <div className="lp-coat-bar" />
                    <div className="lp-coat-bar" />
                    <div className="lp-coat-bar" />
                  </div>
                </div>
              </div>
              <div className="lp-left-org">
                <div className="lp-org-line1">Steel Authority<br />of India Ltd.</div>
                <div className="lp-org-line2">BHILAI STEEL PLANT</div>
              </div>
            </div>

            <div className="lp-divider-h" />

            <div className="lp-system-block">
              <div className="lp-system-label">Application</div>
              <div className="lp-system-name">Plate Mill<br />Loading System</div>
              <div className="lp-system-desc">
                Integrated management system for rail dispatch operations. Tracks rake generation, wagon assignment, and plate loading workflows.
              </div>
            </div>

          </div>

          {/* Right form panel */}
          <div className="lp-right">
            <div className="lp-form-wrap">

              <div className="lp-form-header">
                <div className="lp-form-tag">
                  <span className="lp-form-tag-dot" />
                  Operator Authentication
                </div>
                <div className="lp-form-title">Sign In</div>
                <div className="lp-form-sub">
                  Enter your assigned credentials to access the loading operations console.
                </div>
              </div>

              {error && (
                <div className="lp-error">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div className="lp-field">
                  <label className="lp-label" htmlFor="lp-username">
                    <span className="lp-label-req" />
                    User ID
                  </label>
                  <div className="lp-input-wrap">
                    <input
                      id="lp-username"
                      className="lp-input"
                      type="text"
                      autoComplete="username"
                      placeholder="Enter your user ID"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      disabled={loading}
                      autoFocus
                    />
                  </div>
                </div>

                <div className="lp-field" style={{ marginBottom: 0 }}>
                  <label className="lp-label" htmlFor="lp-password">
                    <span className="lp-label-req" />
                    Password
                  </label>
                  <div className="lp-input-wrap">
                    <input
                      id="lp-password"
                      className="lp-input lp-input-pwd"
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="lp-eye-btn"
                      onClick={() => setShowPwd(v => !v)}
                      tabIndex={-1}
                    >
                      {showPwd ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
                          <line x1="1" y1="1" x2="23" y2="23"/>
                        </svg>
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                          <circle cx="12" cy="12" r="3"/>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="lp-submit"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="lp-spinner" />
                      Authenticating…
                    </>
                  ) : (
                    <>
                      Authenticate &amp; Access
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                        <polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </>
                  )}
                </button>
              </form>

              <div className="lp-form-footer">
                <div className="lp-footer-row">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  Contact your system administrator for credential issues
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="lp-bottom">
          <span className="lp-bottom-text">© 2026 Steel Authority of India Limited — All Rights Reserved</span>
          <span className="lp-bottom-text">MES · Plate Mill Loading System</span>
        </div>
      </div>
    </>
  )
}
