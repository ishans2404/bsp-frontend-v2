import React, { useState, useEffect, useRef } from 'react'
import AppShell from '../components/layout/AppShell.jsx'
import Modal from '../components/shared/Modal.jsx'
import { fetchDestinations, fetchLoadingReport } from '../api/index.js'
import { useToast } from '../context/ToastContext.jsx'

const PLATE_TYPES = ['OK', 'RA', 'TPI', 'MTI', 'DIV']
const EMPTY_ORD_KEY = '__NO_ORDER__'

const PLATE_TYPE_META = {
  OK:  { label: 'OK',  bg: 'var(--green-100)',  color: 'var(--green-800)',  dot: 'var(--green-600)' },
  RA:  { label: 'RA',  bg: 'var(--amber-100)',  color: 'var(--amber-700)',  dot: 'var(--amber-700)' },
  TPI: { label: 'TPI', bg: 'var(--sky-100)',    color: 'var(--sky-600)',    dot: 'var(--sky-600)' },
  MTI: { label: 'MTI', bg: 'var(--orange-100)', color: 'var(--orange-700)', dot: 'var(--orange-700)' },
  DIV: { label: 'DIV', bg: 'var(--gray-100)',   color: 'var(--gray-700)',   dot: 'var(--gray-500)' },
}

const PLATE_SECTION_META = {
  OK:  { title: 'OK Plates ready for loading', bg: 'var(--green-50)',  border: 'var(--green-200)',  text: 'var(--green-700)' },
  RA:  { title: 'RA Plates',                   bg: 'var(--amber-50)',  border: '#fde68a',            text: 'var(--amber-700)' },
  TPI: { title: 'TPI Plates',                  bg: '#f0f9ff',          border: '#bae6fd',            text: 'var(--sky-600)' },
  MTI: { title: 'MTI Pending Plates',          bg: 'var(--orange-50)', border: 'var(--orange-100)',  text: 'var(--orange-700)' },
  DIV: { title: 'DIV Plates',                  bg: 'var(--gray-50)',   border: 'var(--gray-200)',    text: 'var(--gray-700)' },
}

function normalizePlateType(type) {
  return PLATE_TYPES.includes(type) ? type : 'DIV'
}

function createEmptyPlateCounts() {
  return { OK: 0, RA: 0, TPI: 0, MTI: 0, DIV: 0, total: 0 }
}

function countPlatesByType(plates = []) {
  const counts = createEmptyPlateCounts()
  for (const p of plates) {
    const type = normalizePlateType(p?.plateType)
    counts[type] += 1
    counts.total += 1
  }
  return counts
}

function groupPlatesByType(plates = []) {
  const grouped = { OK: [], RA: [], TPI: [], MTI: [], DIV: [] }
  for (const p of plates) {
    const type = normalizePlateType(p?.plateType)
    grouped[type].push(p)
  }
  return grouped
}

function summarizeOrderPlates(plates = []) {
  const byOrder = {}
  for (const p of plates) {
    const ordNo = p?.ordNo || EMPTY_ORD_KEY
    if (!byOrder[ordNo]) byOrder[ordNo] = createEmptyPlateCounts()
    const type = normalizePlateType(p?.plateType)
    byOrder[ordNo][type] += 1
    byOrder[ordNo].total += 1
  }
  return byOrder
}

function cleanRawValue(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (['-', '/', ',', '/,', '/,/'].includes(normalized)) return ''
  return normalized
}

function getOrderHeatInfoEntries(order) {
  return [
    { key: 'heat', label: 'HEAT', text: cleanRawValue(order?.heatRaw) },
    { key: 'tpi', label: 'TPI_PLATES', text: cleanRawValue(order?.tpiPlatesRaw) },
    { key: 'mti', label: 'MTI_PENDING_PLATES', text: cleanRawValue(order?.mtiPendingRaw) },
    { key: 'div', label: 'DIV', text: cleanRawValue(order?.divRaw) },
  ].filter(x => x.text)
}

function hasOrderInfo(order) {
  return Boolean(cleanRawValue(order?.platesRaw) || getOrderHeatInfoEntries(order).length > 0)
}

function compareGroupValue(a, b) {
  return String(a || '').trim().localeCompare(String(b || '').trim(), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

export default function LoadingReportPage() {
  const toast = useToast()

  const [destinations,  setDestinations]  = useState([])
  const [loadingDests,  setLoadingDests]  = useState(true)
  const [selectedDest,  setSelectedDest]  = useState('')
  const [loading,       setLoading]       = useState(false)
  const [consignees,    setConsignees]    = useState([])
  const [fetched,       setFetched]       = useState(false)
  const [search,        setSearch]        = useState('')
  const [gradeFilter,   setGradeFilter]   = useState('')
  const [tdcFilter,     setTdcFilter]     = useState('')
  const [expanded,      setExpanded]      = useState(new Set())
  const [sortBy,        setSortBy]        = useState('plates_desc')
  const [detailsModal,  setDetailsModal]  = useState(null)
  const [noPlateExpandedByConsignee, setNoPlateExpandedByConsignee] = useState({})
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
      setGradeFilter('')
      setTdcFilter('')
      setExpanded(new Set())
      setDetailsModal(null)
      setNoPlateExpandedByConsignee({})
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
  function expandAll()   { setExpanded(new Set(filtered.map(c => c.consigneeCode))) }
  function collapseAll() {
    setExpanded(new Set())
    setNoPlateExpandedByConsignee({})
  }

  function toggleNoPlateOrders(code) {
    setNoPlateExpandedByConsignee(prev => ({
      ...prev,
      [code]: !prev[code],
    }))
  }

  const gradeOptions = Array.from(new Set(
    consignees.flatMap(c => c.orders
      .map(o => String(o.grade || '').trim())
      .filter(Boolean)
    )
  )).sort((a, b) => compareGroupValue(a, b))

  const tdcOptions = Array.from(new Set(
    consignees.flatMap(c => c.orders
      .map(o => String(o.tdc || '').trim())
      .filter(Boolean)
    )
  )).sort((a, b) => compareGroupValue(a, b))

  const matchesOrderFilters = (o) => {
    const grade = String(o?.grade || '').trim()
    const tdc = String(o?.tdc || '').trim()
    if (gradeFilter && grade !== gradeFilter) return false
    if (tdcFilter && tdc !== tdcFilter) return false
    return true
  }

  // Filter
  const filtered = consignees
    .filter(c => {
      const matchesSearch = !search ||
        c.consigneeName.toLowerCase().includes(search.toLowerCase()) ||
        c.consigneeCode.includes(search)
      if (!matchesSearch) return false
      return c.orders.some(o => matchesOrderFilters(o))
    })
    .map(c => {
      const filteredOrders = c.orders.filter(o => matchesOrderFilters(o))
      const orderKeySet = new Set(filteredOrders.map(o => o.ordNo || EMPTY_ORD_KEY))
      const filteredPlates = c.plates.filter(p => orderKeySet.has(p.ordNo || EMPTY_ORD_KEY))

      return {
        ...c,
        _filteredOrders: filteredOrders,
        _filteredPlates: filteredPlates,
        _counts: countPlatesByType(filteredPlates),
      }
    })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const aOk = a.okPlateCount ?? a._counts.OK
    const bOk = b.okPlateCount ?? b._counts.OK
    const aRa = a._counts.RA
    const bRa = b._counts.RA

    if (sortBy === 'plates_desc') {
      if (bOk !== aOk) return bOk - aOk
      if (bRa !== aRa) return bRa - aRa

      const aHasPlates = a._counts.total > 0 ? 1 : 0
      const bHasPlates = b._counts.total > 0 ? 1 : 0
      if (bHasPlates !== aHasPlates) return bHasPlates - aHasPlates

      if (b._counts.TPI !== a._counts.TPI) return b._counts.TPI - a._counts.TPI
      if (b._counts.MTI !== a._counts.MTI) return b._counts.MTI - a._counts.MTI
      if (b._counts.DIV !== a._counts.DIV) return b._counts.DIV - a._counts.DIV
      return a.consigneeName.localeCompare(b.consigneeName)
    }

    if (sortBy === 'plates_asc') {
      if (aOk !== bOk) return aOk - bOk
      if (aRa !== bRa) return aRa - bRa
      return a.consigneeName.localeCompare(b.consigneeName)
    }

    if (sortBy === 'name_asc')    return a.consigneeName.localeCompare(b.consigneeName)
    if (sortBy === 'name_desc')   return b.consigneeName.localeCompare(a.consigneeName)
    if (sortBy === 'orders_desc') return b.orders.length - a.orders.length
    return 0
  })

  // Totals
  const totalOrders = sorted.reduce((s, c) => s + c._filteredOrders.length, 0)
  const totalPlates = sorted.reduce((s, c) => s + c._counts.OK, 0)
  const totalRaPlates = sorted.reduce((s, c) => s + c._counts.RA, 0)
  const totalTpiPlates = sorted.reduce((s, c) => s + c._counts.TPI, 0)
  const totalBal = sorted.reduce((s, c) => s + c._filteredOrders.reduce((oo, o) => oo + (o.bal || 0), 0), 0)

  return (
    <AppShell pageTitle="Loading Report">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── Filter bar ── */}
        <div className="card">
          <div className="card-body" style={{ padding: '14px 18px' }}>
            <div className="form-row" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
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
                    onChange={e => {
                      setSelectedDest(e.target.value)
                      setFetched(false)
                      setConsignees([])
                      setGradeFilter('')
                      setTdcFilter('')
                      setDetailsModal(null)
                      setNoPlateExpandedByConsignee({})
                    }}
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
                  <option value="plates_desc">OK Plates ↓, then RA ↓</option>
                  <option value="plates_asc">OK Plates ↑, then RA ↑</option>
                  <option value="orders_desc">Orders ↓</option>
                  <option value="name_asc">Name A–Z</option>
                  <option value="name_desc">Name Z–A</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                <label className="form-label" htmlFor="rpt-grade-filter">Grade</label>
                <select
                  id="rpt-grade-filter"
                  className="form-control"
                  value={gradeFilter}
                  onChange={e => {
                    setGradeFilter(e.target.value)
                    setExpanded(new Set())
                    setNoPlateExpandedByConsignee({})
                  }}
                >
                  <option value="">All Grades</option>
                  {gradeOptions.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
                <label className="form-label" htmlFor="rpt-tdc-filter">TDC</label>
                <select
                  id="rpt-tdc-filter"
                  className="form-control"
                  value={tdcFilter}
                  onChange={e => {
                    setTdcFilter(e.target.value)
                    setExpanded(new Set())
                    setNoPlateExpandedByConsignee({})
                  }}
                >
                  <option value="">All TDC</option>
                  {tdcOptions.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
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
            <div className="stat-grid" style={{ flex: 1, gridTemplateColumns: 'repeat(6, minmax(110px, 1fr))', gap: 8 }}>
              <div className="stat-tile" style={{ padding: '10px 14px' }}>
                <div className="stat-label">Consignees</div>
                <div className="stat-value" style={{ fontSize: 18 }}>{sorted.length}</div>
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
                <div className="stat-label">RA Plates</div>
                <div className="stat-value" style={{ fontSize: 18, color: 'var(--amber-700)' }}>{totalRaPlates}</div>
              </div>
              <div className="stat-tile" style={{ padding: '10px 14px' }}>
                <div className="stat-label">TPI Plates</div>
                <div className="stat-value" style={{ fontSize: 18, color: 'var(--sky-600)' }}>{totalTpiPlates}</div>
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
          const platesByType = groupPlatesByType(c._filteredPlates)
          const orderPlateStats = summarizeOrderPlates(c._filteredPlates)
          const emptyCounts = createEmptyPlateCounts()

          const okPlates = platesByType.OK
          const isOpen = expanded.has(c.consigneeCode)
          const okCount = c._counts.OK
          const raCount = c._counts.RA
          const tpiCount = c._counts.TPI
          const ordCount = c._filteredOrders.length
          const totalBal_c = c._filteredOrders.reduce((s, o) => s + (o.bal || 0), 0)
          const noPlateExpanded = Boolean(noPlateExpandedByConsignee[c.consigneeCode])

          const sortedOrders = [...c._filteredOrders].sort((o1, o2) => {
            const p1 = orderPlateStats[o1.ordNo || EMPTY_ORD_KEY] || emptyCounts
            const p2 = orderPlateStats[o2.ordNo || EMPTY_ORD_KEY] || emptyCounts

            // Grouping hierarchy: Grade -> TDC -> Size
            const byGrade = compareGroupValue(o1.grade, o2.grade)
            if (byGrade !== 0) return byGrade

            const byTdc = compareGroupValue(o1.tdc, o2.tdc)
            if (byTdc !== 0) return byTdc

            const bySize = compareGroupValue(o1.ordSize, o2.ordSize)
            if (bySize !== 0) return bySize

            // Within each group, keep plate-rich rows first.
            if (p2.OK !== p1.OK) return p2.OK - p1.OK
            if (p2.RA !== p1.RA) return p2.RA - p1.RA

            const hasAny1 = p1.total > 0 ? 1 : 0
            const hasAny2 = p2.total > 0 ? 1 : 0
            if (hasAny2 !== hasAny1) return hasAny2 - hasAny1

            if (p2.TPI !== p1.TPI) return p2.TPI - p1.TPI
            if (p2.MTI !== p1.MTI) return p2.MTI - p1.MTI
            if (p2.DIV !== p1.DIV) return p2.DIV - p1.DIV

            return compareGroupValue(o1.ordNo, o2.ordNo)
          })

          const noPlateOrders = sortedOrders.filter(o => {
            const orderCounts = orderPlateStats[o.ordNo || EMPTY_ORD_KEY] || emptyCounts
            return orderCounts.total === 0 && !hasOrderInfo(o)
          })

          const visibleOrders = sortedOrders.filter(o => {
            const orderCounts = orderPlateStats[o.ordNo || EMPTY_ORD_KEY] || emptyCounts
            return !(orderCounts.total === 0 && !hasOrderInfo(o))
          })

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
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {okCount > 0 && <TypeCountBadge type="OK" count={okCount} compact />}
                    {raCount > 0 && <TypeCountBadge type="RA" count={raCount} compact />}
                    {tpiCount > 0 && <TypeCountBadge type="TPI" count={tpiCount} compact />}
                    {c._counts.MTI > 0 && <TypeCountBadge type="MTI" count={c._counts.MTI} compact />}
                    {c._counts.DIV > 0 && <TypeCountBadge type="DIV" count={c._counts.DIV} compact />}
                  </div>
                </div>
                {/* Quick stats */}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>OK Plates</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: okCount > 0 ? 'var(--green-700)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{okCount}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>RA Plates</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: raCount > 0 ? 'var(--amber-700)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{raCount}</div>
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
              {/* developed by ishans2404@gmail.com */}
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
                          <th style={{ textAlign: 'right' }}>RA</th>
                          <th style={{ textAlign: 'right' }}>TPI</th>
                          <th style={{ textAlign: 'right' }}>OK Plates</th>
                          <th style={{ textAlign: 'right' }}>Non-OK Mix</th>
                          <th>Remark</th>
                          <th>Plate Info</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleOrders.map((o, i) => {
                          const prev = i > 0 ? visibleOrders[i - 1] : null
                          const sameGrade = Boolean(prev) && compareGroupValue(prev.grade, o.grade) === 0
                          const sameTdc = sameGrade && compareGroupValue(prev.tdc, o.tdc) === 0
                          const sameSize = sameTdc && compareGroupValue(prev.ordSize, o.ordSize) === 0
                          const startsGroup = !sameSize

                          const orderCounts = orderPlateStats[o.ordNo || EMPTY_ORD_KEY] || emptyCounts
                          const okForOrder = orderCounts.OK
                          const hasParsedPlates = orderCounts.total > 0
                          const hasInfo = hasParsedPlates || hasOrderInfo(o)
                          const orderPlates = c._filteredPlates.filter(p => p.ordNo === o.ordNo)
                          const nonOkTypes = ['RA', 'TPI', 'MTI', 'DIV'].filter(type => orderCounts[type] > 0)

                          return (
                            <tr
                              key={`${o.ordNo}-${i}`}
                              style={startsGroup && i !== 0 ? { boxShadow: 'inset 0 2px 0 var(--navy-100)' } : undefined}
                            >
                              <td className="td-mono" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{o.ordNo}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div style={{ fontWeight: 600, color: 'var(--navy-600)', fontSize: 11.5, opacity: sameGrade ? 0.72 : 1 }}>
                                  {o.grade}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{o.ordType} · {o.usageGrp}</div>
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, opacity: sameSize ? 0.72 : 1 }}>
                                  {o.ordSize}
                                </div>
                                {o.pcWgt && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{o.pcWgt}T/pc · NOP:{o.nop}</div>}
                              </td>
                              <td style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap', opacity: sameTdc ? 0.72 : 1 }}>{o.tdc}</td>
                              <td style={{ fontSize: 11 }}>{o.colourCd || '—'}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.ord}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.desp}</td>
                              <td className="td-mono" style={{ textAlign: 'right', fontWeight: 600, color: o.bal > 0 ? 'var(--navy-600)' : 'var(--text-muted)' }}>{o.bal}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.test ?? '—'}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.norm ?? '—'}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.fin ?? '—'}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.ra ?? '—'}</td>
                              <td className="td-mono" style={{ textAlign: 'right' }}>{o.tpi ?? '—'}</td>
                              <td style={{ textAlign: 'right' }}>
                                {okForOrder > 0
                                  ? <span className="badge badge-success">{okForOrder}</span>
                                  : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                                }
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                {nonOkTypes.length > 0 ? (
                                  <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                                    {nonOkTypes.map(type => (
                                      <TypeCountBadge key={`${o.ordNo}-${type}`} type={type} count={orderCounts[type]} compact />
                                    ))}
                                  </div>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                                )}
                              </td>
                              <td style={{ fontSize: 11, color: 'var(--amber-700)' }}>
                                {[o.remart, o.ordPr].filter(Boolean).join(' · ') || '—'}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                {hasInfo ? (
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setDetailsModal({
                                      consigneeCode: c.consigneeCode,
                                      consigneeName: c.consigneeName,
                                      order: o,
                                      orderCounts,
                                      orderPlates,
                                    })}
                                  >
                                    <InfoIcon size={13} /> View
                                  </button>
                                ) : (
                                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {noPlateOrders.length > 0 && (
                    <div style={{
                      borderTop: '1px dashed var(--border-default)',
                      padding: '10px 16px',
                      background: 'var(--gray-50)',
                    }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleNoPlateOrders(c.consigneeCode)}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
                      >
                        <span style={{
                          display: 'inline-flex',
                          transform: noPlateExpanded ? 'rotate(90deg)' : 'none',
                          transition: '150ms',
                          color: 'var(--text-muted)',
                        }}>
                          <ChevronIcon size={12} />
                        </span>
                        {noPlateExpanded ? 'Hide' : 'Show'} {noPlateOrders.length} order{noPlateOrders.length > 1 ? 's' : ''} without plate details
                      </button>

                      {noPlateExpanded && (
                        <div className="table-wrapper" style={{ marginTop: 8, border: '1px solid var(--border-subtle)', borderRadius: 'var(--r-md)' }}>
                          <table className="data-table" style={{ fontSize: 11.5 }}>
                            <thead>
                              <tr>
                                <th>Order No.</th>
                                <th>Grade</th>
                                <th>Size (mm)</th>
                                <th>TDC</th>
                                <th style={{ textAlign: 'right' }}>Ord</th>
                                <th style={{ textAlign: 'right' }}>Desp</th>
                                <th style={{ textAlign: 'right' }}>Bal</th>
                                <th>Remark</th>
                              </tr>
                            </thead>
                            <tbody>
                              {noPlateOrders.map((o, i) => (
                                <tr key={`noplate-${o.ordNo || 'row'}-${i}`}>
                                  <td className="td-mono" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{o.ordNo || '—'}</td>
                                  <td style={{ whiteSpace: 'nowrap' }}>
                                    <div style={{ fontWeight: 600, color: 'var(--navy-600)', fontSize: 11.5 }}>{o.grade || '—'}</div>
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{o.ordType || '—'} · {o.usageGrp || '—'}</div>
                                  </td>
                                  <td style={{ whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{o.ordSize || '—'}</td>
                                  <td style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{o.tdc || '—'}</td>
                                  <td className="td-mono" style={{ textAlign: 'right' }}>{o.ord ?? '—'}</td>
                                  <td className="td-mono" style={{ textAlign: 'right' }}>{o.desp ?? '—'}</td>
                                  <td className="td-mono" style={{ textAlign: 'right', fontWeight: 600, color: o.bal > 0 ? 'var(--navy-600)' : 'var(--text-muted)' }}>{o.bal ?? '—'}</td>
                                  <td style={{ fontSize: 11, color: 'var(--amber-700)' }}>{[o.remart, o.ordPr].filter(Boolean).join(' · ') || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

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

                  {/* Non-OK sections (RA / TPI / MTI / DIV) */}
                  {['RA', 'TPI', 'MTI', 'DIV'].map(type => {
                    const plates = platesByType[type]
                    if (!plates.length) return null
                    const meta = PLATE_SECTION_META[type]

                    return (
                      <div key={`${c.consigneeCode}-${type}`} style={{ background: meta.bg, borderTop: `1px solid ${meta.border}`, padding: '10px 16px' }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: meta.text, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                          {meta.title} ({plates.length})
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {plates.map((p, idx) => (
                            <div key={`${type}-${p.plateNo}-${idx}`} style={{
                              padding: '4px 10px',
                              background: 'var(--bg-surface)',
                              border: `1px solid ${meta.border}`,
                              borderRadius: 'var(--r-md)',
                              fontSize: 11.5,
                              fontFamily: 'var(--font-mono)',
                              fontWeight: 600,
                              color: meta.text,
                            }}>
                              {p.plateNo}
                              <span style={{ fontFamily: 'var(--font)', fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 5 }}>
                                {p.heatNo} · {p.grade}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
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

        <OrderInfoModal detailsModal={detailsModal} onClose={() => setDetailsModal(null)} />
      </div>
    </AppShell>
  )
}

function TypeCountBadge({ type, count, compact = false }) {
  const meta = PLATE_TYPE_META[type] || PLATE_TYPE_META.DIV
  const padding = compact ? '1px 6px' : '2px 8px'
  const fontSize = compact ? 10.5 : 11

  return (
    <span className="badge" style={{ padding, fontSize, background: meta.bg, color: meta.color }}>
      <span className="badge-dot" style={{ background: meta.dot }} />
      {compact ? `${meta.label} ${count}` : `${meta.label}: ${count}`}
    </span>
  )
}

function OrderInfoModal({ detailsModal, onClose }) {
  const isOpen = Boolean(detailsModal)
  const order = detailsModal?.order
  const counts = detailsModal?.orderCounts || createEmptyPlateCounts()
  const orderPlates = detailsModal?.orderPlates || []
  const hasParsedPlates = orderPlates.length > 0
  const parsedPlatesByType = groupPlatesByType(orderPlates)
  const platesRaw = cleanRawValue(order?.platesRaw)
  const heatInfoEntries = getOrderHeatInfoEntries(order)

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="modal-lg"
      title={order ? `Order ${order.ordNo} - Plate Details` : 'Plate Details'}
      footer={<button className="btn btn-primary btn-sm" onClick={onClose}>Close</button>}
    >
      {order && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--bg-surface-2)',
            padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              <TypeCountBadge type="OK" count={counts.OK} />
              {counts.RA > 0 && <TypeCountBadge type="RA" count={counts.RA} />}
              {counts.TPI > 0 && <TypeCountBadge type="TPI" count={counts.TPI} />}
              {counts.MTI > 0 && <TypeCountBadge type="MTI" count={counts.MTI} />}
              {counts.DIV > 0 && <TypeCountBadge type="DIV" count={counts.DIV} />}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, fontSize: 11.5 }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Consignee:</span> <strong>{detailsModal.consigneeCode}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Grade:</span> <strong>{order.grade || '—'}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>Size:</span> <strong>{order.ordSize || '—'}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>TDC:</span> <strong>{order.tdc || '—'}</strong></div>
            </div>
          </div>

          {hasParsedPlates ? (
            <div style={{
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--r-lg)',
              background: 'var(--bg-surface)',
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                Plate Type Sections
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {PLATE_TYPES.map(type => {
                  const plates = parsedPlatesByType[type]
                  if (!plates.length) return null

                  const meta = PLATE_SECTION_META[type] || PLATE_SECTION_META.DIV
                  const typeTitle = type === 'MTI' ? 'MTI Plates' : `${type} Plates`

                  return (
                    <div key={`modal-type-${type}`} style={{
                      border: `1px solid ${meta.border}`,
                      borderRadius: 'var(--r-md)',
                      background: meta.bg,
                      padding: '9px 10px',
                    }}>
                      <div style={{ fontSize: 10.5, color: meta.text, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>
                        {typeTitle} ({plates.length})
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {plates.map((p, idx) => (
                          <div key={`${type}-${p.plateNo}-${idx}`} style={{
                            padding: '4px 9px',
                            background: 'var(--bg-surface)',
                            border: `1px solid ${meta.border}`,
                            borderRadius: 'var(--r-md)',
                            fontSize: 11,
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                            color: meta.text,
                          }}>
                            {p.plateNo}
                            <span style={{ fontFamily: 'var(--font)', fontSize: 10, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 5 }}>
                              {p.heatNo || '—'} · {p.grade || '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <>
              <div style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--r-lg)',
                background: 'var(--bg-surface)',
                padding: '12px 14px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  PLATES Raw
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: platesRaw ? 'var(--text-primary)' : 'var(--text-muted)',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {platesRaw || 'No PLATES raw content for this order.'}
                </div>
              </div>

              <div style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--r-lg)',
                background: 'var(--bg-surface)',
                padding: '12px 14px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
                  Plates / Heat Info
                </div>

                {heatInfoEntries.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No heat/TPI/MTI/DIV details available for this order.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {heatInfoEntries.map(entry => (
                      <div key={entry.key} style={{
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 'var(--r-md)',
                        padding: '8px 10px',
                        background: 'var(--bg-surface-2)',
                      }}>
                        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}>
                          {entry.label}
                        </div>
                        <div style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          lineHeight: 1.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          color: 'var(--text-primary)',
                        }}>
                          {entry.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
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
function InfoIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <line x1="12" y1="10" x2="12" y2="16"/>
    <circle cx="12" cy="7" r="1" fill="currentColor" stroke="none"/>
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