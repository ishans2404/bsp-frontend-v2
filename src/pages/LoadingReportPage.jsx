import React, { useState, useEffect, useRef } from 'react'
import AppShell from '../components/layout/AppShell.jsx'
import { fetchDestinations, fetchLoadingReport } from '../api/index.js'
import { useToast } from '../context/ToastContext.jsx'

export default function LoadingReportPage() {
  const toast = useToast()

  const [destinations,  setDestinations]  = useState([])
  const [loadingDests,  setLoadingDests]  = useState(true)
  const [selectedDest,  setSelectedDest]  = useState('')
  const [loading,       setLoading]       = useState(false)
  const [consignees,    setConsignees]    = useState([])
  const [fetched,       setFetched]       = useState(false)
  const [search,        setSearch]        = useState('')
  const [expanded,      setExpanded]      = useState(new Set())
  const [sortBy,        setSortBy]        = useState('plates_desc')
  const fetchInProgressRef = useRef(false)

  useEffect(() => {
    fetchDestinations()
      .then(setDestinations)
      .catch(() => toast.error('Failed to load destinations.'))
      .finally(() => setLoadingDests(false))
  }, [])

  async function handleFetch() {
    if (!selectedDest) { toast.warning('Please select a destination.'); return }
    if (fetchInProgressRef.current) {
      toast.info({ message: 'Fetch already in progress...' })
      return
    }
    fetchInProgressRef.current = true
    toast.info({
      title: 'Fetch Started',
      message: `Loading report for ${destLabel(selectedDest)}...`,
      duration: 2200,
    })
    setLoading(true)
    try {
      const data = await fetchLoadingReport(selectedDest)
      setConsignees(data)
      setFetched(true)
      setSearch('')
      setExpanded(new Set())
      toast.success({ title: 'Data Loaded', message: `${data.length} consignees for ${destLabel(selectedDest)}` })
    } catch {
      toast.error('Failed to fetch consignee data.')
    } finally {
      setLoading(false)
      fetchInProgressRef.current = false
    }
  }

  function destLabel(code) {
    const d = destinations.find(x => x.code === code)
    return d ? `${d.name} (${d.code})` : code
  }

  function toggleExpand(code) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })
  }
  function expandAll()   { setExpanded(new Set(consignees.map(c => c.consigneeCode))) }
  function collapseAll() { setExpanded(new Set()) }

  // Filter
  const filtered = consignees.filter(c =>
    !search ||
    c.consigneeName.toLowerCase().includes(search.toLowerCase()) ||
    c.consigneeCode.includes(search)
  )

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const aOk = a.okPlateCount ?? a.plates.filter(p => p.plateType === 'OK').length
    const bOk = b.okPlateCount ?? b.plates.filter(p => p.plateType === 'OK').length
    if (sortBy === 'plates_desc') return bOk - aOk
    if (sortBy === 'plates_asc')  return aOk - bOk
    if (sortBy === 'name_asc')    return a.consigneeName.localeCompare(b.consigneeName)
    if (sortBy === 'name_desc')   return b.consigneeName.localeCompare(a.consigneeName)
    if (sortBy === 'orders_desc') return b.orders.length - a.orders.length
    return 0
  })

  // Totals
  const totalOrders = consignees.reduce((s, c) => s + c.orders.length, 0)
  const totalPlates = consignees.reduce((s, c) => s + (c.okPlateCount ?? c.plates.filter(p => p.plateType === 'OK').length), 0)
  const totalBal    = consignees.reduce((s, c) => s + c.orders.reduce((oo, o) => oo + (o.bal || 0), 0), 0)

  return (
    <AppShell pageTitle="Loading Report">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Filter bar ── */}
        <div className="card">
          <div className="card-body" style={{ padding: '14px 18px' }}>
            <div className="form-row" style={{ alignItems: 'flex-end', gap: 12 }}>
              <div className="form-group" style={{ flex: 2 }}>
                <label className="form-label" htmlFor="rpt-dest">Destination</label>
                {loadingDests ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                    <span className="spinner spinner-sm" />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading…</span>
                  </div>
                ) : (
                  <select
                    id="rpt-dest"
                    className="form-control"
                    value={selectedDest}
                    onChange={e => { setSelectedDest(e.target.value); setFetched(false); setConsignees([]) }}
                  >
                    <option value="">— Select destination —</option>
                    {destinations.map(d => (
                      <option key={d.code} value={d.code}>{d.name} ({d.code})</option>
                    ))}
                  </select>
                )}
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" htmlFor="rpt-sort">Sort by</label>
                <select id="rpt-sort" className="form-control" value={sortBy} onChange={e => setSortBy(e.target.value)}>
                  <option value="plates_desc">OK Plates ↓</option>
                  <option value="plates_asc">OK Plates ↑</option>
                  <option value="orders_desc">Orders ↓</option>
                  <option value="name_asc">Name A–Z</option>
                  <option value="name_desc">Name Z–A</option>
                </select>
              </div>
              <div style={{ paddingBottom: 0 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleFetch}
                  disabled={!selectedDest || loading}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {loading
                    ? <><span className="spinner spinner-sm" /> Fetching…</>
                    : <><FetchIcon /> Fetch Details</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Summary strip (shown after fetch) ── */}
        {fetched && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                <span className="spinner spinner-sm" />
                Refreshing in background...
              </div>
            )}
            <div className="stat-grid" style={{ flex: 1, gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <div className="stat-tile" style={{ padding: '10px 14px' }}>
                <div className="stat-label">Consignees</div>
                <div className="stat-value" style={{ fontSize: 18 }}>{consignees.length}</div>
              </div>
              <div className="stat-tile" style={{ padding: '10px 14px' }}>
                <div className="stat-label">Total Orders</div>
                <div className="stat-value" style={{ fontSize: 18 }}>{totalOrders}</div>
              </div>
              <div className="stat-tile" style={{ padding: '10px 14px' }}>
                <div className="stat-label">OK Plates</div>
                <div className="stat-value" style={{ fontSize: 18, color: 'var(--green-700)' }}>{totalPlates}</div>
              </div>
              <div className="stat-tile" style={{ padding: '10px 14px' }}>
                <div className="stat-label">Balance Qty</div>
                <div className="stat-value" style={{ fontSize: 18 }}>{totalBal}</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div className="search-input-wrapper" style={{ width: 220 }}>
                <span className="search-icon"><SearchIcon size={13} /></span>
                <input
                  className="form-control"
                  placeholder="Search consignee…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ fontSize: 12.5 }}
                />
              </div>
              <button className="btn btn-ghost btn-sm" onClick={expandAll} title="Expand all">
                <ExpandIcon /> All
              </button>
              <button className="btn btn-ghost btn-sm" onClick={collapseAll} title="Collapse all">
                <CollapseIcon />
              </button>
            </div>
          </div>
        )}

        {/* ── Empty state ── */}
        {!fetched && !loading && (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><TableIcon size={22} /></div>
              <div className="empty-state-title">No data loaded</div>
              <div className="empty-state-text">Select a destination above and click "Fetch Details" to view the consignee loading report.</div>
            </div>
          </div>
        )}

        {/* ── Consignee rows ── */}
        {fetched && sorted.map(c => {
          const okPlates = c.plates.filter(p => p.plateType === 'OK')
          const isOpen     = expanded.has(c.consigneeCode)
          const okCount    = c.okPlateCount ?? okPlates.length
          const ordCount   = c.orders.length
          const totalBal_c = c.orders.reduce((s, o) => s + (o.bal || 0), 0)

          return (
            <div key={c.consigneeCode} className="card" style={{ overflow: 'hidden' }}>
              {/* ── Consignee header ── */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px',
                  background: isOpen ? 'var(--navy-50)' : 'var(--bg-surface)',
                  borderBottom: isOpen ? '1px solid var(--border-subtle)' : 'none',
                  cursor: 'pointer', userSelect: 'none',
                }}
                onClick={() => toggleExpand(c.consigneeCode)}
              >
                <div style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: '150ms', color: 'var(--text-muted)', flexShrink: 0 }}>
                  <ChevronIcon />
                </div>
                <span className="consignee-code-badge" style={{ fontSize: 12 }}>{c.consigneeCode}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{c.consigneeName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    {ordCount} order{ordCount !== 1 ? 's' : ''}
                  </div>
                </div>
                {/* Quick stats */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>OK Plates</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: okCount > 0 ? 'var(--green-700)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{okCount}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Balance</div>
                    <div style={{ fontWeight: 700, fontSize: 15, fontFamily: 'var(--font-mono)' }}>{totalBal_c}</div>
                  </div>
                  {okCount > 0
                    ? <span className="badge badge-success"><span className="badge-dot" />Ready</span>
                    : <span className="badge badge-neutral"><span className="badge-dot" />Pending</span>
                  }
                </div>
              </div>

              {/* ── Expanded: orders table ── */}
              {isOpen && (
                <div>
                  <div className="table-wrapper">
                    <table className="data-table" style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Order No.</th>
                          <th>Grade</th>
                          <th>Size (mm)</th>
                          <th>TDC</th>
                          <th>Colour</th>
                          <th style={{ textAlign: 'right' }}>Ord</th>
                          <th style={{ textAlign: 'right' }}>Desp</th>
                          <th style={{ textAlign: 'right' }}>Bal</th>
                          <th style={{ textAlign: 'right' }}>TEST</th>
                          <th style={{ textAlign: 'right' }}>NORM</th>
                          <th style={{ textAlign: 'right' }}>FIN</th>
                          <th style={{ textAlign: 'right' }}>OK Plates</th>
                          <th style={{ textAlign: 'right' }}>RA Plates</th>
                          <th>PLATES Raw</th>
                          <th>Remark</th>
                          <th>Plates / Heat Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...c.orders].sort((o1, o2) => {
                          const okCount1 = okPlates.filter(p => p.ordNo === o1.ordNo).length
                          const okCount2 = okPlates.filter(p => p.ordNo === o2.ordNo).length
                          // Primary: OK plates (descending)
                          if (okCount2 !== okCount1) return okCount2 - okCount1
                          // Secondary: Grade (ascending)
                          if (o1.grade !== o2.grade) return o1.grade.localeCompare(o2.grade)
                          // Tertiary: TDC (ascending)
                          if (o1.tdc !== o2.tdc) return o1.tdc.localeCompare(o2.tdc)
                          // Quaternary: Size (ascending)
                          return o1.ordSize.localeCompare(o2.ordSize)
                        }).map((o, i) => {
                          const okForOrder = okPlates.filter(p => p.ordNo === o.ordNo).length
                          const raForOrder = c.plates.filter(p => p.plateType === 'RA' && p.ordNo === o.ordNo).length
                          return (
                            <tr key={`${o.ordNo}-${i}`}>
                              <td className="td-mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{o.ordNo}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div style={{ fontWeight: 600, color: 'var(--navy-600)', fontSize: 11.5 }}>{o.grade}</div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{o.ordType} · {o.usageGrp}</div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{o.ordSize}</div>
                                {o.pcWgt && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{o.pcWgt}T/pc · NOP:{o.nop}</div>}
                              </td>
                              <td style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{o.tdc}</td>
                              <td style={{ fontSize: 11 }}>{o.colourCd || '—'}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.ord}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.desp}</td>
                              <td className="td-mono" style={{ textAlign: 'right', fontWeight: 600, color: o.bal > 0 ? 'var(--navy-600)' : 'var(--text-muted)' }}>{o.bal}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.test ?? '—'}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.norm ?? '—'}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.fin ?? '—'}</td>
                              <td style={{ textAlign: 'right' }}>
                                {okForOrder > 0
                                  ? <span className="badge badge-success">{okForOrder}</span>
                                  : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                                }
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {raForOrder > 0
                                  ? <span className="badge badge-warning">{raForOrder}</span>
                                  : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                                }
                              </td>
                              <td style={{ maxWidth: 200, fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                                {o.platesRaw || '—'}
                              </td>
                              <td style={{ fontSize: 11, color: 'var(--amber-700)' }}>
                                {[o.remart, o.ordPr].filter(Boolean).join(' · ') || '—'}
                              </td>
                              <td style={{ maxWidth: 260 }}>
                                <HeatDisplay heatRaw={o.heatRaw} platesRaw={o.platesRaw} tpiRaw={o.tpiPlatesRaw} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* OK plates sub-table */}
                  {okPlates.length > 0 && (
                    <div style={{ background: 'var(--green-50)', borderTop: '1px solid var(--green-200)', padding: '10px 16px' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--green-700)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                        OK Plates ready for loading ({okPlates.length})
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {okPlates.map(p => (
                          <div key={p.plateNo} style={{
                            padding: '4px 10px',
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--green-200)',
                            borderRadius: 'var(--r-md)',
                            fontSize: 11.5,
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                            color: 'var(--green-800)',
                          }}>
                            {p.plateNo}
                            <span style={{ fontFamily: 'var(--font)', fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 5 }}>
                              {p.heatNo} · {p.grade}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* RA plates sub-section */}
                  {(() => {
                    const raPlates = c.plates.filter(p => p.plateType === 'RA')
                    return raPlates.length > 0 ? (
                      <div style={{ background: 'var(--amber-50)', borderTop: '1px solid #fde68a', padding: '10px 16px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber-700)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                          RA Plates ({raPlates.length})
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {raPlates.map(p => (
                            <div key={p.plateNo} style={{
                              padding: '4px 10px',
                              background: 'var(--bg-surface)',
                              border: '1px solid #fde68a',
                              borderRadius: 'var(--r-md)',
                              fontSize: 11.5,
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                              color: 'var(--amber-700)',
                            }}>
                              {p.plateNo}
                              <span style={{ fontFamily: 'var(--font)', fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 5 }}>
                                {p.heatNo} · {p.grade}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null
                  })()}
                </div>
              )}
            </div>
          )
        })}

        {fetched && sorted.length === 0 && (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon"><SearchIcon size={20} /></div>
              <div className="empty-state-title">No results</div>
              <div className="empty-state-text">No consignees match your search.</div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ── Heat/Plate display component ──────────────────────────────────
function HeatDisplay({ heatRaw, platesRaw, tpiRaw }) {
  const parts = []
  if (heatRaw && heatRaw.includes('#OK-'))       parts.push({ label: 'Heat', text: heatRaw })
  if (platesRaw && platesRaw.includes('#OK-'))   parts.push({ label: 'Plates', text: platesRaw })
  if (tpiRaw && tpiRaw.includes('#OK-'))         parts.push({ label: 'TPI', text: tpiRaw })
  if (!parts.length) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {parts.map(({ label, text }) => (
        <div key={label} style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--green-800)', lineHeight: 1.4 }}>
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font)', marginRight: 4 }}>{label}:</span>
          {text.replace(/\s+/g, ' ').trim()}
        </div>
      ))}
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────
function TableIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/>
  </svg>
}
function FetchIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
}
function SearchIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
}
function ChevronIcon({ size = 13 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
}
function ExpandIcon({ size = 13 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
  </svg>
}
function CollapseIcon({ size = 13 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
    <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
  </svg>
}