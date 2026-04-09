import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import AppShell from '../components/layout/AppShell.jsx'
import {
  fetchLoadingReport,
  fetchLoadedDetails,
  fetchPlateInfo,
  submitWagonLoad,
} from '../api/index.js'
import {
  generateLoadingPdf,
  exportSessionJson,
  buildWagonPayloads,
  submitWagonRequests,
} from '../utils/export.js'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const PLATE_TYPE_CFG = {
  OK:  { label: 'OK',  bg: null,                   color: null,                   desc: 'Ready to load' },
  RA:  { label: 'RA',  bg: 'var(--amber-100)',      color: 'var(--amber-700)',      desc: 'Result Awaited' },
  TPI: { label: 'TPI', bg: 'var(--sky-100)',        color: 'var(--sky-600)',        desc: 'Third Party Inspection' },
  MTI: { label: 'MTI', bg: 'var(--orange-100)',     color: 'var(--orange-700)',     desc: 'MTI Hold' },
  DIV: { label: 'DIV', bg: 'var(--gray-100)',       color: 'var(--gray-700)',       desc: 'Diversion' },
}

export default function RakeModificationPage() {
  const toast    = useToast()
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const state    = location.state || {}
  const rakeId   = String(state.prefillRakeId || '').toUpperCase()
  const rakeInfo = state.prefillRakeInfo || null

  const [isLoading,  setIsLoading]  = useState(true)
  const [loadError,  setLoadError]  = useState(null)
  const [sessions,   setSessions]   = useState({})
  const [session,    setSession]    = useState(null)
  const [selectedDest, setSelectedDest] = useState(null)
  const [wagons,     setWagons]     = useState([])
  const [isCompleted, setIsCompleted] = useState(false)

  const [activeCode,        setActiveCode]        = useState(null)
  const [activeWagon,       setActiveWagon]       = useState(null)
  const [plateFilter,       setPlateFilter]       = useState('')
  const [showNonOk,         setShowNonOk]         = useState(true)
  const [consigneeSearch,   setConsigneeSearch]   = useState('')
  const [wagonSearch,       setWagonSearch]       = useState('')
  const [quickEntry,        setQuickEntry]        = useState('')
  const [quickError,        setQuickError]        = useState('')
  const [quickResult,       setQuickResult]       = useState(null)
  const [isFetchingPlate,   setIsFetchingPlate]   = useState(false)
  const [plateDetail,       setPlateDetail]       = useState(null)
  const [exporting,         setExporting]         = useState(false)
  const [addWagonInput,     setAddWagonInput]     = useState('')
  const [showAddWagon,      setShowAddWagon]      = useState(false)
  const [submission, setSubmission] = useState({
    status: 'idle', succeeded: 0, failed: 0, total: 0, failedPayloads: [],
  })

  const quickEntryRef  = useRef(null)
  const quickDebounceRef = useRef(null)

  useEffect(() => {
    if (!rakeId || !rakeInfo) {
      setLoadError('Missing rake information. Please go back and try again.')
      setIsLoading(false)
      return
    }
    loadAllData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadAllData() {
    setIsLoading(true)
    try {
      const destinations = rakeInfo?.destinations || []
      if (!destinations.length) throw new Error('No destinations found for this rake.')

      const [loadedRaw, ...reports] = await Promise.all([
        fetchLoadedDetails(rakeId),
        ...destinations.map(d => fetchLoadingReport(d.code).catch(() => [])),
      ])

      const reportMap = {}
      destinations.forEach((d, i) => { reportMap[d.code] = reports[i] })

      // plate -> { wagonNo, destCode } from loaded details
      const plateWagonMap = {}
      const wagonInfoMap  = {}   // wagonNo -> { custName, destCode }
      if (Array.isArray(loadedRaw)) {
        for (const row of loadedRaw) {
          const wNo   = (row.DISPATCH_NM   || '').trim()
          const pNo   = (row.CHILD_PLATE_NO || '').trim()
          const cust  = (row.CUST_NM       || '').trim()
          const dCd   = (row.WAGON_DEST_CD || '').trim()
          if (wNo && pNo)  plateWagonMap[pNo] = { wagonNo: wNo, destCode: dCd }
          if (wNo && !wagonInfoMap[wNo]) wagonInfoMap[wNo] = { custName: cust, destCode: dCd }
        }
      }

      // consigneeName -> consigneeCode (global across all destinations)
      const nameToCode = {}
      for (const report of Object.values(reportMap)) {
        for (const c of report) nameToCode[c.consigneeName.toUpperCase()] = c.consigneeCode
      }

      // Build sessions with pre-marked loaded plates
      const newSessions = {}
      for (const dest of destinations) {
        const report = reportMap[dest.code] || []
        const merged = report.map(c => ({
          ...c,
          plates: c.plates.map(p => {
            const entry = plateWagonMap[p.plateNo]
            if (entry) return { ...p, loaded: true, loadedAt: new Date().toISOString(), wagonNo: entry.wagonNo }
            return p
          }),
        }))
        newSessions[dest.code] = {
          rakeId,
          rakeInfo,
          destination: dest,
          consignees:  merged,
          loadingLog:  [],
          step:        'LOADING',
          startedAt:   new Date().toISOString(),
          operatedBy:  user?.username,
        }
      }

      // Build wagons list: prefill from AssignWagonsPage + from loaded details
      const wagonsMap = {}
      const prefillWagons = state.prefillWagons || []
      for (const wNo of prefillWagons) wagonsMap[wNo] = { wagonNo: wNo, consigneeCode: null }
      for (const [wNo, { custName }] of Object.entries(wagonInfoMap)) {
        const code = nameToCode[custName.toUpperCase()] || null
        if (!wagonsMap[wNo]) wagonsMap[wNo] = { wagonNo: wNo, consigneeCode: code }
        else wagonsMap[wNo].consigneeCode = wagonsMap[wNo].consigneeCode || code
      }

      setSessions(newSessions)
      setWagons(Object.values(wagonsMap))

      const firstDest = destinations[0]
      setSelectedDest(firstDest)
      setSession(newSessions[firstDest.code])

      toast.success({ title: 'Modification Mode Ready', message: `Rake ${rakeId} loaded with existing data.` })
    } catch (err) {
      setLoadError(err.message || 'Failed to load rake data.')
      toast.error('Failed to load: ' + (err.message || 'Unknown error'))
    } finally {
      setIsLoading(false)
    }
  }

  const updateSession = useCallback((updater) => {
    setSession(prev => {
      const next = updater(prev)
      setSessions(s => ({ ...s, [next.destination.code]: next }))
      return next
    })
  }, [])

  function handleSwitchDest(dest) {
    if (dest.code === selectedDest?.code) return
    setActiveCode(null); setActiveWagon(null); setPlateFilter('')
    setQuickEntry(''); setQuickError(''); setQuickResult(null)
    setSelectedDest(dest)
    setSession(sessions[dest.code])
  }

  function handleSelectConsignee(code) {
    setActiveCode(code); setPlateFilter('')
    setQuickEntry(''); setQuickError(''); setQuickResult(null)
    if (quickDebounceRef.current) clearTimeout(quickDebounceRef.current)
    const cWagon = wagons.find(w => w.consigneeCode === code)
    setActiveWagon(cWagon ? cWagon.wagonNo : null)
    setTimeout(() => quickEntryRef.current?.focus(), 100)
  }

  function handleSelectWagon(wagonNo) {
    if (!activeCode) { toast.warning('Select a consignee first.'); return }
    const wagon = wagons.find(w => w.wagonNo === wagonNo)
    if (!wagon) return
    if (wagon.consigneeCode && wagon.consigneeCode !== activeCode) {
      const owner = Object.values(sessions).flatMap(s => s.consignees)
        .find(c => c.consigneeCode === wagon.consigneeCode)?.consigneeName || wagon.consigneeCode
      toast.error(`Wagon ${wagonNo} is assigned to ${owner}.`)
      return
    }
    if (!wagon.consigneeCode) {
      setWagons(prev => prev.map(w => w.wagonNo === wagonNo ? { ...w, consigneeCode: activeCode } : w))
      const name = session.consignees.find(c => c.consigneeCode === activeCode)?.consigneeName
      toast.success({ title: 'Wagon Assigned', message: `${wagonNo} → ${name}`, duration: 2000 })
    }
    setActiveWagon(wagonNo)
    setTimeout(() => quickEntryRef.current?.focus(), 100)
  }

  function handleUnlinkWagon(wagonNo) {
    const cnt = session.consignees.find(c => c.consigneeCode === activeCode)
      ?.plates.filter(p => p.wagonNo === wagonNo && p.loaded).length ?? 0
    if (!window.confirm(cnt > 0
      ? `Unlink wagon ${wagonNo}? ${cnt} plate(s) will be unloaded.`
      : `Unlink wagon ${wagonNo}?`)) return
    setWagons(prev => prev.map(w => w.wagonNo === wagonNo ? { ...w, consigneeCode: null } : w))
    updateSession(prev => ({
      ...prev,
      consignees: prev.consignees.map(c =>
        c.consigneeCode === activeCode
          ? { ...c, plates: c.plates.map(p => p.wagonNo === wagonNo && p.loaded ? { ...p, loaded: false, loadedAt: null, wagonNo: null } : p) }
          : c
      ),
    }))
    if (activeWagon === wagonNo) setActiveWagon(null)
    toast.info({ message: `Wagon ${wagonNo} unlinked${cnt > 0 ? `. ${cnt} plate(s) reset.` : '.'}`, duration: 2800 })
  }

  function handleAddWagon() {
    const val = addWagonInput.trim().toUpperCase()
    if (!val) return
    if (wagons.find(w => w.wagonNo === val)) { toast.warning(`Wagon "${val}" already exists.`); return }
    setWagons(prev => [...prev, { wagonNo: val, consigneeCode: null }])
    setAddWagonInput('')
    setShowAddWagon(false)
    toast.success({ message: `Wagon ${val} added.`, duration: 1800 })
  }

  function handleRemoveWagon(wagonNo) {
    const hasLoaded = Object.values(sessions).flatMap(s => s.consignees).flatMap(c => c.plates)
      .some(p => p.wagonNo === wagonNo && p.loaded)
    if (hasLoaded && !window.confirm(`Wagon ${wagonNo} has loaded plates. Remove anyway?`)) return
    setWagons(prev => prev.filter(w => w.wagonNo !== wagonNo))
    // unload plates in all sessions
    setSessions(prev => {
      const next = {}
      for (const [k, s] of Object.entries(prev)) {
        next[k] = { ...s, consignees: s.consignees.map(c => ({ ...c, plates: c.plates.map(p => p.wagonNo === wagonNo ? { ...p, loaded: false, loadedAt: null, wagonNo: null } : p) })) }
      }
      return next
    })
    setSession(prev => ({ ...prev, consignees: prev.consignees.map(c => ({ ...c, plates: c.plates.map(p => p.wagonNo === wagonNo ? { ...p, loaded: false, loadedAt: null, wagonNo: null } : p) })) }))
    if (activeWagon === wagonNo) setActiveWagon(null)
  }

  function togglePlate(consigneeCode, plateNo) {
    const now = new Date().toISOString()
    const c = session.consignees.find(x => x.consigneeCode === consigneeCode)
    if (!c) return
    const plate = c.plates.find(p => p.plateNo === plateNo)
    if (!plate) return
    if (!plate.loaded && !activeWagon && wagons.length > 0) {
      toast.warning('Select a wagon before marking plates as loaded.'); return
    }
    const wagonNo = plate.loaded ? null : activeWagon
    updateSession(prev => ({
      ...prev,
      consignees: prev.consignees.map(cons =>
        cons.consigneeCode === consigneeCode
          ? { ...cons, plates: cons.plates.map(p => p.plateNo === plateNo ? { ...p, loaded: !p.loaded, loadedAt: !p.loaded ? now : null, wagonNo } : p) }
          : cons
      ),
      loadingLog: prev.loadingLog.concat({ timestamp: now, plateNo, consigneeCode, wagonNo: activeWagon, action: plate.loaded ? 'UNLOADED' : 'LOADED' }),
    }))
  }

  function handleQuickInputChange(val) {
    const upper = val.toUpperCase()
    setQuickEntry(upper); setQuickError(''); setQuickResult(null)
    if (quickDebounceRef.current) clearTimeout(quickDebounceRef.current)
    const q = upper.trim()
    if (!q || !activeCode || !session) return
    quickDebounceRef.current = setTimeout(async () => {
      const cons = session.consignees.find(c => c.consigneeCode === activeCode)
      if (!cons) return
      const plate = cons.plates.find(p =>
        p.plateNo.toUpperCase() === q ||
        p.plateNo.toUpperCase() === `OK-${q}` ||
        p.plateNo.toUpperCase().endsWith(q)
      )
      if (plate) { setQuickResult({ type: 'list', plate }); return }
      setIsFetchingPlate(true)
      try {
        const info = await fetchPlateInfo(q)
        if (info) setQuickResult({ type: 'api', apiInfo: info })
        else setQuickError(`Plate "${q}" not found.`)
      } catch { setQuickError(`Could not fetch plate info for "${q}".`) }
      finally { setIsFetchingPlate(false) }
    }, 550)
  }

  function handleQuickLoad() {
    if (!quickResult) return
    if (quickResult.type === 'list') {
      const { plate } = quickResult
      if (plate.loaded) { setQuickError(`${plate.plateNo} is already loaded.`); return }
      if (!activeWagon && wagons.length > 0) { toast.warning('Select a wagon before loading.'); return }
      togglePlate(activeCode, plate.plateNo)
      toast.success({ message: `${plate.plateNo} → Loaded`, duration: 1800 })
    } else {
      if (!activeWagon && wagons.length > 0) { toast.warning('Select a wagon before loading.'); return }
      const { apiInfo } = quickResult
      const now = new Date().toISOString()
      const inferredType = (() => {
        const raw = String(apiInfo.MECH_RESULT || apiInfo.PLATE_TYPE || '').toUpperCase()
        return ['OK', 'RA', 'DIV', 'MTI', 'TPI'].includes(raw) ? raw : 'OK'
      })()
      const newPlate = {
        plateNo: apiInfo.PLATE_NO || quickEntry.trim(), heatNo: apiInfo.HEAT_NO || '',
        plateType: inferredType, ordNo: apiInfo.ORD_NO || '', grade: apiInfo.GRADE || '',
        tdc: apiInfo.TDC || '', colourCd: apiInfo.COLOUR_CD || '', ordSize: apiInfo.PLATE_SIZE || '',
        pcWgt: apiInfo.WGT ? parseFloat(apiInfo.WGT) : null,
        loaded: true, loadedAt: now, wagonNo: activeWagon, _manual: true,
      }
      updateSession(prev => ({
        ...prev,
        consignees: prev.consignees.map(c =>
          c.consigneeCode === activeCode
            ? { ...c, plates: [...c.plates, newPlate], okPlateCount: inferredType === 'OK' ? (c.okPlateCount ?? 0) + 1 : (c.okPlateCount ?? 0) }
            : c
        ),
        loadingLog: prev.loadingLog.concat({ timestamp: now, plateNo: newPlate.plateNo, consigneeCode: activeCode, wagonNo: activeWagon, action: 'LOADED' }),
      }))
      toast.success({ message: `${newPlate.plateNo} → Loaded (manual)`, duration: 2200 })
    }
    setQuickEntry(''); setQuickResult(null); setQuickError('')
    quickEntryRef.current?.focus()
  }

  async function handlePlateDetail(p) {
    if (plateDetail?.plateNo === p.plateNo) { setPlateDetail(null); return }
    setPlateDetail(p)
    try {
      const info = await fetchPlateInfo(p.plateNo)
      if (info) setPlateDetail(prev => prev?.plateNo === p.plateNo ? { ...prev, _apiInfo: info } : prev)
    } catch {}
  }

  async function handleSaveModifications() {
    const allSessions = { ...sessions, [session.destination.code]: session }
    const wagonsLoaded = Array.from(new Set(
      Object.values(allSessions).flatMap(s => s.consignees).flatMap(c => c.plates)
        .filter(p => p.loaded && p.wagonNo).map(p => p.wagonNo)
    )).length
    if (!window.confirm(`Submit modifications? ${wagonsLoaded} wagon record(s) will be updated.`)) return
    const done = { ...session, allSessions, wagons, completedAt: new Date().toISOString(), step: 'COMPLETED' }
    setSession(done); setSessions(allSessions); setIsCompleted(true)
    const payloads = buildWagonPayloads(done)
    if (!payloads.length) return
    setSubmission({ status: 'submitting', succeeded: 0, failed: 0, total: payloads.length, failedPayloads: [] })
    const results = await submitWagonRequests(payloads, submitWagonLoad, ({ succeeded, failed, total }) => {
      setSubmission(prev => ({ ...prev, succeeded, failed, total }))
    })
    setSubmission({
      status: results.failed.length === 0 ? 'done' : 'partial',
      succeeded: results.succeeded.length, failed: results.failed.length, total: payloads.length,
      failedPayloads: results.failed.map(f => f.payload),
    })
  }

  async function handleRetrySubmission() {
    const payloads = submission.failedPayloads
    if (!payloads.length) return
    setSubmission(prev => ({ ...prev, status: 'submitting', succeeded: 0, failed: 0, total: payloads.length, failedPayloads: [] }))
    const results = await submitWagonRequests(payloads, submitWagonLoad, ({ succeeded, failed, total }) => {
      setSubmission(prev => ({ ...prev, succeeded, failed, total }))
    })
    setSubmission({
      status: results.failed.length === 0 ? 'done' : 'partial',
      succeeded: results.succeeded.length, failed: results.failed.length, total: payloads.length,
      failedPayloads: results.failed.map(f => f.payload),
    })
  }

  async function handleExportPdf() {
    setExporting(true)
    try {
      const allSessions = { ...sessions, [session.destination.code]: session }
      await generateLoadingPdf({ ...session, allSessions, wagons })
    } catch (e) { toast.error('PDF failed: ' + e.message) }
    finally { setExporting(false) }
  }

  // ── Derived ──────────────────────────────────────────────────────
  const activeConsignee = session?.consignees.find(c => c.consigneeCode === activeCode)
  const filteredConsignees = (session?.consignees ?? []).filter(c => {
    if (!consigneeSearch) return true
    const q = consigneeSearch.toLowerCase()
    return c.consigneeName.toLowerCase().includes(q) || c.consigneeCode.toLowerCase().includes(q)
  })
  const filteredWagons = wagons.filter(w => {
    if (!wagonSearch) return true
    const q = wagonSearch.toLowerCase()
    return w.wagonNo.toLowerCase().includes(q) || (w.consigneeCode || '').toLowerCase().includes(q)
  })
  const allActivePlates  = activeConsignee?.plates ?? []
  const okPlates         = allActivePlates.filter(p => p.plateType === 'OK')
  const nonOkPlates      = allActivePlates.filter(p => p.plateType !== 'OK')
  const sortPlates = arr => arr.sort((a, b) => {
    if (a.loaded !== b.loaded) return a.loaded ? -1 : 1
    return (a.wagonNo || '').localeCompare(b.wagonNo || '')
  })
  const visibleOkPlates = sortPlates(okPlates.filter(p => {
    if (!plateFilter) return true
    const q = plateFilter.toLowerCase()
    return p.plateNo.toLowerCase().includes(q) || p.grade.toLowerCase().includes(q) || (p.heatNo || '').toLowerCase().includes(q)
  }))
  const visibleNonOkPlates = showNonOk ? sortPlates(nonOkPlates.filter(p => {
    if (!plateFilter) return true
    const q = plateFilter.toLowerCase()
    return p.plateNo.toLowerCase().includes(q) || p.grade.toLowerCase().includes(q) || (p.heatNo || '').toLowerCase().includes(q)
  })) : []
  const loadedPlates = session?.consignees.reduce((s, c) => s + c.plates.filter(p => p.loaded).length, 0) ?? 0

  const completedAllSessions = isCompleted && session?.allSessions ? session.allSessions : session ? { [session.destination?.code]: session } : {}
  const completedConsignees = Object.values(completedAllSessions).flatMap(s => (s.consignees || []).map(c => ({ ...c, _destination: s.destination })))
  const completedLoaded = completedConsignees.reduce((s, c) => s + c.plates.filter(p => p.loaded).length, 0)
  const completedWeight = completedConsignees.reduce((s, c) => s + c.plates.filter(p => p.loaded && p.pcWgt).reduce((ws, p) => ws + (parseFloat(p.pcWgt) || 0), 0), 0)
  const wagonSummary = (() => {
    const wm = {}
    Object.values(completedAllSessions).forEach(sess => {
      if (!sess) return
      sess.consignees?.forEach(c => c.plates?.forEach(p => {
        if (!p.loaded || !p.wagonNo) return
        if (!wm[p.wagonNo]) wm[p.wagonNo] = { wagonNo: p.wagonNo, consigneeCode: c.consigneeCode, consigneeName: c.consigneeName, destination: sess.destination, platesCount: 0, totalWeight: 0 }
        wm[p.wagonNo].platesCount++
        if (p.pcWgt) wm[p.wagonNo].totalWeight += parseFloat(p.pcWgt) || 0
      }))
    })
    return Object.values(wm).sort((a, b) => a.wagonNo.localeCompare(b.wagonNo))
  })()

  // ── Render ────────────────────────────────────────────────────────
  if (isLoading) return (
    <AppShell pageTitle="Rake Modification">
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flex:1, gap:12, minHeight:300 }}>
        <span className="spinner spinner-lg" />
        <span style={{ fontSize:13, color:'var(--text-muted)' }}>Loading modification data for Rake {rakeId}…</span>
      </div>
    </AppShell>
  )

  if (loadError) return (
    <AppShell pageTitle="Rake Modification">
      <div className="card" style={{ maxWidth:480, margin:'40px auto' }}>
        <div className="card-body">
          <div className="alert alert-danger"><WarnIcon /><span>{loadError}</span></div>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)} style={{ marginTop:12 }}>← Go Back</button>
        </div>
      </div>
    </AppShell>
  )

  if (isCompleted) return (
    <AppShell pageTitle="Rake Modification">
      <div style={{ maxWidth:700, margin:'0 auto', display:'flex', flexDirection:'column', gap:16 }}>
        <div className="card" style={{ border:'2px solid var(--navy-200)' }}>
          <div className="card-header" style={{ background:'var(--navy-50)' }}>
            <div className="card-icon" style={{ background:'var(--green-100)', color:'var(--green-700)' }}><CheckCircleIcon /></div>
            <div>
              <div className="card-title" style={{ color:'var(--green-700)' }}>Modifications Saved</div>
              <div className="card-subtitle">Rake {rakeId}</div>
            </div>
            <span className="badge badge-success" style={{ marginLeft:'auto' }}><span className="badge-dot" />Submitted</span>
          </div>
          <div className="card-body">
            {submission.status !== 'idle' && (
              <div style={{ marginBottom:16 }}>
                {submission.status === 'submitting' && (
                  <div className="alert alert-info" style={{ alignItems:'center', gap:10 }}>
                    <span className="spinner spinner-sm" />
                    <span>Submitting… {submission.succeeded + submission.failed} / {submission.total}</span>
                  </div>
                )}
                {submission.status === 'done' && (
                  <div className="alert alert-success"><CheckCircleIcon size={15} /><span>All {submission.succeeded} wagon record(s) submitted successfully.</span></div>
                )}
                {submission.status === 'partial' && (
                  <div className="alert alert-danger" style={{ flexDirection:'column', gap:8, alignItems:'flex-start' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}><WarnIcon size={15} /><span><strong>{submission.failed} of {submission.total}</strong> submissions failed. {submission.succeeded} succeeded.</span></div>
                    <button className="btn btn-danger btn-sm" onClick={handleRetrySubmission} disabled={submission.status === 'submitting'}>Retry Failed ({submission.failed})</button>
                  </div>
                )}
              </div>
            )}
            <div className="stat-grid" style={{ marginBottom:20 }}>
              <div className="stat-tile"><div className="stat-label">Plates Loaded</div><div className="stat-value" style={{ color:'var(--green-700)' }}>{completedLoaded}</div></div>
              <div className="stat-tile"><div className="stat-label">Weight (T)</div><div className="stat-value">{completedWeight.toFixed(2)}</div></div>
              <div className="stat-tile"><div className="stat-label">Wagons</div><div className="stat-value">{wagonSummary.length}</div></div>
            </div>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={handleExportPdf} disabled={exporting}>
                {exporting ? <><span className="spinner spinner-sm" />Generating…</> : <>↓ Download PDF</>}
              </button>
              <button className="btn btn-secondary" onClick={() => exportSessionJson({ ...session, allSessions: completedAllSessions, wagons })}>Export JSON</button>
              <button className="btn btn-ghost" onClick={() => navigate('/home')}>← Dashboard</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div className="card-title">Wagon Summary</div></div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr><th>Wagon No.</th><th>Cons. Code</th><th>Consignee Name</th><th>Destination</th><th>Plates</th><th>Weight (T)</th></tr>
              </thead>
              <tbody>
                {wagonSummary.map(w => (
                  <tr key={w.wagonNo}>
                    <td className="td-mono" style={{ fontWeight:600 }}>{w.wagonNo}</td>
                    <td style={{ fontSize:12 }}>{w.consigneeCode}</td>
                    <td>{w.consigneeName}</td>
                    <td>{w.destination ? `${w.destination.name} (${w.destination.code})` : '—'}</td>
                    <td className="td-mono" style={{ color:'var(--green-700)', fontWeight:600 }}>{w.platesCount}</td>
                    <td className="td-mono">{w.totalWeight > 0 ? `${w.totalWeight.toFixed(1)}T` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  )

  return (
    <AppShell pageTitle="Rake Modification">
      <div style={{ display:'flex', flexDirection:'column', gap:12, flex:1, minHeight:0 }}>
        {/* ── Top bar ── */}
        <div style={{ display:'flex', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <div style={{ background:'var(--amber-100)', border:'1px solid #fde68a', borderRadius:'var(--r-md)', padding:'4px 12px', fontSize:12, fontWeight:600, color:'var(--amber-700)', display:'flex', alignItems:'center', gap:6 }}>
            <EditIcon size={12} /> Modification Mode
          </div>
          <div className="info-row" style={{ flex:1 }}>
            <div className="info-item">
              <span className="info-label">Rake</span>
              <span className="info-value mono" style={{ fontSize:13 }}>{rakeId}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Dest</span>
              <span className="dest-chip"><DestIcon size={12} />{session?.destination?.name} ({session?.destination?.code})</span>
            </div>
            <div className="info-item">
              <span className="info-label">Loaded</span>
              <span className="info-value">{loadedPlates} plates</span>
            </div>
          </div>
          {/* Destination tabs for multi-dest rakes */}
          {rakeInfo?.destinations?.length > 1 && (
            <div style={{ display:'flex', gap:4 }}>
              {rakeInfo.destinations.map(d => {
                const ds = sessions[d.code]
                const dl = ds ? ds.consignees.reduce((a, c) => a + c.plates.filter(p => p.loaded).length, 0) : 0
                return (
                  <button key={d.code}
                    className={`btn btn-sm ${selectedDest?.code === d.code ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => handleSwitchDest(d)} style={{ fontSize:11.5 }}
                  >
                    {d.name}
                    {ds && <span style={{ marginLeft:5, fontFamily:'var(--font-mono)', fontSize:10, opacity:.8 }}>{dl}</span>}
                  </button>
                )
              })}
            </div>
          )}
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/home')}><HomeIcon /> Dashboard</button>
            <button className="btn btn-accent" onClick={handleSaveModifications}>
              <CheckIcon size={13} /> Save Modifications
            </button>
          </div>
        </div>

        {/* ── Main layout (same as LoadingOperationsPage) ── */}
        <div className="loading-layout" style={{ flex:1, minHeight:0 }}>
          {/* Left panel: consignees + wagons */}
          <div className="card consignee-panel" style={{ display:'flex', flexDirection:'column', overflow:'hidden' }}>
            <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }} className="consignee-wagons-layout">

              {/* Consignees column */}
              <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0, borderRight:'1px solid var(--border-subtle)' }} className="consignee-column">
                <div style={{ padding:'8px 10px', borderBottom:'1px solid var(--border-subtle)', flexShrink:0 }}>
                  <div style={{ fontWeight:600, fontSize:11.5, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4 }}>
                    Consignees ({filteredConsignees.length})
                  </div>
                  <div className="search-input-wrapper">
                    <span className="search-icon"><SearchIcon size={12} /></span>
                    <input className="form-control" placeholder="Search…" value={consigneeSearch}
                      onChange={e => setConsigneeSearch(e.target.value)}
                      style={{ fontSize:11.5, padding:'4px 8px 4px 26px' }} />
                  </div>
                </div>
                <div className="consignee-list" style={{ flex:1, overflowY:'auto', padding:'6px 8px' }}>
                  {filteredConsignees.map(c => {
                    const loadedCount  = c.plates.filter(p => p.loaded).length
                    const loadedWeight = c.plates.filter(p => p.loaded && p.pcWgt).reduce((s, p) => s + (parseFloat(p.pcWgt) || 0), 0)
                    const hasOk        = c.plates.some(p => p.plateType === 'OK')
                    const nonOkCnt     = c.plates.filter(p => p.plateType !== 'OK').length
                    const cWagons      = wagons.filter(w => w.consigneeCode === c.consigneeCode)
                    return (
                      <div key={c.consigneeCode}
                        className={`consignee-card ${activeCode === c.consigneeCode ? 'active' : ''} ${loadedCount > 0 ? 'done' : ''}`}
                        onClick={() => handleSelectConsignee(c.consigneeCode)}
                      >
                        <div className="consignee-card-top">
                          <span className="consignee-code-badge">{c.consigneeCode}</span>
                          {loadedCount > 0 && <span className="badge badge-success" style={{ fontSize:10 }}><span className="badge-dot" />{loadedCount} loaded</span>}
                          {!hasOk && <span className="badge badge-neutral" style={{ fontSize:10 }}>No OK</span>}
                        </div>
                        <div className="consignee-name" style={{ marginBottom:7, fontSize:13.5, fontWeight:600 }}>{c.consigneeName}</div>
                        {loadedCount > 0
                          ? <div className="consignee-progress-row" style={{ justifyContent:'space-between' }}>
                              <span className="consignee-count"><strong>{loadedCount}</strong> loaded</span>
                              {loadedWeight > 0 && <span className="consignee-count">{loadedWeight.toFixed(1)}T</span>}
                            </div>
                          : <div style={{ fontSize:11, color:'var(--text-muted)' }}>No plates loaded</div>
                        }
                        {nonOkCnt > 0 && (
                          <div style={{ display:'flex', gap:4, marginTop:5, flexWrap:'wrap' }}>
                            {['RA','TPI','MTI','DIV'].map(type => {
                              const cnt = c.plates.filter(p => p.plateType === type).length
                              if (!cnt) return null
                              const cfg = PLATE_TYPE_CFG[type]
                              return <span key={type} style={{ fontSize:9.5, padding:'1px 6px', borderRadius:'var(--r-full)', background:cfg.bg, color:cfg.color, fontWeight:700 }}>{cnt} {cfg.label}</span>
                            })}
                          </div>
                        )}
                        <div style={{ display:'flex', gap:4, marginTop:5, flexWrap:'wrap', alignItems:'center' }}>
                          <WagonIcon size={11} />
                          {cWagons.length > 0
                            ? cWagons.map(w => <span key={w.wagonNo} style={{ fontSize:10, padding:'1px 6px', borderRadius:'var(--r-full)', background:'var(--navy-100)', color:'var(--navy-700)', fontFamily:'var(--font-mono)', fontWeight:600 }}>{w.wagonNo}</span>)
                            : <span style={{ fontSize:10.5, color:'var(--text-muted)' }}>No wagon</span>
                          }
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Wagons column */}
              <div style={{ width:170, flexShrink:0, display:'flex', flexDirection:'column', overflow:'hidden' }} className="wagons-column">
                <div style={{ padding:'8px 8px', borderBottom:'1px solid var(--border-subtle)', flexShrink:0 }}>
                  <div style={{ fontWeight:600, fontSize:11.5, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:4, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span>Wagons ({wagons.length})</span>
                    <button className="btn btn-ghost btn-icon" style={{ padding:'2px 4px' }} title="Add wagon" onClick={() => setShowAddWagon(v => !v)}>
                      <PlusIcon size={13} />
                    </button>
                  </div>
                  {showAddWagon && (
                    <div style={{ display:'flex', gap:4, marginBottom:6 }}>
                      <input className="form-control mono" placeholder="Wagon No." value={addWagonInput}
                        onChange={e => setAddWagonInput(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && handleAddWagon()}
                        style={{ fontSize:11, padding:'4px 6px', flex:1 }} autoFocus />
                      <button className="btn btn-primary btn-sm btn-icon" onClick={handleAddWagon}><CheckIcon size={11} /></button>
                    </div>
                  )}
                  <div className="search-input-wrapper">
                    <span className="search-icon"><SearchIcon size={12} /></span>
                    <input className="form-control" placeholder="Search…" value={wagonSearch}
                      onChange={e => setWagonSearch(e.target.value)}
                      style={{ fontSize:11.5, padding:'4px 8px 4px 26px' }} />
                  </div>
                </div>
                <div style={{ flex:1, overflowY:'auto', padding:'4px 8px 8px' }}>
                  {filteredWagons.length === 0
                    ? <div style={{ fontSize:11.5, color:'var(--text-muted)', textAlign:'center', padding:'12px 0' }}>No wagons.</div>
                    : <div style={{ display:'flex', flexDirection:'column', gap:4, paddingTop:4 }}>
                        {filteredWagons.map(w => {
                          const isActive     = activeWagon === w.wagonNo
                          const assignedCons = w.consigneeCode
                            ? Object.values(sessions).flatMap(s => s.consignees).find(c => c.consigneeCode === w.consigneeCode)
                            : null
                          const isForActive  = w.consigneeCode === activeCode
                          const canSelect    = !w.consigneeCode || w.consigneeCode === activeCode
                          const platesLoaded = (session?.consignees ?? []).flatMap(c => c.plates).filter(p => p.wagonNo === w.wagonNo && p.loaded).length
                          return (
                            <div key={w.wagonNo} style={{ display:'flex', gap:4, alignItems:'stretch', borderRadius:'var(--r-md)', overflow:'hidden' }}>
                              <div onClick={() => canSelect ? handleSelectWagon(w.wagonNo) : toast.error(`Wagon ${w.wagonNo} is assigned to ${assignedCons?.consigneeName || w.consigneeCode}`)}
                                style={{ flex:'0 0 calc(100% - 32px)', display:'flex', flexDirection:'column', gap:4, padding:'7px 8px', borderRadius:'var(--r-md)',
                                  border:`1.5px solid ${isActive ? 'var(--navy-400)' : canSelect ? 'var(--border-subtle)' : 'var(--border-default)'}`,
                                  background: isActive ? 'var(--navy-100)' : canSelect ? 'var(--bg-surface)' : 'var(--gray-50)',
                                  cursor: canSelect ? 'pointer' : 'not-allowed', opacity: !canSelect ? 0.55 : 1, userSelect:'none' }}>
                                <div style={{ display:'flex', alignItems:'baseline', gap:6 }}>
                                  <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:11.5, color: isActive ? 'var(--navy-700)' : 'var(--text-primary)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1 }}>{w.wagonNo}</span>
                                  {platesLoaded > 0 && <span style={{ fontSize:9.5, color:'var(--green-700)', fontWeight:700 }}>{platesLoaded}p</span>}
                                </div>
                                <div style={{ fontSize:10, color: isForActive ? 'var(--navy-600)' : 'var(--text-muted)', fontWeight: isForActive ? 600 : 400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                  {assignedCons ? assignedCons.consigneeName : <span style={{ fontStyle:'italic' }}>Unassigned</span>}
                                </div>
                              </div>
                              {isForActive && (
                                <button title="Unlink wagon" onClick={e => { e.stopPropagation(); handleUnlinkWagon(w.wagonNo) }}
                                  style={{ flex:'0 0 26px', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--red-50)', border:'1.5px solid var(--red-200)', borderRadius:'var(--r-md)', cursor:'pointer', color:'var(--red-600)', padding:0 }}>
                                  <span style={{ fontSize:16, fontWeight:600, lineHeight:1 }}>×</span>
                                </button>
                              )}
                              {!isForActive && (
                                <button title="Remove wagon" onClick={e => { e.stopPropagation(); handleRemoveWagon(w.wagonNo) }}
                                  style={{ flex:'0 0 26px', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--gray-50)', border:'1.5px solid var(--border-subtle)', borderRadius:'var(--r-md)', cursor:'pointer', color:'var(--text-muted)', padding:0 }}>
                                  <span style={{ fontSize:14, lineHeight:1 }}>–</span>
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                  }
                </div>
              </div>
            </div>
          </div>

          {/* Right panel: plates */}
          <div className="card active-panel" style={{ display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>
            {!activeConsignee ? (
              <div className="empty-state" style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                <div className="empty-state-icon"><SelectIcon size={22} /></div>
                <div className="empty-state-title">Select a Consignee</div>
                <div className="empty-state-text">Click a consignee on the left to view and modify its loaded plates.</div>
              </div>
            ) : (
              <>
                {/* Consignee header */}
                <div style={{ padding:'12px 16px', borderBottom:'1px solid var(--border-subtle)', background:'var(--bg-surface-2)' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                    <span className="consignee-code-badge" style={{ fontSize:13 }}>{activeConsignee.consigneeCode}</span>
                    <span style={{ fontWeight:700, fontSize:15.5, flex:1 }}>{activeConsignee.consigneeName}</span>
                    {activeWagon
                      ? <span style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', background:'var(--navy-100)', borderRadius:'var(--r-full)', fontSize:12, fontFamily:'var(--font-mono)', fontWeight:700, color:'var(--navy-700)' }}><WagonIcon size={12} /> {activeWagon}</span>
                      : <span style={{ display:'flex', alignItems:'center', gap:5, padding:'4px 10px', border:'1px dashed var(--border-default)', borderRadius:'var(--r-full)', fontSize:12, color:'var(--text-muted)' }}><WagonIcon size={12} /> Select wagon</span>
                    }
                  </div>
                  {nonOkPlates.length > 0 && (
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                      <span style={{ fontSize:11, color:'var(--text-muted)' }}>Other types:</span>
                      {['RA','TPI','MTI','DIV'].map(type => {
                        const cnt = nonOkPlates.filter(p => p.plateType === type).length
                        if (!cnt) return null
                        const cfg = PLATE_TYPE_CFG[type]
                        return <span key={type} title={cfg.desc} style={{ fontSize:10.5, padding:'2px 8px', borderRadius:'var(--r-full)', background:cfg.bg, color:cfg.color, fontWeight:600 }}>{cnt} {cfg.label}</span>
                      })}
                    </div>
                  )}
                </div>

                {/* Filter bar */}
                <div style={{ padding:'8px 14px', borderBottom:'1px solid var(--border-subtle)', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <div className="search-input-wrapper" style={{ flex:1, minWidth:140 }}>
                    <span className="search-icon"><SearchIcon size={13} /></span>
                    <input className="form-control" placeholder="Filter plates…" value={plateFilter}
                      onChange={e => setPlateFilter(e.target.value)} style={{ fontSize:12.5 }} />
                  </div>
                  {nonOkPlates.length > 0 && (
                    <label style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'var(--text-secondary)', cursor:'pointer', whiteSpace:'nowrap' }}>
                      <input type="checkbox" checked={showNonOk} onChange={e => setShowNonOk(e.target.checked)} />
                      RA/TPI/MTI/DIV
                    </label>
                  )}
                </div>

                {/* Plate list */}
                <div className="plate-list" style={{ flex:1, padding:'8px 14px', overflowY:'auto' }}>
                  {okPlates.length === 0 && (
                    <div className="empty-state" style={{ padding:'20px 0' }}>
                      <div className="empty-state-title">No OK plates</div>
                    </div>
                  )}
                  {visibleOkPlates.map((p, idx) => {
                    const curW  = p.wagonNo || '(No Wagon)'
                    const prevW = idx > 0 ? (visibleOkPlates[idx-1].wagonNo || '(No Wagon)') : null
                    return (
                      <React.Fragment key={p.plateNo}>
                        {curW !== prevW && (
                          <div style={{ margin:'10px 0 5px', display:'flex', alignItems:'center', gap:8, paddingLeft:4, borderLeft:`3px solid ${p.wagonNo ? 'var(--navy-400)' : 'var(--border-subtle)'}` }}>
                            <WagonIcon size={13} />
                            <span style={{ fontSize:11.5, fontFamily:'var(--font-mono)', fontWeight:700, color: p.wagonNo ? 'var(--navy-700)' : 'var(--text-muted)' }}>{curW}</span>
                          </div>
                        )}
                        <div className={`plate-item ${p.loaded ? 'loaded' : ''}`} onClick={() => togglePlate(activeCode, p.plateNo)}
                          style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <div className="plate-check">{p.loaded && <CheckIcon size={11} />}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                              <span className="plate-no" style={{ fontSize:13 }}>{p.plateNo}</span>
                              <span style={{ fontSize:10.5, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>{p.heatNo}</span>
                            </div>
                            <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:1 }}>
                              <span className="plate-grade" style={{ marginRight:6 }}>{p.grade}</span>
                              {p.ordSize && <span style={{ color:'var(--text-muted)' }}>{p.ordSize}</span>}
                              {p.pcWgt && <span style={{ color:'var(--text-muted)', marginLeft:6 }}>{p.pcWgt}T</span>}
                            </div>
                          </div>
                          {p.loaded && p.wagonNo && <span style={{ fontSize:10, color:'var(--green-700)', fontFamily:'var(--font-mono)', fontWeight:600, flexShrink:0 }}>{p.wagonNo}</span>}
                          {p.loaded && <span style={{ fontSize:10, color:'var(--green-700)', fontWeight:700, flexShrink:0 }}>✓</span>}
                          <button className="btn btn-ghost btn-icon" style={{ padding:'3px 5px', flexShrink:0 }} onClick={e => { e.stopPropagation(); handlePlateDetail(p) }}><InfoIcon size={13} /></button>
                        </div>
                      </React.Fragment>
                    )
                  })}

                  {showNonOk && visibleNonOkPlates.length > 0 && (
                    <>
                      <div style={{ margin:'10px 0 5px', display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ flex:1, height:1, background:'var(--border-subtle)' }} />
                        <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:600, whiteSpace:'nowrap' }}>Other Plate Types</span>
                        <div style={{ flex:1, height:1, background:'var(--border-subtle)' }} />
                      </div>
                      {visibleNonOkPlates.map((p, idx) => {
                        const cfg  = PLATE_TYPE_CFG[p.plateType] || PLATE_TYPE_CFG.DIV
                        const curW = p.wagonNo || '(No Wagon)'
                        const prevW = idx > 0 ? (visibleNonOkPlates[idx-1].wagonNo || '(No Wagon)') : null
                        return (
                          <React.Fragment key={p.plateNo}>
                            {curW !== prevW && (
                              <div style={{ margin:'10px 0 5px', display:'flex', alignItems:'center', gap:8, paddingLeft:4, borderLeft:`3px solid ${p.wagonNo ? 'var(--navy-400)' : 'var(--border-subtle)'}` }}>
                                <WagonIcon size={13} />
                                <span style={{ fontSize:11.5, fontFamily:'var(--font-mono)', fontWeight:700, color: p.wagonNo ? 'var(--navy-700)' : 'var(--text-muted)' }}>{curW}</span>
                              </div>
                            )}
                            <div className={`plate-item ${p.loaded ? 'loaded' : ''}`} onClick={() => togglePlate(activeCode, p.plateNo)}
                              style={{ display:'flex', alignItems:'center', gap:10 }}>
                              <div className="plate-check">{p.loaded && <CheckIcon size={11} />}</div>
                              <span style={{ fontSize:10, padding:'2px 7px', borderRadius:'var(--r-full)', background:cfg.bg, color:cfg.color, fontWeight:700, flexShrink:0 }}>{cfg.label}</span>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                                  <span className="plate-no" style={{ fontSize:13 }}>{p.plateNo}</span>
                                  <span style={{ fontSize:10.5, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>{p.heatNo}</span>
                                </div>
                                <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:1 }}>
                                  <span className="plate-grade" style={{ marginRight:6 }}>{p.grade}</span>
                                  {p.ordSize && <span style={{ color:'var(--text-muted)' }}>{p.ordSize}</span>}
                                </div>
                              </div>
                              {p.loaded && p.wagonNo && <span style={{ fontSize:10, color:'var(--green-700)', fontFamily:'var(--font-mono)', fontWeight:600, flexShrink:0 }}>{p.wagonNo}</span>}
                              {p.loaded && <span style={{ fontSize:10, color:'var(--green-700)', fontWeight:700, flexShrink:0 }}>✓</span>}
                              <button className="btn btn-ghost btn-icon" style={{ padding:'3px 5px', flexShrink:0 }} onClick={e => { e.stopPropagation(); handlePlateDetail(p) }}><InfoIcon size={13} /></button>
                            </div>
                          </React.Fragment>
                        )
                      })}
                    </>
                  )}
                </div>

                {/* Quick entry */}
                {allActivePlates.length > 0 && (
                  <div className="quick-entry" style={{ flexDirection:'column', gap:8 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, width:'100%' }}>
                      <input ref={quickEntryRef} className="form-control mono"
                        placeholder="Type plate number to find &amp; load…"
                        value={quickEntry} onChange={e => handleQuickInputChange(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && quickResult) { e.preventDefault(); handleQuickLoad() } }}
                        style={{ fontSize:13, flex:1 }} />
                      {quickEntry && (
                        <button className="btn btn-ghost btn-sm btn-icon"
                          onClick={() => { setQuickEntry(''); setQuickResult(null); setQuickError(''); quickEntryRef.current?.focus() }}>×</button>
                      )}
                    </div>
                    {isFetchingPlate && <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'var(--text-muted)' }}><span className="spinner spinner-sm" /> Searching…</div>}
                    {quickError && <div className="form-error">{quickError}</div>}
                    {quickResult && !quickError && (() => {
                      const isListPlate = quickResult.type === 'list'
                      const p    = isListPlate ? quickResult.plate : null
                      const info = isListPlate ? null : quickResult.apiInfo
                      const plateNo = p?.plateNo || info?.PLATE_NO || quickEntry
                      const grade   = p?.grade   || info?.GRADE   || ''
                      const heatNo  = p?.heatNo  || info?.HEAT_NO || ''
                      const alreadyLoaded = p?.loaded
                      return (
                        <div style={{ background: alreadyLoaded ? 'var(--green-50)' : 'var(--navy-50)', border:`1px solid ${alreadyLoaded ? 'var(--green-200)' : 'var(--navy-200)'}`, borderRadius:'var(--r-md)', padding:'8px 10px', display:'flex', alignItems:'center', gap:10, width:'100%' }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'baseline', gap:8, flexWrap:'wrap' }}>
                              <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13, color:'var(--navy-700)' }}>{plateNo}</span>
                              {!isListPlate && <span style={{ fontSize:9.5, padding:'1px 5px', borderRadius:'var(--r-full)', background:'var(--amber-100)', color:'var(--amber-700)', fontWeight:600 }}>Not in list</span>}
                              {alreadyLoaded && <span style={{ fontSize:9.5, padding:'1px 5px', borderRadius:'var(--r-full)', background:'var(--green-100)', color:'var(--green-700)', fontWeight:600 }}>Already loaded</span>}
                            </div>
                            <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2, display:'flex', gap:'2px 10px', flexWrap:'wrap' }}>
                              {grade  && <span>{grade}</span>}
                              {heatNo && <span style={{ fontFamily:'var(--font-mono)' }}>{heatNo}</span>}
                            </div>
                          </div>
                          {!alreadyLoaded
                            ? <button className="btn btn-success btn-sm" onClick={handleQuickLoad} style={{ flexShrink:0 }}><CheckIcon size={12} /> Load</button>
                            : <span style={{ fontSize:11, color:'var(--green-700)', fontWeight:600, flexShrink:0 }}>✓ Done</span>
                          }
                        </div>
                      )
                    })()}
                    {!quickResult && !quickError && !isFetchingPlate && (
                      <div className="form-hint">Type a plate number to find and load it.</div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Plate detail popup */}
      {plateDetail && (
        <div style={{ position:'fixed', bottom:80, right:20, zIndex:600, background:'var(--bg-surface)', border:'1px solid var(--border-subtle)', borderRadius:'var(--r-lg)', boxShadow:'var(--shadow-xl)', padding:'14px 16px', minWidth:260, maxWidth:320, animation:'scaleIn 0.15s ease' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
            <span style={{ fontFamily:'var(--font-mono)', fontWeight:700, fontSize:13, color:'var(--navy-700)' }}>{plateDetail.plateNo}</span>
            {!plateDetail._apiInfo && <span className="spinner spinner-sm" style={{ marginLeft:'auto', marginRight:6 }} />}
            <button className="btn btn-ghost btn-icon btn-sm" style={{ marginLeft: plateDetail._apiInfo ? 'auto' : 0 }} onClick={() => setPlateDetail(null)}>×</button>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:5, fontSize:12 }}>
            {[
              ['Heat No.', plateDetail._apiInfo?.HEAT_NO   || plateDetail.heatNo],
              ['Grade',    plateDetail._apiInfo?.GRADE     || plateDetail.grade],
              ['TDC',      plateDetail._apiInfo?.TDC       || plateDetail.tdc],
              ['Size',     plateDetail._apiInfo?.PLATE_SIZE || plateDetail.ordSize],
              ['Weight',   (plateDetail._apiInfo?.WGT || plateDetail.pcWgt) ? `${plateDetail._apiInfo?.WGT || plateDetail.pcWgt} T` : null],
              ['Order',    plateDetail._apiInfo?.ORD_NO    || plateDetail.ordNo],
              ['Mech',     plateDetail._apiInfo?.MECH_RESULT || null],
            ].map(([label, val]) => val ? (
              <div key={label} style={{ display:'flex', gap:8 }}>
                <span style={{ color:'var(--text-muted)', minWidth:60 }}>{label}</span>
                <span style={{ fontWeight:500 }}>{val}</span>
              </div>
            ) : null)}
          </div>
        </div>
      )}
    </AppShell>
  )
}

// ── Icons ─────────────────────────────────────────────────────────
function SearchIcon({ size=16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
}
function WagonIcon({ size=16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
}
function CheckIcon({ size=14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
}
function CheckCircleIcon({ size=16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
}
function InfoIcon({ size=15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink:0 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
}
function WarnIcon({ size=14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink:0 }}><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
}
function DestIcon({ size=16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
}
function EditIcon({ size=13 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}
function HomeIcon({ size=14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
}
function PlusIcon({ size=14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function SelectIcon({ size=22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
}
