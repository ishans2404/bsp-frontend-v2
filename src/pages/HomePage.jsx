import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell from '../components/layout/AppShell.jsx'
import { fetchRakesList, fetchLoadingReport, fetchWagonsByRake } from '../api/index.js'
import { useToast } from '../context/ToastContext.jsx'

const STATUS_CONFIG = {
  ACTIVE:      { label: 'Active',      badge: 'badge-navy',    dot: true },
  IN_PROGRESS: { label: 'In Progress', badge: 'badge-warning', dot: true },
  COMPLETED:   { label: 'Completed',   badge: 'badge-success', dot: true },
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffH = (now - d) / 3600000
  if (diffH < 0.5)  return 'Just now'
  if (diffH < 1)    return `${Math.round(diffH * 60)}m ago`
  if (diffH < 24)   return `${Math.round(diffH)}h ago`
  return d.toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDateFull(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtDateOnly(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

export default function HomePage() {
  const navigate = useNavigate()
  const toastCtx = useToast()

  const [rakes,     setRakes]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('ALL')   // ALL | ACTIVE | IN_PROGRESS | COMPLETED
  const [search,    setSearch]    = useState('')
  const [sortCol,   setSortCol]   = useState('createdAt')
  const [sortDir,   setSortDir]   = useState('desc')
  const [activeSession, setActiveSession] = useState(null)
  const [wagonCounts, setWagonCounts] = useState({})

  useEffect(() => {
    function checkActiveSession() {
      try {
        const raw = localStorage.getItem('bsp_loading_session')
        if (!raw) { setActiveSession(null); return }
        const s = JSON.parse(raw)
        setActiveSession(s?.step === 'LOADING' ? s : null)
      } catch { setActiveSession(null) }
    }
    checkActiveSession()
    window.addEventListener('focus', checkActiveSession)
    return () => window.removeEventListener('focus', checkActiveSession)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchRakesList()
      setRakes(data)
      setLoading(false)
      
      // Fetch wagon counts in parallel without blocking
      Promise.all(
        data.map(async (rake) => {
          try {
            const wagons = await fetchWagonsByRake(rake.rakeId)
            // Count unique wagon numbers (DISPATCH_NM)
            const uniqueWagons = new Set()
            for (const w of wagons) {
              const wagonNo = String(w.DISPATCH_NM || '').trim()
              if (wagonNo) uniqueWagons.add(wagonNo)
            }
            return { rakeId: rake.rakeId, count: uniqueWagons.size }
          } catch {
            return null
          }
        })
      ).then((results) => {
        const counts = {}
        results.forEach((result) => {
          if (result) counts[result.rakeId] = result.count
        })
        setWagonCounts(counts)
      })
    } catch {
      toastCtx.error('Failed to load rakes.')
      setLoading(false)
    }
  }, [toastCtx])

  useEffect(() => { load() }, [load])

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function handleStartLoading(rake) {
    // Pre-warm the loading report cache for all destinations before the user
    // reaches LoadingOperationsPage; fetchLoadingReport deduplicates in-flight calls.
    if (Array.isArray(rake.destinations)) {
      rake.destinations.forEach(d => fetchLoadingReport(d.code).catch(() => {}))
    }

    navigate('/assign-wagons', {
      state: {
        prefillRakeId:    String(rake.rakeId),
        prefillDest:      rake.destinations?.[0] ?? null,
        prefillRakeInfo:  {
          rakeId:      String(rake.rakeId),
          status:      rake.status,
          destinations: rake.destinations,
          totalWagons: rake.totalWagons,
          createdAt:   rake.createdAt,
        },
      }
    })
  }



  // Derived
  const filtered = rakes
    .filter(r => {
      if (filter !== 'ALL' && r.status !== filter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        String(r.rakeId).toLowerCase().includes(q) ||
        r.destinations?.some(d => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q)) ||
        (r.createdBy || '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol]
      if (sortCol === 'createdAt' || sortCol === 'completedAt') {
        va = va ? new Date(va).getTime() : 0
        vb = vb ? new Date(vb).getTime() : 0
      }
      if (va == null) va = ''
      if (vb == null) vb = ''
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })

  const stats = {
    total:       rakes.length,
    active:      rakes.filter(r => r.status === 'ACTIVE').length,
    inProgress:  rakes.filter(r => r.status === 'IN_PROGRESS').length,
    completed:   rakes.filter(r => r.status === 'COMPLETED').length,
  }

  const today = new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' })

  return (
    <AppShell pageTitle="Dashboard">
      <div style={{ display:'flex', flexDirection:'column', gap:18 }}>

        {/* ── Page header ── */}
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'var(--text-primary)', letterSpacing:'-0.01em' }}>
              Rake Dashboard
            </div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{today}</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading} title="Refresh">
              <RefreshIcon spin={loading} />
            </button>
            <button className="btn btn-primary" onClick={() => navigate('/rake-generation')}>
              <PlusIcon /> Generate New Rake
            </button>
          </div>
        </div>

        {/* ── Active session restore card ── */}
        {activeSession && (
          <div className="card" style={{ border: '2px solid var(--orange-500)', background: 'var(--orange-50)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
              <div style={{
                width: 38, height: 38, background: 'var(--orange-500)', borderRadius: 'var(--r-md)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--orange-700)' }}>
                  Loading Session In Progress
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Rake{' '}
                  <strong style={{ fontFamily: 'var(--font-mono)' }}>{activeSession.rakeId}</strong>
                  {activeSession.destination?.name && (
                    <> · {activeSession.destination.name} ({activeSession.destination.code})</>
                  )}
                  {activeSession.startedAt && <> · Started {fmtDateTime(activeSession.startedAt)}</>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--red-600)' }}
                  onClick={() => {
                    if (window.confirm('Discard this session? All loaded plate data will be lost and cannot be recovered.')) {
                      localStorage.removeItem('bsp_loading_session')
                      localStorage.removeItem('bsp_sessions_map')
                      setActiveSession(null)
                    }
                  }}
                >
                  Discard
                </button>
                <button className="btn btn-accent" onClick={() => navigate('/loading-operations')}>
                  Resume Session →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Stats row ── */}
        <div className="stat-grid" style={{ gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
          <StatTile label="Total Rakes"  value={stats.total}      sub="all time"   />
          <StatTile label="Active"       value={stats.active}     sub="not started" color="var(--navy-500)"  />
          <StatTile label="In Progress"  value={stats.inProgress} sub="loading now" color="var(--amber-700)" />
          <StatTile label="Completed"    value={stats.completed}  sub="finished"    color="var(--green-700)" />
        </div>

        {/* ── Table card ── */}
        <div className="card">
          {/* Toolbar */}
          <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border-subtle)', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            {/* Status filter tabs */}
            <div className="tab-bar" style={{ borderBottom:'none', gap:4 }}>
              {[
                { key:'ALL',         label:'All',         count: stats.total       },
                { key:'ACTIVE',      label:'Active',      count: stats.active      },
                { key:'IN_PROGRESS', label:'In Progress', count: stats.inProgress  },
                { key:'COMPLETED',   label:'Completed',   count: stats.completed   },
              ].map(t => (
                <button
                  key={t.key}
                  className={`tab-item${filter === t.key ? ' active' : ''}`}
                  style={{ display:'flex', alignItems:'center', gap:5, fontSize:12.5, padding:'6px 12px' }}
                  onClick={() => setFilter(t.key)}
                >
                  {t.label}
                  <span style={{
                    fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:'var(--r-full)',
                    background: filter === t.key ? 'var(--navy-500)' : 'var(--gray-200)',
                    color:      filter === t.key ? '#fff' : 'var(--text-secondary)',
                  }}>{t.count}</span>
                </button>
              ))}
            </div>

            <div style={{ flex:1 }} />

            {/* Search */}
            <div className="search-input-wrapper" style={{ width:220 }}>
              <span className="search-icon"><SearchIcon size={13} /></span>
              <input
                className="form-control"
                placeholder="Search rake ID or destination…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ fontSize:12.5 }}
              />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div style={{ padding:'48px 0', display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
              <span className="spinner spinner-lg" />
              <span style={{ fontSize:13, color:'var(--text-muted)' }}>Loading rakes…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon"><TrainIcon size={22} /></div>
              <div className="empty-state-title">{search || filter !== 'ALL' ? 'No rakes match the filter' : 'No rakes found'}</div>
              <div className="empty-state-text">
                {search || filter !== 'ALL'
                  ? 'Try clearing the search or changing the status filter.'
                  : 'Generate a new Rake ID to get started.'}
              </div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <SortTh col="rakeId"    label="Rake ID"       current={sortCol} dir={sortDir} onSort={handleSort} />
                    <th>Destination(s)</th>
                    <th>Status</th>
                    <th style={{ textAlign:'center' }}>Wagons</th>
                    <SortTh col="createdAt" label="Created"       current={sortCol} dir={sortDir} onSort={handleSort} />
                    <th>By</th>
                    <th style={{ textAlign:'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(rake => {
                    const sc = STATUS_CONFIG[rake.status] || STATUS_CONFIG.ACTIVE
                    const canLoad = rake.status === 'ACTIVE' || rake.status === 'IN_PROGRESS'
                    return (
                      <tr
                        key={rake.rakeId}
                        style={{ cursor: canLoad ? 'pointer' : 'default' }}
                        onClick={() => canLoad && handleStartLoading(rake)}
                        className={canLoad ? '' : ''}
                      >
                        <td>
                          <span className="td-mono" style={{ fontWeight:700, fontSize:13.5, color:'var(--navy-700)' }}>
                            {rake.rakeId}
                          </span>
                        </td>
                        <td>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:4 }}>
                            {(rake.destinations || []).map(d => (
                              <span key={d.code} className="dest-chip" style={{ fontSize:11 }}>
                                <DestIcon size={10} />
                                {d.name} <span style={{ opacity:.6 }}>({d.code})</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${sc.badge}`}>
                            {sc.dot && <span className="badge-dot" />}
                            {sc.label}
                          </span>
                        </td>
                        <td style={{ textAlign:'center', fontSize:12.5, fontFamily:'var(--font-mono)', fontWeight:600 }}>
                          {wagonCounts[rake.rakeId] ?? <span style={{ color:'var(--text-muted)' }}>—</span>}
                        </td>
                        <td>
                          <div style={{ fontSize:12.5, color:'var(--text-primary)' }}>{fmtDateOnly(rake.createdAt)}</div>
                        </td>
                        <td style={{ fontSize:12.5 }}>{rake.createdBy || '—'}</td>
                        <td style={{ textAlign:'right' }}>
                          {canLoad ? (
                            <button
                              className={`btn btn-sm ${rake.status === 'IN_PROGRESS' ? 'btn-accent' : 'btn-primary'}`}
                              onClick={e => { e.stopPropagation(); handleStartLoading(rake) }}
                            >
                              {rake.status === 'IN_PROGRESS' ? <><ResumeIcon size={12} /> Resume</> : <><LoadIcon size={12} /> Start Loading</>}
                            </button>
                          ) : (
                            <span className="badge badge-neutral" style={{ fontSize:11 }}>Done</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer */}
          {!loading && filtered.length > 0 && (
            <div style={{ padding:'10px 16px', borderTop:'1px solid var(--border-subtle)', fontSize:12, color:'var(--text-muted)', display:'flex', justifyContent:'space-between' }}>
              <span>Showing {filtered.length} of {rakes.length} rake{rakes.length !== 1 ? 's' : ''}</span>
              <span>Click a row to start loading</span>
            </div>
          )}
        </div>

        {/* ── Info banner: generate rake CTA ── */}
        {!loading && stats.active === 0 && stats.inProgress === 0 && (
          <div className="alert alert-info" style={{ alignItems:'center' }}>
            <InfoIcon />
            <span style={{ flex:1 }}>No active rakes right now. Generate a new Rake ID to start a loading session.</span>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/rake-generation')}>
              <PlusIcon /> Generate Rake
            </button>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ── Sub-components ────────────────────────────────────────────────
function StatTile({ label, value, sub, color }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize:24, color: color || 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function SortTh({ col, label, current, dir, onSort }) {
  const active = current === col
  return (
    <th
      onClick={() => onSort(col)}
      style={{ cursor:'pointer', userSelect:'none', whiteSpace:'nowrap' }}
    >
      <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
        {label}
        <span style={{ opacity: active ? 1 : 0.3, fontSize:10 }}>
          {active && dir === 'asc' ? '▲' : '▼'}
        </span>
      </span>
    </th>
  )
}

// ── Icons ─────────────────────────────────────────────────────────
function SearchIcon({ size=16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
}
function PlusIcon({ size=14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function LoadIcon({ size=13 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
}
function ResumeIcon({ size=13 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polygon points="5 3 19 12 5 21 5 3"/>
  </svg>
}
function TrainIcon({ size=22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="16" rx="2"/>
    <path d="M4 10h16"/><path d="M8 18l-2 4M16 18l2 4"/>
    <circle cx="8.5" cy="14.5" r="1.5"/><circle cx="15.5" cy="14.5" r="1.5"/>
  </svg>
}
function DestIcon({ size=11 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
  </svg>
}
function InfoIcon({ size=15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink:0 }}>
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>
}
function RefreshIcon({ size=14, spin=false }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={ spin ? { animation:'spin 0.9s linear infinite' } : undefined }>
    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
  </svg>
}
