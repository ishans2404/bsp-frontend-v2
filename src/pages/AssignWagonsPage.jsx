import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import AppShell from '../components/layout/AppShell.jsx'
import { fetchRakeInfo, fetchLoadedDetails } from '../api/index.js'
import { useToast } from '../context/ToastContext.jsx'

const WAGONS_KEY = 'bsp_wagons_session'

export default function AssignWagonsPage() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const toast     = useToast()

  const state    = location.state || {}
  const initialRakeId = state.prefillRakeId ? String(state.prefillRakeId).toUpperCase() : ''
  const isModification = state.isModification || false

  const [rakeId, setRakeId] = useState(initialRakeId)
  const [rakeInfo, setRakeInfo] = useState(
    state.prefillRakeInfo
      ? { ...state.prefillRakeInfo, rakeId: initialRakeId || String(state.prefillRakeInfo.rakeId || '') }
      : null
  )
  const [rakeLoading, setRakeLoading] = useState(false)

  const [wagons, setWagons] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(WAGONS_KEY) || '[]')
      // stored format is [{wagonNo, consigneeCode}]; extract just the wagon numbers
      return stored.map(w => (typeof w === 'string' ? w : w.wagonNo)).filter(Boolean)
    } catch { return [] }
  })
  const [input, setInput]   = useState('')
  const inputRef = useRef(null)

  const destinations = rakeInfo?.destinations || (state.prefillDest ? [state.prefillDest] : [])

  // Persist wagon list to localStorage, preserving existing consignee assignments
  useEffect(() => {
    try {
      const existing = JSON.parse(localStorage.getItem(WAGONS_KEY) || '[]')
      const existingMap = Object.fromEntries(
        existing.filter(w => w?.wagonNo).map(w => [w.wagonNo, w.consigneeCode])
      )
      localStorage.setItem(
        WAGONS_KEY,
        JSON.stringify(wagons.map(wNo => ({ wagonNo: wNo, consigneeCode: existingMap[wNo] ?? null })))
      )
    } catch {}
  }, [wagons])

  useEffect(() => {
    if (!isModification || !initialRakeId) return
    fetchLoadedDetails(initialRakeId)
      .then(raw => {
        if (!Array.isArray(raw)) return
        const wagonNos = [...new Set(raw.map(r => (r.DISPATCH_NM || '').trim()).filter(Boolean))]
        setWagons(prev => {
          const existingSet = new Set(prev)
          const merged = [...prev]
          for (const wNo of wagonNos) {
            if (!existingSet.has(wNo)) merged.push(wNo)
          }
          return merged
        })
      })
      .catch(() => {})
  }, [isModification, initialRakeId])

  async function ensureRakeInfo(rakeIdToLoad) {
    const id = String(rakeIdToLoad || '').trim().toUpperCase()
    if (!id) {
      toast.warning('Please enter a Rake ID.')
      return null
    }

    if (rakeInfo && String(rakeInfo.rakeId) === id) return rakeInfo

    setRakeLoading(true)
    try {
      const info = await fetchRakeInfo(id)
      const merged = { ...info, rakeId: id }
      setRakeInfo(merged)
      return merged
    } catch {
      toast.error('Could not fetch Rake info. Please verify the Rake ID.')
      return null
    } finally {
      setRakeLoading(false)
    }
  }

  async function handleFetchRake() {
    const id = rakeId.trim().toUpperCase()
    if (!id) {
      toast.warning('Please enter a Rake ID.')
      return
    }
    const info = await ensureRakeInfo(id)
    if (info) toast.success({ title: 'Rake Loaded', message: `Rake ${id} is ready for wagon assignment.` })
  }

  function handleAdd() {
    if (!rakeId.trim()) {
      toast.warning('Enter Rake ID first.')
      return
    }
    const val = input.trim().toUpperCase()
    if (!val) return
    if (wagons.includes(val)) {
      toast.warning(`Wagon "${val}" is already in the list.`)
      return
    }
    setWagons(prev => [...prev, val])
    setInput('')
    inputRef.current?.focus()
  }

  function handleRemove(wNo) {
    setWagons(prev => prev.filter(w => w !== wNo))
  }

  async function handleProceed() {
    if (wagons.length === 0) {
      toast.warning('Please add at least one wagon before proceeding.')
      return
    }

    const id = rakeId.trim().toUpperCase()
    if (!id) {
      toast.warning('Please enter a Rake ID.')
      return
    }

    const info = await ensureRakeInfo(id)
    if (!info) return

    navigate(isModification ? '/rake-modification' : '/loading-operations', {
      state: {
        ...state,
        prefillRakeId: id,
        prefillDest: info.destinations?.[0] || null,
        prefillRakeInfo: info,
        prefillWagons: wagons,
        isModification,
      },
    })
  }

  return (
    <AppShell pageTitle="Assign Wagons">
      <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Page header */}
        <div className="section-header">
          <div>
            <div className="section-title">Assign Wagons</div>
            <div className="section-sub">
              {rakeId
                ? `Enter all wagon numbers for Rake ${rakeId} before starting the loading session.`
                : 'Enter a Rake ID, then add wagon numbers before starting the loading session.'}
            </div>
          </div>
        </div>

        {/* Rake info */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon"><DestIcon size={14} /></div>
            <div>
              <div className="card-title">Rake Selection</div>
              <div className="card-subtitle">Enter a Rake ID manually or use one prefilled from dashboard.</div>
            </div>
          </div>
          <div className="card-body" style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-control lg mono"
                placeholder="e.g. 2026032701"
                value={rakeId}
                onChange={e => {
                  const next = e.target.value.toUpperCase()
                  setRakeId(next)
                  if (rakeInfo && String(rakeInfo.rakeId) !== next.trim()) setRakeInfo(null)
                }}
                onKeyDown={e => e.key === 'Enter' && handleFetchRake()}
                style={{ flex: 1 }}
              />
              <button className="btn btn-secondary" onClick={handleFetchRake} disabled={!rakeId.trim() || rakeLoading}>
                {rakeLoading ? <><span className="spinner spinner-sm" /> Loading...</> : 'Load Rake'}
              </button>
            </div>

            {rakeInfo ? (
              <div className="rakeid-display">
                <div style={{ flex: 1 }}>
                  <div className="rakeid-label">Rake ID</div>
                  <div className="rakeid-value">{rakeId}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {destinations.map(d => (
                    <span key={d.code} className="dest-chip">
                      <DestIcon size={11} />
                      {d.name} ({d.code})
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="form-hint">
                Load the rake to verify destination details before assigning wagons.
              </div>
            )}
          </div>
        </div>

        {/* Add wagons card */}
        <div className="card">
          <div className="card-header">
            <div className="card-icon"><WagonIcon /></div>
            <div>
              <div className="card-title">Wagon Numbers</div>
              <div className="card-subtitle">
                Add each wagon in this rake. One wagon belongs to one consignee; a consignee may use multiple wagons.
              </div>
            </div>
            <span
              className="badge badge-navy"
              style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }}
            >
              {wagons.length} wagon{wagons.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Input row */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                ref={inputRef}
                className="form-control lg mono"
                placeholder="e.g. WGN-01 or 034510"
                value={input}
                onChange={e => setInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                autoFocus
                disabled={!rakeId.trim()}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-primary"
                onClick={handleAdd}
                disabled={!rakeId.trim() || !input.trim()}
              >
                <PlusIcon /> Add
              </button>
            </div>

            {/* Wagon list */}
            {wagons.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {wagons.map((w, i) => (
                  <div
                    key={w}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 14px',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--bg-surface)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        minWidth: 22,
                      }}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <WagonIcon size={15} />
                    <span
                      style={{
                        flex: 1,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 700,
                        fontSize: 14,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {w}
                    </span>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => handleRemove(w)}
                      title="Remove wagon"
                    >
                      <RemoveIcon />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <div className="empty-state-icon"><WagonIcon size={22} /></div>
                <div className="empty-state-title">No wagons added yet</div>
                <div className="empty-state-text">
                  Type a wagon number above and press Enter or click Add.
                </div>
              </div>
            )}
          </div>

          <div className="card-footer" style={{ justifyContent: 'space-between' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
              <BackIcon /> Back
            </button>
            <button
              className="btn btn-primary btn-lg"
              onClick={handleProceed}
              disabled={wagons.length === 0 || !rakeId.trim() || rakeLoading}
            >
              Proceed to Loading <ArrowRightIcon />
            </button>
          </div>
        </div>

        {/* Rule reminder */}
        <div className="alert alert-info">
          <InfoIcon />
          <div style={{ fontSize: 12.5 }}>
            <strong>Wagon rules:</strong> Each wagon is assigned to exactly one consignee during loading.
            A consignee may span multiple wagons if needed. During loading, select a consignee, then
            select the wagon you are physically loading plates into.
          </div>
        </div>

      </div>
    </AppShell>
  )
}

// ── Icons ────────────────────────────────────────────────────────
function WagonIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="3" width="15" height="13" rx="1"/>
      <path d="M16 8h4l3 3v5h-7V8z"/>
      <circle cx="5.5" cy="18.5" r="2.5"/>
      <circle cx="18.5" cy="18.5" r="2.5"/>
    </svg>
  )
}
function PlusIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function RemoveIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
}
function DestIcon({ size = 11 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
  </svg>
}
function BackIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
}
function ArrowRightIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
}
function InfoIcon({ size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>
}
