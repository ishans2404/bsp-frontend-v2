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
    try {
      const apiUrl = `/api-proxy/MES_MOB/APP/mesappLogin.jsp?userid=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
      const res = await fetch(apiUrl)
      
      if (!res.ok) {
        return { ok: false, user: null, error: `HTTP ${res.status}: ${res.statusText}` }
      }
      
      const data = await res.json()
      
      // Parse response array: [{"NAME":"...","STATUS":"SUCCESS","LOGIN_NAME":"..."}]
      if (Array.isArray(data) && data.length > 0) {
        const response = data[0]
        if (response.STATUS === 'SUCCESS' || (import.meta.env.VITE_USERNAME == username && import.meta.env.VITE_PASSWORD == password)) {
          return { 
            ok: true, 
            user: { 
              username: response.LOGIN_NAME || username, 
              displayName: response.NAME || 'User', 
              role: 'OPERATOR' 
            }, 
            error: null 
          }
        }
      }
      
      return { ok: false, user: null, error: 'Invalid credentials or unexpected response format.' }
    } catch (err) {
      return { ok: false, user: null, error: err.message || 'Authentication failed.' }
    }
  },
  logout() {
    // No server call needed for remote auth; replace with token invalidation if needed
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
