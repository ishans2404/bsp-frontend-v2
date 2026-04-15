import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import AppShell from '../components/layout/AppShell.jsx'
import Modal from '../components/shared/Modal.jsx'
import { fetchRakeInfo, fetchWagonsByRake, linkWagonToRake } from '../api/index.js'
import { useToast } from '../context/ToastContext.jsx'

export default function AssignWagonsPage() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const toast     = useToast()

  const state    = location.state || {}
  const initialRakeId = state.prefillRakeId ? String(state.prefillRakeId).toUpperCase() : ''

  const [rakeId, setRakeId] = useState(initialRakeId)
  const [rakeInfo, setRakeInfo] = useState(
    state.prefillRakeInfo
      ? { ...state.prefillRakeInfo, rakeId: initialRakeId || String(state.prefillRakeInfo.rakeId || '') }
      : null
  )
  const [rakeLoading, setRakeLoading] = useState(false)
  const [wagons, setWagons] = useState([])
  const [wagonsLoading, setWagonsLoading] = useState(false)
  const [input, setInput]   = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const inputRef = useRef(null)

  const destinations = rakeInfo?.destinations || (state.prefillDest ? [state.prefillDest] : [])

  // Fetch wagons from API whenever rakeInfo is set/changed
  useEffect(() => {
    const id = rakeInfo?.rakeId ? String(rakeInfo.rakeId).trim() : ''
    if (!id) return
    setWagonsLoading(true)
    fetchWagonsByRake(id)
      .then(raw => {
        const byWagon = new Map()
        raw.forEach(r => {
          const wagonNo = String(r.DISPATCH_NM || '').trim().toUpperCase()
          if (!wagonNo) return

          const dispatchCd = String(r.DISPATCH_CD || '').trim() || null
          const custNm = String(r.CUST_NM || '').trim() || null
          const existing = byWagon.get(wagonNo)

          if (!existing) {
            byWagon.set(wagonNo, { wagonNo, dispatchCd, custNm, isNewlyAdded: false })
            return
          }

          if (!existing.dispatchCd && dispatchCd) {
            byWagon.set(wagonNo, { ...existing, dispatchCd })
          }
          if (!existing.custNm && custNm) {
            byWagon.set(wagonNo, { ...existing, custNm })
          }
        })
        setWagons(Array.from(byWagon.values()))
      })
      .catch(() => {})
      .finally(() => setWagonsLoading(false))
  }, [rakeInfo?.rakeId])

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
    if (!id) { toast.warning('Please enter a Rake ID.'); return }
    const info = await ensureRakeInfo(id)
    if (info) toast.success({ title: 'Rake Loaded', message: `Rake ${id} is ready for wagon assignment.` })
  }

  async function handleAdd() {
    if (!rakeId.trim()) { toast.warning('Enter Rake ID first.'); return }
    const val = input.trim().toUpperCase()
    if (!val) return
    if (wagons.some(w => w.wagonNo === val)) { toast.warning(`Wagon "${val}" is already in the list.`); return }
    // Add wagon to local state only; API call deferred to handleConfirmProceed
    setWagons(prev => [...prev, { wagonNo: val, dispatchCd: null, custNm: null, isNewlyAdded: true }])
    setInput('')
    inputRef.current?.focus()
  }

  async function handleRemove(wNo) {
    const wagon = wagons.find(w => w.wagonNo === wNo)
    // Only call API for wagons fetched from the backend; newly added ones are not yet linked
    if (wagon && !wagon.isNewlyAdded) {
      try {
        await linkWagonToRake(rakeId.trim(), wNo, 0)
      } catch {
        // Continue with local removal even if API fails
      }
    }
    setWagons(prev => prev.filter(w => w.wagonNo !== wNo))
  }

  async function handleProceed() {
    if (wagons.length === 0) { toast.warning('Please add at least one wagon before proceeding.'); return }
    const id = rakeId.trim().toUpperCase()
    if (!id) { toast.warning('Please enter a Rake ID.'); return }
    const info = await ensureRakeInfo(id)
    if (!info) return
    setShowConfirmModal(true)
  }

  async function handleConfirmProceed() {
    const id = rakeId.trim().toUpperCase()
    const info = await ensureRakeInfo(id)
    if (!info) return

    // Send linkWagonToRake for newly added wagons only
    const newWagons = wagons.filter(w => w.isNewlyAdded)
    for (const wagon of newWagons) {
      try {
        await linkWagonToRake(id, wagon.wagonNo, 1)
      } catch (err) {
        console.error(`Failed to link wagon ${wagon.wagonNo}:`, err)
        toast.error(`Failed to link wagon ${wagon.wagonNo}. Please try again.`)
        return
      }
    }

    setShowConfirmModal(false)
    navigate('/loading-operations', {
      state: {
        prefillRakeId: id,
        prefillDest: info.destinations?.[0] || null,
        prefillRakeInfo: info,
        prefillWagons: wagons.map(w => w.wagonNo),
      },
    })
  }

  return (
    <AppShell pageTitle="Assign Wagons">
      <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

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
              <div className="form-hint">Load the rake to verify destination details before assigning wagons.</div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-icon"><WagonIcon /></div>
            <div>
              <div className="card-title">Wagon Numbers</div>
              <div className="card-subtitle">Add each wagon in this rake. One wagon belongs to one consignee; a consignee may use multiple wagons.</div>
            </div>
            {wagonsLoading
              ? <span className="spinner spinner-sm" style={{ marginLeft: 'auto' }} />
              : <span className="badge badge-navy" style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }}>
                  {wagons.length} wagon{wagons.length !== 1 ? 's' : ''}
                </span>
            }
          </div>

          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
              <button className="btn btn-primary" onClick={handleAdd} disabled={!rakeId.trim() || !input.trim()}>
                <PlusIcon /> Add
              </button>
            </div>

            {wagonsLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0' }}>
                <span className="spinner spinner-sm" />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading linked wagons…</span>
              </div>
            ) : wagons.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {wagons
                  .sort((a, b) => {
                    if (a.isNewlyAdded !== b.isNewlyAdded) {
                      return a.isNewlyAdded ? -1 : 1
                    }
                    return a.wagonNo.localeCompare(b.wagonNo)
                  })
                  .map((w, i) => (
                  <div key={w.wagonNo} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: w.isNewlyAdded ? '2px solid #10b981b8' : '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)', background: 'var(--bg-surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', minWidth: 22 }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <WagonIcon size={16} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{w.wagonNo}</span>
                      {w.isNewlyAdded && (
                        <span style={{ fontSize: 9, fontStyle: 'italic', color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>NEW</span>
                      )}
                    </div>
                    <div style={{ flex: 1 }} />
                    {(w.custNm || w.dispatchCd) && (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                        {w.custNm && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{w.custNm}</span>
                        )}
                        {w.dispatchCd && (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{w.dispatchCd}</span>
                        )}
                      </div>
                    )}
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleRemove(w.wagonNo)} title="Remove wagon">
                      <RemoveIcon />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '24px 0' }}>
                <div className="empty-state-icon"><WagonIcon size={22} /></div>
                <div className="empty-state-title">No wagons added yet</div>
                <div className="empty-state-text">Type a wagon number above and press Enter or click Add.</div>
              </div>
            )}
          </div>

          <div className="card-footer" style={{ justifyContent: 'space-between' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
              <BackIcon /> Back
            </button>
            <button className="btn btn-primary btn-lg" onClick={handleProceed} disabled={wagons.length === 0 || !rakeId.trim() || rakeLoading}>
              Proceed to Loading <ArrowRightIcon />
            </button>
          </div>
        </div>

        <div className="alert alert-info">
          <InfoIcon />
          <div style={{ fontSize: 12.5 }}>
            <strong>Wagon rules:</strong> Each wagon is assigned to exactly one consignee during loading.
            A consignee may span multiple wagons if needed. During loading, select a consignee, then
            select the wagon you are physically loading plates into.
          </div>
        </div>

      </div>

      <Modal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        title="Confirm Wagon Assignment"
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowConfirmModal(false)}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleConfirmProceed}>
              Confirm & Proceed
            </button>
          </div>
        }
      >
        <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>
          <p>Ready to proceed with the following wagons for <strong>Rake {rakeId}</strong>?</p>
          <div style={{ marginTop: 12, padding: '12px', background: 'var(--bg-surface)', borderRadius: 'var(--r-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {wagons.map(w => (
                <div key={w.wagonNo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{w.wagonNo}</span>
                  {(w.custNm || w.dispatchCd) && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                      {w.custNm && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12, color: 'var(--text-primary)' }}>{w.custNm}</span>
                      )}
                      {w.dispatchCd && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>{w.dispatchCd}</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            You can modify these wagons later if needed.
          </p>
        </div>
      </Modal>
    </AppShell>
  )
}

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
