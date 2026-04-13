import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import LoginPage              from './pages/LoginPage.jsx'
import HomePage               from './pages/HomePage.jsx'
import RakeGenerationPage     from './pages/RakeGenerationPage.jsx'
import LoadingOperationsPage  from './pages/LoadingOperationsPage.jsx'
import LoadingReportPage   from './pages/LoadingReportPage.jsx'
import AssignWagonsPage       from './pages/AssignWagonsPage.jsx'

function RequireAuth({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ textAlign:'center' }}>
          <div className="spinner spinner-lg" style={{ margin:'0 auto 12px' }} />
          <div style={{ fontSize:13, color:'var(--text-muted)' }}>Initialising…</div>
        </div>
      </div>
    )
  }
  return user ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/home"               element={<RequireAuth><HomePage /></RequireAuth>} />
          <Route path="/rake-generation"    element={<RequireAuth><RakeGenerationPage /></RequireAuth>} />
          <Route path="/loading-operations" element={<RequireAuth><LoadingOperationsPage /></RequireAuth>} />
          <Route path="/assign-wagons"      element={<RequireAuth><AssignWagonsPage /></RequireAuth>} />
          <Route path="/loading-report"  element={<RequireAuth><LoadingReportPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}
