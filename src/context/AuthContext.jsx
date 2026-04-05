/**
 * AuthContext
 * Simple credential-based auth. Replace `authStrategy` to switch to JWT/API later.
 */
import React, { createContext, useContext, useState, useEffect } from 'react'

const AUTH_KEY = 'bsp_auth_user'

// ── Auth strategy ─────────────────────────────────────────────────
// To switch auth method, replace this object. Interface:
//   authenticate(username, password) → { ok: bool, user: obj | null, error: string | null }
//   logout() → void
const authStrategy = {
  async authenticate(username, password) {
    // Hardcoded for now — replace with API call:
    //   const res = await fetch('/api/auth/login', { method:'POST', body: JSON.stringify({username, password}) })
    await new Promise(r => setTimeout(r, 600)) // simulate latency
    if (username === 'admin' && password === 'admin') {
      return { ok: true, user: { username: 'admin', displayName: 'Administrator', role: 'OPERATOR' }, error: null }
    }
    return { ok: false, user: null, error: 'Invalid username or password.' }
  },
  logout() {
    // No server call needed for local auth; replace with token invalidation if needed
  }
}
// ──────────────────────────────────────────────────────────────────

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = sessionStorage.getItem(AUTH_KEY)
    if (stored) {
      try { setUser(JSON.parse(stored)) } catch { /* ignore */ }
    }
    setLoading(false)
  }, [])

  async function login(username, password) {
    const result = await authStrategy.authenticate(username, password)
    if (result.ok) {
      setUser(result.user)
      sessionStorage.setItem(AUTH_KEY, JSON.stringify(result.user))
    }
    return result
  }

  function logout() {
    authStrategy.logout()
    setUser(null)
    sessionStorage.removeItem(AUTH_KEY)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
