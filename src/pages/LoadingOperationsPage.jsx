import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import AppShell from '../components/layout/AppShell.jsx'
import Modal from '../components/shared/Modal.jsx'
import { fetchRakeInfo, fetchLoadingReport, fetchPlateInfo, submitWagonLoad, fetchLoadedDetails, fetchWagonsByRake } from '../api/index.js'
import { exportSessionJson, generateLoadingPdf, buildWagonPayloads, submitWagonRequests } from '../utils/export.js'
import { useToast } from '../context/ToastContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

const SESSION_KEY      = 'bsp_loading_session'
const SESSIONS_MAP_KEY = 'bsp_sessions_map'

function loadSavedSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}

function loadSavedSessionsMap() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_MAP_KEY) || 'null') } catch { return null }
}

function saveSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch {}
}

const PLATE_TYPE_CFG = {
  OK: { label: 'OK', bg: null, color: null, desc: 'Ready to load' },
  RA: { label: 'RA', bg: 'var(--amber-100)', color: 'var(--amber-700)', desc: 'Result Awaited' },
  TPI: { label: 'TPI', bg: 'var(--sky-100)', color: 'var(--sky-600)', desc: 'Third Party Inspection' },
  MTI: { label: 'MTI', bg: 'var(--orange-100)', color: 'var(--orange-700)', desc: 'MTI Hold' },
  DIV: { label: 'DIV', bg: 'var(--gray-100)', color: 'var(--gray-700)', desc: 'Diversion' },
}

export default function LoadingOperationsPage() {
  const toast = useToast()
  const { user } = useAuth()
  const location = useLocation()

  const [step, setStep] = useState('RAKE_ENTRY')
  const [rakeInput, setRakeInput] = useState('')
  const [rakeLoading, setRakeLoading] = useState(false)
  const [rakeInfo, setRakeInfo] = useState(null)
  const [selectedDest, setSelectedDest] = useState(null)
  const [session, setSession] = useState(null)
  const [sessions, setSessions] = useState({})   // keyed by destination code
  const [consLoading, setConsLoading] = useState(false)

  const [activeCode, setActiveCode] = useState(null)
  const [plateFilter, setPlateFilter] = useState('')
  const [showNonOk, setShowNonOk] = useState(true)
  const [consigneeSearch, setConsigneeSearch] = useState('')
  const [wagonSearch, setWagonSearch]         = useState('')
  const [isFetchingPlate, setIsFetchingPlate] = useState(false)
  const [quickEntry, setQuickEntry] = useState('')
  const [quickError, setQuickError] = useState('')

  const [wagons, setWagons] = useState([])
  const [activeWagon, setActiveWagon] = useState(null)
  const [plateDetail, setPlateDetail] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [submission, setSubmission] = useState({ status: 'idle', succeeded: 0, failed: 0, total: 0, failedPayloads: [], submissionType: 1 })
  const [showCompleteModal, setShowCompleteModal] = useState(false)
  const [wagonsToComplete, setWagonsToComplete] = useState(new Set())
  const [loadingDestCode, setLoadingDestCode] = useState(null)

  const quickEntryRef = useRef(null)
  const quickDebounceRef = useRef(null)
  const loadConsigneesInProgressRef = useRef({})
  const loadedDetailsRef = useRef(null)
  const prefillHandledRef = useRef(false)
  const [quickResult, setQuickResult] = useState(null) // { type: 'list'|'api', plate?, apiInfo? }

  useEffect(() => {
    if (prefillHandledRef.current) return

    // Priority 1: explicit navigation prefill (from Dashboard / Assign Wagons)
    const state = location.state
    if (state?.prefillRakeId) {
      prefillHandledRef.current = true
      const id = String(state.prefillRakeId).toUpperCase()
      setRakeInput(id)

      if (Array.isArray(state.prefillWagons) && state.prefillWagons.length > 0) {
        setWagons(prev => {
          const existingMap = Object.fromEntries(prev.map(w => [w.wagonNo, w.consigneeCode]))
          return state.prefillWagons.map(w => ({
            wagonNo: w,
            consigneeCode: existingMap[w] ?? null,
          }))
        })
      }

      const info = state.prefillRakeInfo ? { ...state.prefillRakeInfo, rakeId: id } : null
      if (!info) return

      setRakeInfo(info)
      if (Array.isArray(info.destinations) && info.destinations.length === 1) {
        const onlyDest = info.destinations[0]
        setSelectedDest(onlyDest)
        void loadConsignees(id, onlyDest, info)
        return
      }
      if (Array.isArray(info.destinations) && info.destinations.length > 1) {
        setStep('DEST_SELECT')
      }
      return
    }

    // Priority 2: silent auto-restore of a saved session.
    // Triggered when user navigates directly to /loading-operations.
    const saved = loadSavedSession()
    const savedMap = loadSavedSessionsMap()
    if (saved?.step === 'LOADING') {
      prefillHandledRef.current = true
      setRakeInput(String(saved.rakeId || ''))
      setRakeInfo(saved.rakeInfo || null)
      setSelectedDest(saved.destination || null)
      setSession(saved)
      if (savedMap && Object.keys(savedMap).length > 0) {
        setSessions(savedMap)
      } else if (saved.destination?.code) {
        setSessions({ [saved.destination.code]: saved })
      }
      fetchWagonsByRake(String(saved.rakeId || '')).then(raw => {
        const wNos = [...new Set(raw.map(r => (r.DISPATCH_NM || '').trim()).filter(Boolean))]
        if (wNos.length) {
          const wagonConsMap = {}
          ;(saved.consignees || []).forEach(c => {
            c.plates?.forEach(p => {
              if (p.loaded && p.wagonNo && !wagonConsMap[p.wagonNo]) wagonConsMap[p.wagonNo] = c.consigneeCode
            })
          })
          setWagons(wNos.map(wNo => ({ wagonNo: wNo, consigneeCode: wagonConsMap[wNo] || null })))
        }
      }).catch(() => {})
      setStep('LOADING')
    }
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeCode && quickEntryRef.current) {
      setTimeout(() => quickEntryRef.current?.focus(), 100)
    }
  }, [activeCode])

  async function handleFetchRake() {
    const id = rakeInput.trim().toUpperCase()
    if (!id) {
      toast.warning('Please enter a Rake ID.')
      return
    }

    loadedDetailsRef.current = null
    setRakeLoading(true)
    try {
      const info = await fetchRakeInfo(id)
      const merged = { ...info, rakeId: id }
      setRakeInfo(merged)

      if (merged.destinations.length === 1) {
        const dest = merged.destinations[0]
        setSelectedDest(dest)
        await loadConsignees(id, dest, merged)
      } else {
        setStep('DEST_SELECT')
      }
    } catch {
      toast.error('Could not fetch Rake info. Check the Rake ID and try again.')
    } finally {
      setRakeLoading(false)
    }
  }

  async function handleSelectDest(dest) {
    setSelectedDest(dest)
    await loadConsignees(rakeInput.trim().toUpperCase(), dest, rakeInfo)
  }

  function handleSwitchDest(dest) {
    if (dest.code === selectedDest?.code) return
    setActiveCode(null)
    setActiveWagon(null)
    setPlateFilter('')
    setQuickEntry(''); setQuickError('')
    setQuickResult(null)
    setSelectedDest(dest)

    // If already loaded, just restore it
    if (sessions[dest.code]) {
      setSession(sessions[dest.code])
      return
    }

    // Cache miss: fetch in background while keeping destination switch UI interactive.
    loadConsignees(rakeInput.trim().toUpperCase(), dest)
  }

  async function loadConsignees(rakeId, dest, info) {
    if (loadConsigneesInProgressRef.current[dest.code]) return
    loadConsigneesInProgressRef.current[dest.code] = true
    setLoadingDestCode(dest.code)
    setConsLoading(true)

    try {
      if (!loadedDetailsRef.current) {
        loadedDetailsRef.current = await fetchLoadedDetails(rakeId).catch(() => [])
      }
      const loadedRaw = loadedDetailsRef.current
      const plateWagonMap = {}
      if (Array.isArray(loadedRaw)) {
        for (const row of loadedRaw) {
          const wNo = (row.DISPATCH_NM || '').trim()
          const pNo = (row.CHILD_PLATE_NO || '').trim()
          if (wNo && pNo) plateWagonMap[pNo] = wNo
        }
      }
      const rawConsignees = await fetchLoadingReport(dest.code)
      const consignees = rawConsignees.map(c => ({
        ...c,
        plates: c.plates.map(p => {
          const wagonNo = plateWagonMap[p.plateNo]
          if (wagonNo) return { ...p, loaded: true, loadedAt: new Date().toISOString(), wagonNo }
          return p
        }),
      }))
      setWagons(prev => {
        const wagonConsMap = {}
        consignees.forEach(c => {
          c.plates.forEach(p => {
            if (p.loaded && p.wagonNo && !wagonConsMap[p.wagonNo]) wagonConsMap[p.wagonNo] = c.consigneeCode
          })
        })
        return prev.map(w => ({ ...w, consigneeCode: w.consigneeCode || wagonConsMap[w.wagonNo] || null }))
      })
      const newSession = {
        rakeId,
        rakeInfo: info || rakeInfo,
        destination: dest,
        consignees,
        loadingLog: [],
        step: 'LOADING',
        startedAt: new Date().toISOString(),
        operatedBy: user?.username,
      }
      setSession(newSession)
      setSessions(prev => ({ ...prev, [dest.code]: newSession }))
      saveSession(newSession)
      try {
        const currentMap = JSON.parse(localStorage.getItem(SESSIONS_MAP_KEY) || '{}')
        currentMap[dest.code] = newSession
        localStorage.setItem(SESSIONS_MAP_KEY, JSON.stringify(currentMap))
      } catch {}
      setStep('LOADING')

      const okCount = consignees.reduce((s, c) => s + (c.okPlateCount || 0), 0)
      toast.success({
        title: 'Session Ready',
        message: `${consignees.length} consignees · ${okCount} OK plates · ${dest.name}`,
      })

      // Pre-warm cache for other destinations so switching is instant.
      const allDests = (info || rakeInfo)?.destinations || []
      allDests
        .filter(d => d.code !== dest.code)
        .forEach(d => fetchLoadingReport(d.code).catch(() => {}))
    } catch {
      toast.error('Failed to load consignee data. Please try again.')
    } finally {
      delete loadConsigneesInProgressRef.current[dest.code]
      setLoadingDestCode(null)
      setConsLoading(false)
    }
  }

  const updateSession = useCallback((updater) => {
    setSession(prev => {
      const next = updater(prev)
      saveSession(next)
      setSessions(s => ({ ...s, [next.destination.code]: next }))
      try {
        const currentMap = JSON.parse(localStorage.getItem(SESSIONS_MAP_KEY) || '{}')
        currentMap[next.destination.code] = next
        localStorage.setItem(SESSIONS_MAP_KEY, JSON.stringify(currentMap))
      } catch {}
      return next
    })
  }, [])

  function handleSelectConsignee(code) {
    const c = session.consignees.find(x => x.consigneeCode === code)
    if (!c) return

    setActiveCode(code)
    setPlateFilter('')
    setQuickEntry('')
    setQuickError('')
    setQuickResult(null)
    if (quickDebounceRef.current) clearTimeout(quickDebounceRef.current)

    // Auto-select first wagon already assigned to this consignee
    const cWagon = wagons.find(w => w.consigneeCode === code)
    setActiveWagon(cWagon ? cWagon.wagonNo : null)
  }

  function handleSelectWagon(wagonNo) {
    if (!activeCode) {
      toast.warning('Select a consignee first.')
      return
    }
    const wagon = wagons.find(w => w.wagonNo === wagonNo)
    if (!wagon) return

    if (wagon.consigneeCode && wagon.consigneeCode !== activeCode) {
      const ownerName = session.consignees.find(c => c.consigneeCode === wagon.consigneeCode)?.consigneeName || wagon.consigneeCode
      toast.error(`Wagon ${wagonNo} is already assigned to ${ownerName}.`)
      return
    }

    if (!wagon.consigneeCode) {
      // Wagon is unassigned - ask for confirmation
      const consName = session.consignees.find(c => c.consigneeCode === activeCode)?.consigneeName
      const msg = `Assign wagon ${wagonNo} to ${consName}?`
      if (!window.confirm(msg)) {
        return
      }

      setWagons(prev => prev.map(w =>
        w.wagonNo === wagonNo ? { ...w, consigneeCode: activeCode } : w
      ))
      toast.success({ title: 'Wagon Assigned', message: `${wagonNo} → ${consName}`, duration: 2000 })
    }

    setActiveWagon(wagonNo)
    setTimeout(() => quickEntryRef.current?.focus(), 100)
  }

  function handleUnlinkWagon(wagonNo) {
    const loadedCount = session.consignees
      .find(c => c.consigneeCode === activeCode)
      ?.plates.filter(p => p.wagonNo === wagonNo && p.loaded).length ?? 0

    const msg = loadedCount > 0
      ? `Unlink wagon ${wagonNo}? ${loadedCount} plate(s) will be marked as not loaded.`
      : `Unlink wagon ${wagonNo} from this consignee?`
    if (!window.confirm(msg)) return

    setWagons(prev => prev.map(w =>
      w.wagonNo === wagonNo ? { ...w, consigneeCode: null } : w
    ))

    updateSession(prev => ({
      ...prev,
      consignees: prev.consignees.map(c =>
        c.consigneeCode === activeCode
          ? {
            ...c,
            plates: c.plates.map(p =>
              p.wagonNo === wagonNo && p.loaded
                ? { ...p, loaded: false, loadedAt: null, wagonNo: null }
                : p
            ),
          }
          : c
      ),
      loadingLog: prev.loadingLog.concat({
        timestamp: new Date().toISOString(),
        wagonNo,
        consigneeCode: activeCode,
        action: 'WAGON_UNLINKED',
      }),
    }))

    if (activeWagon === wagonNo) setActiveWagon(null)
    toast.info({
      message: `Wagon ${wagonNo} unlinked${loadedCount > 0 ? `. ${loadedCount} plate(s) reset.` : '.'}`,
      duration: 2800,
    })
  }

  function togglePlate(consigneeCode, plateNo) {
    const now = new Date().toISOString()
    const c = session.consignees.find(x => x.consigneeCode === consigneeCode)
    if (!c) return

    const plate = c.plates.find(p => p.plateNo === plateNo)
    if (!plate) return

    if (!plate.loaded && !activeWagon && wagons.length > 0) {
      toast.warning('Select a wagon from the panel on the left before marking plates as loaded.')
      return
    }

    const action  = plate.loaded ? 'UNLOADED' : 'LOADED'
    const wagonNo = plate.loaded ? null : activeWagon
    updateSession(prev => ({
      ...prev,
      consignees: prev.consignees.map(cons =>
        cons.consigneeCode === consigneeCode
          ? {
            ...cons,
            plates: cons.plates.map(p =>
              p.plateNo === plateNo
                ? { ...p, loaded: !p.loaded, loadedAt: !p.loaded ? now : null, wagonNo }
                : p
            ),
          }
          : cons
      ),
      loadingLog: prev.loadingLog.concat({
        timestamp: now,
        plateNo,
        consigneeCode,
        wagonNo: activeWagon,
        action,
      }),
    }))
  }

  function handleQuickInputChange(val) {
    const upper = val.toUpperCase()
    setQuickEntry(upper)
    setQuickError('')
    setQuickResult(null)

    if (quickDebounceRef.current) clearTimeout(quickDebounceRef.current)

    const q = upper.trim()
    if (!q || !activeCode || !session) return

    quickDebounceRef.current = setTimeout(async () => {
      const cons = session.consignees.find(c => c.consigneeCode === activeCode)
      if (!cons) return

      const plate = cons.plates
        .find(p =>
          p.plateNo.toUpperCase() === q ||
          p.plateNo.toUpperCase() === `OK-${q}` ||
          p.plateNo.toUpperCase().endsWith(q)
        )

      if (plate) {
        setQuickResult({ type: 'list', plate })
        return
      }

      setIsFetchingPlate(true)
      try {
        const info = await fetchPlateInfo(q)
        if (info) {
          setQuickResult({ type: 'api', apiInfo: info })
        } else {
          setQuickError(`Plate "${q}" not found in list or system.`)
        }
      } catch {
        setQuickError(`Could not fetch plate info for "${q}".`)
      } finally {
        setIsFetchingPlate(false)
      }
    }, 550)
  }

  function handleQuickLoad() {
    if (!quickResult) return

    if (quickResult.type === 'list') {
      const { plate } = quickResult
      if (plate.loaded) {
        setQuickError(`${plate.plateNo} is already marked as loaded.`)
        return
      }
      if (!activeWagon && wagons.length > 0) {
        toast.warning('Select a wagon before loading.')
        return
      }
      togglePlate(activeCode, plate.plateNo)
      toast.success({ message: `${plate.plateNo} → Loaded`, duration: 1800 })
    } else {
      if (!activeWagon && wagons.length > 0) {
        toast.warning('Select a wagon before loading.')
        return
      }
      const { apiInfo } = quickResult
      const now = new Date().toISOString()
      const inferredPlateType = (() => {
        const raw = String(apiInfo.MECH_RESULT || apiInfo.PLATE_TYPE || '').toUpperCase()
        return ['OK', 'RA', 'DIV', 'MTI', 'TPI'].includes(raw) ? raw : 'OK'
      })()
      const newPlate = {
        plateNo:  apiInfo.PLATE_NO  || quickEntry.trim(),
        heatNo:   apiInfo.HEAT_NO   || '',
        plateType: inferredPlateType,
        ordNo:    apiInfo.ORD_NO    || '',
        grade:    apiInfo.GRADE     || '',
        tdc:      apiInfo.TDC       || '',
        colourCd: apiInfo.COLOUR_CD || '',
        ordSize:  apiInfo.PLATE_SIZE || '',
        pcWgt:    apiInfo.WGT ? parseFloat(apiInfo.WGT) : null,
        loaded:   true,
        loadedAt: now,
        wagonNo:  activeWagon,
        _manual:  true,
      }
      updateSession(prev => ({
        ...prev,
        consignees: prev.consignees.map(c =>
          c.consigneeCode === activeCode
            ? {
              ...c,
              plates: [...c.plates, newPlate],
              okPlateCount: inferredPlateType === 'OK' ? (c.okPlateCount ?? 0) + 1 : (c.okPlateCount ?? 0),
            }
            : c
        ),
        loadingLog: prev.loadingLog.concat({
          timestamp: now,
          plateNo:   newPlate.plateNo,
          consigneeCode: activeCode,
          wagonNo:   activeWagon,
          action:    'LOADED',
        }),
      }))
      toast.success({ message: `${newPlate.plateNo} → Loaded (added manually)`, duration: 2200 })
    }

    setQuickEntry('')
    setQuickResult(null)
    setQuickError('')
    quickEntryRef.current?.focus()
  }

  async function handlePlateDetail(p) {
    if (plateDetail?.plateNo === p.plateNo) { setPlateDetail(null); return }
    setPlateDetail(p)
    try {
      const info = await fetchPlateInfo(p.plateNo)
      if (info) setPlateDetail(prev => prev?.plateNo === p.plateNo ? { ...prev, _apiInfo: info } : prev)
    } catch { /* show existing data only */ }
  }

  async function handleSaveProgress() {
    const allSessions = { ...sessions, [session.destination.code]: session }
    const payloads = buildWagonPayloads({ ...session, allSessions, wagons })
    if (!payloads.length) {
      toast.warning('No loaded plates to save.')
      return
    }
    if (!window.confirm(`Save progress for Rake ${session.rakeId}?`)) return

    setSubmission({ status: 'submitting', succeeded: 0, failed: 0, total: payloads.length, failedPayloads: [], submissionType: 1 })

    const results = await submitWagonRequests(payloads, submitWagonLoad, ({ succeeded, failed, total }) => {
      setSubmission(prev => ({ ...prev, succeeded, failed, total }))
    }, 1)

    if (results.failed.length === 0) {
      toast.success({ title: 'Progress Saved', message: `${results.succeeded.length} wagon record(s) saved successfully.` })
      setSubmission({ status: 'saved', succeeded: results.succeeded.length, failed: 0, total: payloads.length, failedPayloads: [], submissionType: 1 })
      try {
        const loadedRaw = await fetchLoadedDetails(session.rakeId)
        loadedDetailsRef.current = loadedRaw
        const plateWagonMap = {}
        if (Array.isArray(loadedRaw)) {
          for (const row of loadedRaw) {
            const wNo = (row.DISPATCH_NM || '').trim()
            const pNo = (row.CHILD_PLATE_NO || '').trim()
            if (wNo && pNo) plateWagonMap[pNo] = wNo
          }
        }
        updateSession(prev => ({
          ...prev,
          savedAt: new Date().toISOString(),
          consignees: prev.consignees.map(c => ({
            ...c,
            plates: c.plates.map(p => {
              if (!p.loaded) {
                const wagonNo = plateWagonMap[p.plateNo]
                if (wagonNo) return { ...p, loaded: true, loadedAt: new Date().toISOString(), wagonNo }
              }
              return p
            }),
          })),
        }))
      } catch {
        // Silent by design; save succeeded already.
      }
      return
    }

    setSubmission({
      status: 'partial',
      succeeded: results.succeeded.length,
      failed: results.failed.length,
      total: payloads.length,
      failedPayloads: results.failed.map(f => f.payload),
      submissionType: 1,
    })
  }

  async function submitMixedCompletionRequests(payloads, completedWagonNos, onProgress) {
    const completedSet = new Set(completedWagonNos)
    const queued = payloads.map(payload => ({
      payload,
      status: completedSet.has(payload.wagonNo) ? 2 : 1,
    }))
    const results = { succeeded: [], failed: [] }

    await Promise.allSettled(
      queued.map(async (entry) => {
        try {
          await submitWagonLoad(entry.payload, entry.status)
          results.succeeded.push(entry)
        } catch (err) {
          results.failed.push({ ...entry, error: err.message })
        }
        onProgress?.({
          succeeded: results.succeeded.length,
          failed: results.failed.length,
          total: queued.length,
        })
      })
    )

    return results
  }

  async function handleCompleteWagons() {
    if (wagonsToComplete.size === 0) {
      toast.warning('Select at least one wagon to complete.')
      return
    }

    const allSessions = { ...sessions, [session.destination.code]: session }
    const allPayloads = buildWagonPayloads({ ...session, allSessions, wagons })
    const selectedPayloads = allPayloads.filter(p => wagonsToComplete.has(p.wagonNo))
    if (!selectedPayloads.length) {
      toast.warning('No loaded plates found for the selected wagons.')
      return
    }
    const completedWagonNos = [...wagonsToComplete]

    setShowCompleteModal(false)
    const done = {
      ...session,
      allSessions,
      wagons,
      completedWagons: completedWagonNos,
      completedAt: new Date().toISOString(),
      step: 'COMPLETED',
    }
    setSession(done)
    setSessions(allSessions)
    saveSession(done)
    setStep('COMPLETED')
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(SESSIONS_MAP_KEY)

    setSubmission({ status: 'submitting', succeeded: 0, failed: 0, total: allPayloads.length, failedPayloads: [], submissionType: 2 })

    const results = await submitMixedCompletionRequests(allPayloads, completedWagonNos, ({ succeeded, failed, total }) => {
      setSubmission(prev => ({ ...prev, succeeded, failed, total }))
    })

    setSubmission({
      status: results.failed.length === 0 ? 'done' : 'partial',
      succeeded: results.succeeded.length,
      failed: results.failed.length,
      total: allPayloads.length,
      failedPayloads: results.failed.map(f => ({ payload: f.payload, status: f.status })),
      submissionType: 2,
    })
  }

  async function handleRetrySubmission() {
    const payloads = submission.failedPayloads
    if (!payloads.length) return
    const retryType = submission.submissionType ?? 2
    setSubmission(prev => ({ ...prev, status: 'submitting', succeeded: 0, failed: 0, total: payloads.length, failedPayloads: [] }))

    if (retryType === 2) {
      const queued = payloads.map(item => (
        item?.payload && typeof item.status === 'number'
          ? item
          : { payload: item, status: 2 }
      ))
      const results = { succeeded: [], failed: [] }

      await Promise.allSettled(
        queued.map(async (entry) => {
          try {
            await submitWagonLoad(entry.payload, entry.status)
            results.succeeded.push(entry)
          } catch (err) {
            results.failed.push({ ...entry, error: err.message })
          }
          setSubmission(prev => ({
            ...prev,
            succeeded: results.succeeded.length,
            failed: results.failed.length,
            total: queued.length,
          }))
        })
      )

      setSubmission({
        status:         results.failed.length === 0 ? 'done' : 'partial',
        succeeded:      results.succeeded.length,
        failed:         results.failed.length,
        total:          queued.length,
        failedPayloads: results.failed.map(f => ({ payload: f.payload, status: f.status })),
        submissionType: retryType,
      })
      return
    }

    const results = await submitWagonRequests(payloads, submitWagonLoad, ({ succeeded, failed, total }) => {
      setSubmission(prev => ({ ...prev, succeeded, failed, total }))
    }, retryType)

    const successStatus = retryType === 1 ? 'saved' : 'done'

    setSubmission({
      status:         results.failed.length === 0 ? successStatus : 'partial',
      succeeded:      results.succeeded.length,
      failed:         results.failed.length,
      total:          payloads.length,
      failedPayloads: results.failed.map(f => f.payload),
      submissionType: retryType,
    })
  }

  async function handleExportJson() {
    setExporting(true)
    try {
      const allSessions = { ...sessions, [session.destination.code]: session }
      exportSessionJson({ ...session, allSessions, wagons })
    } catch { toast.error('Export failed.') }
    finally { setExporting(false) }
  }

  async function handleExportPdf() {
    setExporting(true)
    try {
      const allSessions = { ...sessions, [session.destination.code]: session }
      await generateLoadingPdf({ ...session, allSessions, wagons }, step === 'COMPLETED' ? 'completion' : 'progress')
    } catch (e) { toast.error('PDF failed: ' + e.message) }
    finally { setExporting(false) }
  }

  const activeConsignee = session?.consignees.find(c => c.consigneeCode === activeCode)

  const filteredConsignees = (session?.consignees ?? []).filter(c => {
    if (!consigneeSearch) return true
    const q = consigneeSearch.toLowerCase()
    return c.consigneeName.toLowerCase().includes(q) || c.consigneeCode.toLowerCase().includes(q)
  })

  const filteredWagons = wagons
    .filter(w => {
      if (!wagonSearch) return true
      const q = wagonSearch.toLowerCase()
      return w.wagonNo.toLowerCase().includes(q) ||
        (w.consigneeCode || '').toLowerCase().includes(q)
    })
    .sort((a, b) => {
      // Check if active consignee has any assigned wagons
      const activeConsigneeHasWagons = activeCode ? wagons.some(w => w.consigneeCode === activeCode) : false
      
      // If no wagons assigned to this consignee, prioritize unassigned wagons
      if (!activeConsigneeHasWagons && activeCode) {
        const aIsUnassigned = a.consigneeCode === null
        const bIsUnassigned = b.consigneeCode === null
        if (aIsUnassigned && !bIsUnassigned) return -1
        if (!aIsUnassigned && bIsUnassigned) return 1
        return 0
      }
      
      // Default: Prioritize wagons assigned to the currently selected consignee
      const aIsActive = a.consigneeCode === activeCode
      const bIsActive = b.consigneeCode === activeCode
      if (aIsActive && !bIsActive) return -1
      if (!aIsActive && bIsActive) return 1
      return 0
    })

  const allActivePlates = activeConsignee?.plates ?? []
  const okPlates = allActivePlates.filter(p => p.plateType === 'OK')
  const nonOkPlates = allActivePlates.filter(p => p.plateType !== 'OK')

  // Combine all plates and sort: loaded first (all types), then unloaded (all types)
  // Within each group, sort by wagon number
  const visibleAllPlates = (showNonOk ? [...okPlates, ...nonOkPlates] : okPlates)
    .filter(p => {
      if (!plateFilter) return true
      const q = plateFilter.toLowerCase()
      return (
        p.plateNo.toLowerCase().includes(q) ||
        p.grade.toLowerCase().includes(q) ||
        (p.heatNo || '').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      // Primary sort: loaded status (loaded first)
      if (a.loaded !== b.loaded) {
        return a.loaded ? -1 : 1
      }
      // Secondary sort: wagon number (for grouping)
      const wagonA = a.wagonNo || ''
      const wagonB = b.wagonNo || ''
      if (wagonA !== wagonB) return wagonA.localeCompare(wagonB)
      // Tertiary sort: plate type (OK first)
      if (a.plateType !== b.plateType) {
        return a.plateType === 'OK' ? -1 : 1
      }
      return 0
    })

  const loadedPlates = session?.consignees.reduce((s, c) => s + c.plates.filter(p => p.loaded).length, 0) ?? 0

  // All-destination totals (used in COMPLETED step)
  const completedConsignees = (() => {
    if (step === 'COMPLETED' && session?.allSessions) {
      return Object.values(session.allSessions).flatMap(s =>
        s.consignees.map(c => ({ ...c, _destination: s.destination }))
      )
    }
    return (session?.consignees ?? []).map(c => ({ ...c, _destination: session?.destination }))
  })()

  const completedLoaded = completedConsignees.reduce((s, c) => s + c.plates.filter(p => p.loaded).length, 0)
  const completedLoadedWeight = completedConsignees.reduce((s, c) =>
    s + c.plates.filter(p => p.loaded && p.pcWgt).reduce((ws, p) => ws + (parseFloat(p.pcWgt) || 0), 0), 0)
  const completedConsigneesWithLoads = completedConsignees.filter(c => c.plates.some(p => p.loaded)).length
  const completedWagonSet = new Set(step === 'COMPLETED' ? (session?.completedWagons || []) : [])

  // Build wagon-wise summary (one row per wagon)
  const wagonSummary = (() => {
    const wagonMap = {}
    const allSessions = step === 'COMPLETED' && session?.allSessions
      ? session.allSessions
      : session ? { [session.destination?.code]: session } : {}
    
    Object.values(allSessions).forEach(sess => {
      if (!sess) return
      sess.consignees?.forEach(consignee => {
        consignee.plates?.forEach(plate => {
          if (plate.loaded && plate.wagonNo) {
            if (!wagonMap[plate.wagonNo]) {
              wagonMap[plate.wagonNo] = {
                wagonNo: plate.wagonNo,
                consigneeCode: consignee.consigneeCode,
                consigneeName: consignee.consigneeName,
                destination: sess.destination,
                platesCount: 0,
                totalWeight: 0,
                isCompleted: completedWagonSet.has(plate.wagonNo),
              }
            }
            wagonMap[plate.wagonNo].platesCount++
            if (plate.pcWgt) {
              wagonMap[plate.wagonNo].totalWeight += parseFloat(plate.pcWgt) || 0
            }
          }
        })
      })
    })
    
    return Object.values(wagonMap)
      .map(w => ({ ...w, isCompleted: completedWagonSet.has(w.wagonNo) }))
      .sort((a, b) => a.wagonNo.localeCompare(b.wagonNo))
  })()

  return (
    <AppShell pageTitle="Loading Operations">
      {step === 'RAKE_ENTRY' && (
        <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="section-header">
            <div>
              <div className="section-title">Loading Operations</div>
              <div className="section-sub">Enter the Rake ID to begin the plate loading session.</div>
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <div className="card-icon"><LoadIcon /></div>
              <div>
                <div className="card-title">Initiate Loading Session</div>
                <div className="card-subtitle">Rake ID is generated in the Rake Generation module.</div>
              </div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="rakeId">Rake ID <span className="req">*</span></label>
                <input
                  id="rakeId"
                  className="form-control lg mono"
                  placeholder="e.g. 2026032701"
                  value={rakeInput}
                  onChange={e => setRakeInput(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleFetchRake()}
                  autoFocus
                  disabled={rakeLoading || consLoading}
                />
                <span className="form-hint">Press Enter or click Proceed to fetch rake details.</span>
              </div>
            </div>
            <div className="card-footer">
              <button
                className="btn btn-primary btn-lg"
                onClick={handleFetchRake}
                disabled={!rakeInput.trim() || rakeLoading || consLoading}
              >
                {(rakeLoading || consLoading)
                  ? <><span className="spinner spinner-sm" /> {rakeLoading ? 'Fetching Rake...' : 'Loading Consignees...'}</>
                  : <><ArrowRightIcon /> Proceed</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'DEST_SELECT' && rakeInfo && (
        <div style={{ maxWidth: 600, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <StepBar steps={['Rake ID', 'Destination', 'Loading']} active={1} />
          <div className="card">
            <div className="card-header">
              <div className="card-icon"><DestIcon /></div>
              <div>
                <div className="card-title">Select Loading Destination</div>
                <div className="card-subtitle">Rake {rakeInfo.rakeId} serves multiple destinations.</div>
              </div>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="alert alert-info">
                <InfoIcon />
                <span>This rake serves <strong>{rakeInfo.destinations.length}</strong> destination(s). Choose the one you are loading for.</span>
              </div>
              <div className="dest-choice-group">
                {rakeInfo.destinations.map(d => (
                  <button
                    key={d.code}
                    className={`dest-choice-chip ${selectedDest?.code === d.code ? 'selected' : ''}`}
                    onClick={() => setSelectedDest(d)}
                  >
                    {d.name} ({d.code})
                  </button>
                ))}
              </div>
            </div>
            <div className="card-footer">
              <button className="btn btn-ghost btn-sm" onClick={() => setStep('RAKE_ENTRY')}><BackIcon /> Back</button>
              <button
                className="btn btn-primary"
                onClick={() => selectedDest && handleSelectDest(selectedDest)}
                disabled={!selectedDest || consLoading}
              >
                {consLoading
                  ? <><span className="spinner spinner-sm" /> Loading Consignees...</>
                  : <>Confirm Destination <ArrowRightIcon /></>}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'LOADING' && session && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div className="info-row" style={{ flex: 1 }}>
              <div className="info-item">
                <span className="info-label">Rake</span>
                <span className="info-value mono" style={{ fontSize: 13 }}>{session.rakeId}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Destination</span>
                <span className="dest-chip"><DestIcon size={12} />{session.destination.name} ({session.destination.code})</span>
              </div>
              <div className="info-item">
                <span className="info-label">Plates Loaded:</span>
                <span className="info-value">{loadedPlates} Plates</span>
              </div>
            </div>
            {rakeInfo?.destinations?.length > 1 && (
              <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                {rakeInfo.destinations.map(d => {
                  const ds = sessions[d.code]
                  const dLoaded = ds ? ds.consignees.reduce((a, c) => a + c.plates.filter(p => p.loaded).length, 0) : 0
                  return (
                    <button key={d.code}
                      className={`btn btn-sm ${selectedDest?.code === d.code ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => handleSwitchDest(d)}
                      disabled={loadingDestCode === d.code}
                      title={`Switch to ${d.name}`}
                      style={{ fontSize: 11.5 }}
                    >
                      {d.name}
                      {ds && (
                        <span style={{ marginLeft: 5, fontFamily: 'var(--font-mono)', fontSize: 10, opacity: 0.8 }}>
                          {dLoaded}
                        </span>
                      )}
                      {loadingDestCode === d.code && (
                        <span className="spinner spinner-sm" style={{ marginLeft: 5 }} />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button 
                className="btn btn-ghost btn-sm" 
                onClick={() => window.history.back()}
                title="Go back to Assign Wagons"
              >
                <BackIcon /> Back
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleExportJson} disabled={exporting}>
                <JsonIcon /> JSON
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleSaveProgress}>
                <SaveIcon /> Save Progress
              </button>
              <button className="btn btn-success" onClick={() => {
                const allSess = { ...sessions, [session.destination.code]: session }
                const wagonsWithPlates = wagons.filter(w =>
                  Object.values(allSess).some(s => s?.consignees?.some(c => c.plates.some(p => p.loaded && p.wagonNo === w.wagonNo)))
                )
                if (!wagonsWithPlates.length) {
                  toast.warning('No wagons with loaded plates to complete.')
                  return
                }
                setWagonsToComplete(new Set())
                setShowCompleteModal(true)
              }}>
                <CompleteIcon /> Complete
              </button>
            </div>
          </div>

          {submission.status !== 'idle' && submission.submissionType === 1 && (
            <div style={{ marginBottom: 4 }}>
              {submission.status === 'submitting' && (
                <div className="alert alert-info" style={{ alignItems: 'center', gap: 10 }}>
                  <span className="spinner spinner-sm" />
                  <span>Saving progress... {submission.succeeded + submission.failed} / {submission.total}</span>
                </div>
              )}
              {submission.status === 'saved' && (
                <div className="alert alert-success" style={{ justifyContent: 'space-between' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircleIcon size={15} />
                    Progress saved - {submission.succeeded} wagon record{submission.succeeded !== 1 ? 's' : ''} stored. You may continue loading.
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSubmission(prev => ({ ...prev, status: 'idle' }))}>x</button>
                </div>
              )}
              {submission.status === 'partial' && (
                <div className="alert alert-danger" style={{ flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <WarnIcon size={15} />
                    {submission.failed} of {submission.total} save request{submission.failed !== 1 ? 's' : ''} failed. {submission.succeeded} succeeded.
                  </span>
                  <button className="btn btn-danger btn-sm" onClick={handleRetrySubmission}>
                    Retry Failed ({submission.failed})
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="loading-layout" style={{ flex: 1, minHeight: 0 }}>
            <div className="card consignee-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0, flexDirection: 'row' }} className="consignee-wagons-layout">

                {/* ── Consignees column ── */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, borderRight: '1px solid var(--border-subtle)' }} className="consignee-column">
                  <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 11.5, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                      Consignees ({filteredConsignees.length})
                    </div>
                    <div className="search-input-wrapper">
                      <span className="search-icon"><SearchIcon size={12} /></span>
                      <input
                        className="form-control"
                        placeholder="Search…"
                        value={consigneeSearch}
                        onChange={e => setConsigneeSearch(e.target.value)}
                        style={{ fontSize: 11.5, padding: '4px 8px 4px 26px' }}
                      />
                    </div>
                  </div>

                  <div className="consignee-list" style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
                    {filteredConsignees.map(c => {
                      const loadedCount = c.plates.filter(p => p.loaded).length
                      const loadedWeight = c.plates.filter(p => p.loaded && p.pcWgt).reduce((sum, p) => sum + (parseFloat(p.pcWgt) || 0), 0)
                      const hasOkPlates = c.plates.some(p => p.plateType === 'OK')
                      const nonOkCount = c.plates.filter(p => p.plateType !== 'OK').length
                      const hasLoaded = loadedCount > 0

                      return (
                        <div
                          key={c.consigneeCode}
                          className={`consignee-card ${activeCode === c.consigneeCode ? 'active' : ''} ${hasLoaded ? 'done' : ''}`}
                          onClick={() => handleSelectConsignee(c.consigneeCode)}
                        >
                          <div className="consignee-card-top">
                            <span className="consignee-code-badge">{c.consigneeCode}</span>
                            {hasLoaded && <span className="badge badge-gray" style={{ fontSize: 10 }}><span className="badge-dot" />Loaded</span>}
                            {!hasOkPlates && <span className="badge badge-neutral" style={{ fontSize: 10 }}>No OK Plates</span>}
                          </div>

                          <div className="consignee-name" style={{ marginBottom: 7, fontSize: 13.5, fontWeight: 600 }}>{c.consigneeName}</div>

                          {loadedCount > 0 ? (
                            <div className="consignee-progress-row" style={{ justifyContent: 'space-between' }}>
                              <span className="consignee-count"><strong>{loadedCount}</strong> loaded</span>
                              {loadedWeight > 0 && <span className="consignee-count">{loadedWeight.toFixed(1)}T</span>}
                            </div>
                          ) : (
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              No plates loaded yet
                            </div>
                          )}

                          {nonOkCount > 0 && (
                            <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                              {['RA', 'TPI', 'MTI', 'DIV'].map(type => {
                                const cnt = c.plates.filter(p => p.plateType === type).length
                                if (!cnt) return null
                                const cfg = PLATE_TYPE_CFG[type]
                                return (
                                  <span key={type} style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 'var(--r-full)', background: cfg.bg, color: cfg.color, fontWeight: 700 }}>
                                    {cnt} {cfg.label}
                                  </span>
                                )
                              })}
                            </div>
                          )}

                          {(() => {
                            const cWagons = wagons.filter(w => w.consigneeCode === c.consigneeCode)
                            return (
                              <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                                <WagonIcon size={11} />
                                {cWagons.length > 0
                                  ? cWagons.map(w => (
                                    <span key={w.wagonNo} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 'var(--r-full)', background: 'var(--navy-100)', color: 'var(--navy-700)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                                      {w.wagonNo}
                                    </span>
                                  ))
                                  : <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>No wagon assigned</span>
                                }
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* ── Wagons column ── */}
                <div style={{ width: 170, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }} className="wagons-column">
                  <div style={{ padding: '8px 8px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 11.5, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>Wagons ({wagons.length})</span>
                      {activeWagon && (
                        <span style={{ fontSize: 9.5, color: 'var(--navy-600)', fontFamily: 'var(--font-mono)', fontWeight: 700, maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ◉ {activeWagon}
                        </span>
                      )}
                    </div>
                    <div className="search-input-wrapper">
                      <span className="search-icon"><SearchIcon size={12} /></span>
                      <input
                        className="form-control"
                        placeholder="Search…"
                        value={wagonSearch}
                        onChange={e => setWagonSearch(e.target.value)}
                        style={{ fontSize: 11.5, padding: '4px 8px 4px 26px' }}
                      />
                    </div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 8px' }}>
                    {filteredWagons.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>
                        {wagonSearch ? 'No matches.' : 'No wagons in this rake.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
                        {filteredWagons.map(w => {
                          const isActive = activeWagon === w.wagonNo
                          const assignedCons = w.consigneeCode
                            ? (session.consignees.find(c => c.consigneeCode === w.consigneeCode) ||
                               Object.values(sessions).flatMap(s => s.consignees).find(c => c.consigneeCode === w.consigneeCode))
                            : null
                          const isForActiveCons = w.consigneeCode === activeCode
                          const canSelect = !w.consigneeCode || w.consigneeCode === activeCode
                          const platesLoaded = session.consignees.flatMap(c => c.plates).filter(p => p.wagonNo === w.wagonNo && p.loaded).length
                          const totalLoadedWeight = session.consignees.flatMap(c => c.plates).filter(p => p.wagonNo === w.wagonNo && p.loaded && p.pcWgt).reduce((sum, p) => sum + (parseFloat(p.pcWgt) || 0), 0)
                          return (
                            <div
                              key={w.wagonNo}
                              style={{
                                display: 'flex', gap: 4, alignItems: 'stretch',
                                borderRadius: 'var(--r-md)',
                                overflow: 'hidden',
                              }}
                            >
                              {/* Wagon Content - 80% */}
                              <div
                                onClick={() => canSelect
                                  ? handleSelectWagon(w.wagonNo)
                                  : toast.error(`Wagon ${w.wagonNo} is assigned to ${assignedCons?.consigneeName || w.consigneeCode}`)
                                }
                                style={{
                                  flex: '0 0 calc(100% - 32px)',
                                  display: 'flex', flexDirection: 'column', gap: 5,
                                  padding: '7px 8px',
                                  borderRadius: 'var(--r-md)',
                                  border: `${isActive ? '2px' : '1.5px'} solid ${isActive ? 'var(--navy-600)' : canSelect ? 'var(--border-subtle)' : 'var(--border-default)'}`,
                                  background: isActive ? 'var(--navy-100)' : canSelect ? 'var(--bg-surface)' : 'var(--gray-50)',
                                  boxShadow: isActive ? '0 0 0 3px rgba(59,110,196,0.2), var(--shadow-md)' : 'none',
                                  cursor: canSelect ? 'pointer' : 'not-allowed',
                                  opacity: !canSelect ? 0.55 : 1,
                                  userSelect: 'none',
                                }}
                              >
                                {/* Header: Wagon# and Load Stats */}
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, width: '100%' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 1, minWidth: 0 }}>
                                    <WagonIcon size={11} style={{ flexShrink: 0 }} />
                                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 11.5, color: isActive ? 'var(--navy-700)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {w.wagonNo}
                                    </span>
                                  </div>
                                  {platesLoaded > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexShrink: 0 }}>
                                      <span style={{ fontSize: 9.5, color: 'var(--green-700)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                                        {platesLoaded} Plates /
                                      </span>
                                      {totalLoadedWeight > 0 && (
                                        <span style={{ fontSize: 9, color: 'var(--green-700)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                                          {totalLoadedWeight.toFixed(1)}T
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Consignee Info */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                  {assignedCons ? (
                                    <div style={{ fontSize: 10, color: isForActiveCons ? 'var(--navy-600)' : 'var(--text-muted)', fontWeight: isForActiveCons ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                                      {assignedCons.consigneeName}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: 9.5, color: 'var(--text-muted)', fontStyle: 'italic' }}>Unassigned</div>
                                  )}
                                  {isActive && (
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--navy-500)', flexShrink: 0 }} />
                                  )}
                                </div>
                              </div>

                              {/* Unlink Button - 20% */}
                              {isForActiveCons && (
                                <button
                                  title="Unlink wagon from this consignee"
                                  onClick={e => { e.stopPropagation(); handleUnlinkWagon(w.wagonNo) }}
                                  style={{
                                    flex: '0 0 32px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'var(--red-50)',
                                    border: '1.5px solid var(--red-200)',
                                    borderRadius: 'var(--r-md)',
                                    cursor: 'pointer',
                                    color: 'var(--red-600)',
                                    padding: 0,
                                    transition: 'all 0.15s ease',
                                  }}
                                  onMouseEnter={e => {
                                    e.currentTarget.style.background = 'var(--red-100)'
                                    e.currentTarget.style.borderColor = 'var(--red-300)'
                                  }}
                                  onMouseLeave={e => {
                                    e.currentTarget.style.background = 'var(--red-50)'
                                    e.currentTarget.style.borderColor = 'var(--red-200)'
                                  }}
                                >
                                  <span style={{ fontSize: 16, fontWeight: 600, lineHeight: 1 }}>×</span>
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>

            <div className="card active-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
              {!activeConsignee ? (
                <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="empty-state-icon"><SelectIcon size={22} /></div>
                  <div className="empty-state-title">Select a Consignee</div>
                  <div className="empty-state-text">Click a consignee on the left to begin loading its plates into the assigned wagon.</div>
                </div>
              ) : (
                <>
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span className="consignee-code-badge" style={{ fontSize: 13 }}>{activeConsignee.consigneeCode}</span>
                      <span style={{ fontWeight: 700, fontSize: 15.5, flex: 1 }}>{activeConsignee.consigneeName}</span>
                      {activeWagon ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--navy-100)', borderRadius: 'var(--r-full)', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--navy-700)' }}>
                          <WagonIcon size={12} /> {activeWagon}
                        </span>
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', border: '1px dashed var(--border-default)', borderRadius: 'var(--r-full)', fontSize: 12, color: 'var(--text-muted)' }}>
                          <WagonIcon size={12} /> Select wagon
                        </span>
                      )}
                    </div>

                    {okPlates.length == 0 ? (
                      <div className="alert alert-warning" style={{ padding: '8px 12px', fontSize: 12 }}>
                        <WarnIcon size={13} />
                        No OK plates for this consignee yet.
                      </div>
                    ) : (
                      <div>
                      </div>
                    )}

                    {!activeWagon && allActivePlates.length > 0 && (
                      <div className="flag-row" style={{ marginTop: 8 }}>
                        <WarnIcon size={13} />
                        <span>No wagon selected. Select a wagon from the left panel before marking plates as loaded.</span>
                      </div>
                    )}

                    {nonOkPlates.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Other plate types:</span>
                        {['RA', 'TPI', 'MTI', 'DIV'].map(type => {
                          const cnt = nonOkPlates.filter(p => p.plateType === type).length
                          if (!cnt) return null
                          const cfg = PLATE_TYPE_CFG[type]
                          return (
                            <span
                              key={type}
                              title={cfg.desc}
                              style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 'var(--r-full)', background: cfg.bg, color: cfg.color, fontWeight: 600 }}
                            >
                              {cnt} {cfg.label} - {cfg.desc}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div className="search-input-wrapper" style={{ flex: 1, minWidth: 140 }}>
                      <span className="search-icon"><SearchIcon size={13} /></span>
                      <input
                        className="form-control"
                        placeholder="Filter by plate no., heat, grade..."
                        value={plateFilter}
                        onChange={e => setPlateFilter(e.target.value)}
                        style={{ fontSize: 12.5 }}
                      />
                    </div>
                    {nonOkPlates.length > 0 && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={showNonOk} onChange={e => setShowNonOk(e.target.checked)} />
                        RA/TPI/MTI/DIV
                      </label>
                    )}
                  </div>

                  <div className="plate-list" style={{ flex: 1, padding: '8px 14px', overflowY: 'auto' }}>
                    {allActivePlates.length === 0 && (
                      <div className="empty-state" style={{ padding: '20px 0' }}>
                        <div className="empty-state-icon"><PlateIcon size={20} /></div>
                        <div className="empty-state-title">No plates</div>
                        <div className="empty-state-text">Plates appear here once heat/BFD allocation is complete.</div>
                      </div>
                    )}

                    {allActivePlates.length > 0 && visibleAllPlates.length === 0 && (
                      <div className="empty-state" style={{ padding: '12px 0' }}>
                        <div className="empty-state-text">No plates match the filter.</div>
                      </div>
                    )}

                    {visibleAllPlates.length > 0 && visibleAllPlates.map((p, idx) => {
                      const cfg = p.plateType === 'OK' ? null : (PLATE_TYPE_CFG[p.plateType] || PLATE_TYPE_CFG.DIV)
                      const currentWagon = p.wagonNo || '(No Wagon)'
                      const prevWagon = idx > 0 ? (visibleAllPlates[idx - 1].wagonNo || '(No Wagon)') : null
                      const showWagonHeader = currentWagon !== prevWagon
                      const orderForPlate = activeConsignee?.orders?.find(o => o.ordNo === p.ordNo)
                      const balValue = orderForPlate?.bal ?? null

                      return (
                        <React.Fragment key={p.plateNo}>
                          {showWagonHeader && (
                            <div style={{
                              margin: '10px 0 5px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                              paddingLeft: 4,
                              borderLeft: `3px solid ${p.wagonNo ? 'var(--navy-400)' : 'var(--border-subtle)'}`
                            }}>
                              <WagonIcon size={13} style={{ color: p.wagonNo ? 'var(--navy-600)' : 'var(--text-muted)' }} />
                              <span style={{
                                fontSize: 11.5,
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 700,
                                color: p.wagonNo ? 'var(--navy-700)' : 'var(--text-muted)',
                                minWidth: 60
                              }}>
                                {currentWagon}
                              </span>
                            </div>
                          )}
                          <div
                            className={`plate-item ${p.loaded ? 'loaded' : ''}`}
                            onClick={() => togglePlate(activeCode, p.plateNo)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                          >
                            <div className="plate-check">{p.loaded && <CheckIcon size={11} />}</div>
                            {cfg && (
                              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 'var(--r-full)', background: cfg.bg, color: cfg.color, fontWeight: 700, flexShrink: 0 }}>
                                {cfg.label}
                              </span>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 2 }}>
                                <span className="plate-no" style={{ fontSize: 12.5, fontWeight: 600 }}>{p.plateNo}</span>
                              </div>
                              <div style={{ fontSize: 10.5, color: 'var(--text-secondary)', display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className="plate-grade" style={{ fontWeight: 700, color: 'var(--navy-700)' }}>{p.grade}</span>
                                {p.ordSize && <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{p.ordSize}</span>}
                                {p.tdc && <span style={{ fontWeight: 700, color: 'var(--navy-700)' }}>{p.tdc}</span>}
                                {p.pcWgt && <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{p.pcWgt}T </span>}
                                {balValue !== null && <span style={{ color: 'var(--text-secondary)', fontWeight: 600, marginLeft: 2 }}>BAL: {balValue}</span>}
                              </div>
                            </div>
                            {p.colourCd && (
                              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 'var(--r-full)', background: 'var(--gray-100)', color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontWeight: 500, flexShrink: 0 }}>
                                {p.colourCd}
                              </span>
                            )}
                            {p.loaded && p.wagonNo && (
                              <span style={{ fontSize: 9, color: 'var(--green-700)', fontFamily: 'var(--font-mono)', fontWeight: 600, flexShrink: 0 }}>
                                {p.wagonNo}
                              </span>
                            )}
                            {p.loaded && <span style={{ fontSize: 10, color: 'var(--green-700)', fontWeight: 700, flexShrink: 0 }}>✓</span>}
                            <button
                              className="btn btn-ghost btn-icon"
                              style={{ padding: '2px 3px', flexShrink: 0 }}
                              onClick={e => { e.stopPropagation(); handlePlateDetail(p) }}
                              title="Details"
                            >
                              <InfoIcon size={12} />
                            </button>
                          </div>
                        </React.Fragment>
                      )
                    })}
                  </div>

                  {allActivePlates.length > 0 && (
                    <div className="quick-entry" style={{ flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                        <input
                          ref={quickEntryRef}
                          className="form-control mono"
                          placeholder="Type plate number to find &amp; load…"
                          value={quickEntry}
                          onChange={e => handleQuickInputChange(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && quickResult) { e.preventDefault(); handleQuickLoad() } }}
                          style={{ fontSize: 13, flex: 1 }}
                        />
                        {quickEntry && (
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => { setQuickEntry(''); setQuickResult(null); setQuickError(''); quickEntryRef.current?.focus() }}
                            title="Clear"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      {isFetchingPlate && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                          <span className="spinner spinner-sm" /> Searching…
                        </div>
                      )}

                      {quickError && (
                        <div className="form-error">{quickError}</div>
                      )}

                      {quickResult && !quickError && (() => {
                        const isListPlate = quickResult.type === 'list'
                        const p = isListPlate ? quickResult.plate : null
                        const info = isListPlate ? null : quickResult.apiInfo
                        const plateNo  = p?.plateNo  || info?.PLATE_NO  || quickEntry
                        const grade    = p?.grade    || info?.GRADE    || ''
                        const heatNo   = p?.heatNo   || info?.HEAT_NO  || ''
                        const size     = p?.ordSize  || info?.PLATE_SIZE || ''
                        const weight   = p?.pcWgt    || (info?.WGT ? parseFloat(info.WGT) : null)
                        const tdc      = p?.tdc      || info?.TDC      || ''
                        const mech      = info?.MECH_RESULT || ''
                        const consigneeNm = info?.CONSIGNEE_NM || ''
                        const ordNo     = info?.ORD_NO || (p?.ordNo) || ''
                        const nextJob   = info?.NEXT_JOB || ''
                        const ordStatus = info?.ORD_STATUS || ''
                        const ordFlag   = info?.ORD_FLAG || ''
                        const alreadyLoaded = p?.loaded
                        return (
                          <div style={{
                            background: alreadyLoaded ? 'var(--green-50)' : 'var(--navy-50)',
                            border: `1px solid ${alreadyLoaded ? 'var(--green-200)' : 'var(--navy-200)'}`,
                            borderRadius: 'var(--r-md)',
                            padding: '8px 10px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            width: '100%',
                          }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color: 'var(--navy-700)' }}>{plateNo}</span>
                                {!isListPlate && (
                                  <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 'var(--r-full)', background: 'var(--amber-100)', color: 'var(--amber-700)', fontWeight: 600 }}>Not in list</span>
                                )}
                                {alreadyLoaded && (
                                  <span style={{ fontSize: 9.5, padding: '1px 5px', borderRadius: 'var(--r-full)', background: 'var(--green-100)', color: 'var(--green-700)', fontWeight: 600 }}>Already loaded</span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                                {grade  && <span><span style={{ color: 'var(--text-muted)' }}>Grade </span>{grade}</span>}
                                {heatNo && <span style={{ fontFamily: 'var(--font-mono)' }}>{heatNo}</span>}
                                {size   && <span>{size}</span>}
                                {weight && <span>{weight}T</span>}
                                {tdc    && <span><span style={{ color: 'var(--text-muted)' }}>TDC </span>{tdc}</span>}
                                {mech      && <span style={{ color: mech === 'OK' ? 'var(--green-700)' : 'var(--amber-700)', fontWeight: 600 }}>{mech}</span>}
                                {consigneeNm && <span><span style={{ color: 'var(--text-muted)' }}>Consignee </span>{consigneeNm}</span>}
                                {ordNo     && <span><span style={{ color: 'var(--text-muted)' }}>Order </span>{ordNo}</span>}
                                {nextJob   && <span><span style={{ color: 'var(--text-muted)' }}>Next Job </span>{nextJob}</span>}
                                {ordStatus && <span><span style={{ color: 'var(--text-muted)' }}>Status </span>{ordStatus}</span>}
                                {ordFlag   && <span><span style={{ color: 'var(--text-muted)' }}>Flag </span>{ordFlag}</span>}
                              </div>
                            </div>
                            {!alreadyLoaded ? (
                              <button
                                className="btn btn-success btn-sm"
                                onClick={handleQuickLoad}
                                style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
                              >
                                <CheckIcon size={12} /> Load
                              </button>
                            ) : (
                              <span style={{ fontSize: 11, color: 'var(--green-700)', fontWeight: 600, flexShrink: 0 }}>✓ Done</span>
                            )}
                          </div>
                        )
                      })()}

                      {!quickResult && !quickError && !isFetchingPlate && (
                        <div className="form-hint">Type a plate number to search. Found plates show a Load button.</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {step === 'COMPLETED' && session && (
        <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ border: '2px solid var(--green-200)' }}>
            <div className="card-header" style={{ background: 'var(--green-50)' }}>
              <div className="card-icon" style={{ background: 'var(--green-100)', color: 'var(--green-700)' }}>
                <CheckCircleIcon />
              </div>
              <div>
                <div className="card-title" style={{ color: 'var(--green-700)' }}>Loading Session Completed</div>
                <div className="card-subtitle">Rake {session.rakeId} - {session.destination?.name}</div>
              </div>
              <span className="badge badge-success" style={{ marginLeft: 'auto' }}><span className="badge-dot" />Completed</span>
            </div>
            <div className="card-body">
              {submission.status !== 'idle' && (
                <div style={{ marginBottom: 16 }}>
                  {submission.status === 'submitting' && (
                    <div className="alert alert-info" style={{ alignItems: 'center', gap: 10 }}>
                      <span className="spinner spinner-sm" />
                      <span>Submitting wagon records… {submission.succeeded + submission.failed} / {submission.total}</span>
                    </div>
                  )}
                  {submission.status === 'done' && (
                    <div className="alert alert-success">
                      <CheckCircleIcon size={15} />
                      <span>All {submission.succeeded} wagon record{submission.succeeded !== 1 ? 's' : ''} marked as completed.</span>
                    </div>
                  )}
                  {submission.status === 'partial' && (
                    <div className="alert alert-danger" style={{ flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <WarnIcon size={15} />
                        <span>
                          <strong>{submission.failed} of {submission.total}</strong> wagon submission{submission.failed !== 1 ? 's' : ''} failed.
                          {' '}{submission.succeeded} succeeded.
                        </span>
                      </div>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={handleRetrySubmission}
                        disabled={submission.status === 'submitting'}
                      >
                        Retry Failed ({submission.failed})
                      </button>
                    </div>
                  )}
                </div>
              )}
              <div className="stat-grid" style={{ marginBottom: 20 }}>
                <div className="stat-tile"><div className="stat-label">Total Weight (T)</div><div className="stat-value">{completedLoadedWeight.toFixed(2)}</div></div>
                <div className="stat-tile"><div className="stat-label">Plates Loaded</div><div className="stat-value" style={{ color: 'var(--green-700)' }}>{completedLoaded}</div></div>
                <div className="stat-tile"><div className="stat-label">Consignees</div><div className="stat-value">{completedConsigneesWithLoads}</div></div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button className="btn btn-primary btn-lg" onClick={handleExportPdf} disabled={exporting}>
                  {exporting ? <><span className="spinner spinner-sm" />Generating...</> : <><PdfIcon /> Download PDF</>}
                </button>
                <button className="btn btn-secondary" onClick={handleExportJson} disabled={exporting}><JsonIcon /> Export JSON</button>
                <button className="btn btn-ghost" onClick={() => {
                  setStep('RAKE_ENTRY')
                  setSession(null)
                  setSessions({})
                  setRakeInput('')
                  setRakeInfo(null)
                  setSelectedDest(null)
                  setActiveCode(null)
                  setActiveWagon(null)
                  setWagons([])
                  localStorage.removeItem(SESSION_KEY)
                  localStorage.removeItem(SESSIONS_MAP_KEY)
                  loadedDetailsRef.current = null
                }}>
                  Start New Session
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><div className="card-title">Wagon Summary</div></div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Wagon No.</th>
                    <th>Consignee</th>
                    <th>Destination</th>
                    <th>Plates Loaded</th>
                    <th>Weight Loaded</th>
                    <th>Marked Complete</th>
                  </tr>
                </thead>
                <tbody>
                  {wagonSummary.map(w => (
                    <tr key={w.wagonNo}>
                      <td>
                        <div className="td-mono" style={{ fontWeight: 600, fontSize: 12 }}>{w.wagonNo}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{w.consigneeName}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{w.consigneeCode}</div>
                      </td>
                      <td>
                        {w.destination ? (
                          <div>
                            <div style={{ fontWeight: 500 }}>{w.destination.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{w.destination.code}</div>
                          </div>
                        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="td-mono" style={{ color: 'var(--green-700)', fontWeight: 600 }}>{w.platesCount}</td>
                      <td className="td-mono" style={{ fontWeight: 600 }}>{w.totalWeight > 0 ? `${w.totalWeight.toFixed(1)}T` : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                      <td>
                        {w.isCompleted ? (
                          <span className="badge badge-success" style={{ fontSize: 10.5 }}>
                            <span className="badge-dot" />Completed
                          </span>
                        ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {plateDetail && (
        <div style={{
          position: 'fixed',
          bottom: 80,
          right: 20,
          zIndex: 600,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--r-lg)',
          boxShadow: 'var(--shadow-xl)',
          padding: '14px 16px',
          minWidth: 260,
          maxWidth: 320,
          animation: 'scaleIn 0.15s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13, color: 'var(--navy-700)' }}>{plateDetail.plateNo}</span>
            {plateDetail.plateType !== 'OK' && (() => {
              const cfg = PLATE_TYPE_CFG[plateDetail.plateType]
              return <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 'var(--r-full)', background: cfg?.bg, color: cfg?.color, fontWeight: 700 }}>{cfg?.label}</span>
            })()}
            {!plateDetail._apiInfo && <span className="spinner spinner-sm" style={{ marginLeft: 'auto', marginRight: 6 }} />}
            <button className="btn btn-ghost btn-icon btn-sm" style={{ marginLeft: plateDetail._apiInfo ? 'auto' : 0 }} onClick={() => setPlateDetail(null)}>×</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
            {[
              ['Heat No.',    plateDetail._apiInfo?.HEAT_NO   || plateDetail.heatNo],
              ['Grade',       plateDetail._apiInfo?.GRADE     || plateDetail.grade],
              ['TDC',         plateDetail._apiInfo?.TDC       || plateDetail.tdc],
              ['Colour',      plateDetail._apiInfo?.COLOUR_CD || plateDetail.colourCd],
              ['Size',        plateDetail._apiInfo?.PLATE_SIZE || plateDetail.ordSize],
              ['Weight',      (plateDetail._apiInfo?.WGT || plateDetail.pcWgt) ? `${plateDetail._apiInfo?.WGT || plateDetail.pcWgt} T` : null],
              ['Order',       plateDetail._apiInfo?.ORD_NO    || plateDetail.ordNo],
              ['Mech Result', plateDetail._apiInfo?.MECH_RESULT || null],
              ['Loadable',    plateDetail._apiInfo?.LOADABLE  || null],
              ['Next Job',    plateDetail._apiInfo?.NEXT_JOB  || null],
              ['Consignee',   plateDetail._apiInfo?.CONSIGNEE_NM || null],
            ].map(([label, val]) => val ? (
              <div key={label} style={{ display: 'flex', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>{label}</span>
                <span style={{ fontWeight: 500, fontFamily: ['Heat No.', 'Weight'].includes(label) ? 'var(--font-mono)' : 'inherit' }}>{val}</span>
              </div>
            ) : null)}
          </div>
        </div>
      )}
      {/* developed by github.com/ishans2404 */}
      <Modal
        open={showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        title="Complete Wagons"
        size="modal-lg"
        footer={
          <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', width: '100%' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => {
              const allSess = session ? { ...sessions, [session.destination.code]: session } : sessions
              const wagonsWithPlates = wagons.filter(w =>
                Object.values(allSess).some(s => s?.consignees?.some(c => c.plates.some(p => p.loaded && p.wagonNo === w.wagonNo)))
              )
              setWagonsToComplete(new Set(wagonsWithPlates.map(w => w.wagonNo)))
            }}>Select All</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCompleteModal(false)}>Cancel</button>
              <button
                className="btn btn-success btn-sm"
                onClick={handleCompleteWagons}
                disabled={wagonsToComplete.size === 0}
              >
                <CompleteIcon /> Complete{wagonsToComplete.size > 0 ? ` (${wagonsToComplete.size})` : ''} Wagon{wagonsToComplete.size !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        }
      >
        {session && (() => {
          const allSess = { ...sessions, [session.destination.code]: session }
          const wagonsWithPlates = wagons.filter(w =>
            Object.values(allSess).some(s => s?.consignees?.some(c => c.plates.some(p => p.loaded && p.wagonNo === w.wagonNo)))
          )
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="alert alert-info" style={{ fontSize: 12.5 }}>
                <InfoIcon size={14} />
                Select wagons to mark as completed. This is a final action - it confirms loading is done for those wagons.
              </div>
              {wagonsWithPlates.length === 0 ? (
                <div className="empty-state" style={{ padding: '20px 0' }}>
                  <div className="empty-state-title">No wagons with loaded plates</div>
                  <div className="empty-state-text">Load plates into wagons before completing.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {wagonsWithPlates.map(w => {
                    const isSelected = wagonsToComplete.has(w.wagonNo)
                    const allConsignees = Object.values(allSess).flatMap(s => s?.consignees || [])
                    const cons = allConsignees.find(c => c.consigneeCode === w.consigneeCode)
                    const loadedPlatesForWagon = allConsignees
                      .flatMap(c => c.plates)
                      .filter(p => p.wagonNo === w.wagonNo && p.loaded)
                    const platesLoaded = loadedPlatesForWagon.length
                    const totalWgt = loadedPlatesForWagon
                      .filter(p => p.pcWgt)
                      .reduce((sum, p) => sum + (parseFloat(p.pcWgt) || 0), 0)
                    return (
                      <div
                        key={w.wagonNo}
                        onClick={() => setWagonsToComplete(prev => {
                          const next = new Set(prev)
                          next.has(w.wagonNo) ? next.delete(w.wagonNo) : next.add(w.wagonNo)
                          return next
                        })}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                          border: `${isSelected ? '2px' : '1px'} solid ${isSelected ? 'var(--green-400)' : 'var(--border-subtle)'}`,
                          borderRadius: 'var(--r-md)',
                          background: isSelected ? 'var(--green-50)' : 'var(--bg-surface)',
                          cursor: 'pointer', userSelect: 'none', transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: 'var(--r-sm)',
                          border: `2px solid ${isSelected ? 'var(--green-600)' : 'var(--border-default)'}`,
                          background: isSelected ? 'var(--green-600)' : 'var(--bg-surface)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#fff',
                        }}>
                          {isSelected && <CheckIcon size={10} />}
                        </div>
                        <WagonIcon size={14} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>{w.wagonNo}</div>
                          {cons && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{cons.consigneeName} · {w.consigneeCode}</div>}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--green-700)', fontWeight: 700 }}>{platesLoaded} plate{platesLoaded !== 1 ? 's' : ''}</div>
                          {totalWgt > 0 && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{totalWgt.toFixed(2)} T</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}
      </Modal>
    </AppShell>
  )
}

function StepBar({ steps, active }) {
  return (
    <div className="steps">
      {steps.map((label, i) => (
        <React.Fragment key={label}>
          <div className={`step ${i < active ? 'done' : i === active ? 'active' : ''}`}>
            <div className="step-circle">{i < active ? <CheckIcon size={11} /> : i + 1}</div>
            <span className="step-label">{label}</span>
          </div>
          {i < steps.length - 1 && <div className={`step-connector ${i < active ? 'done' : ''}`} />}
        </React.Fragment>
      ))}
    </div>
  )
}

function LoadIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
}

function DestIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
}

function SearchIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
}

function WagonIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13" rx="1" /><path d="M16 8h4l3 3v5h-7V8z" />
    <circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
}

function CheckIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
}

function CheckCircleIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
  </svg>
}

function ArrowRightIcon({ size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
  </svg>
}

function BackIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
}

function InfoIcon({ size = 15 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
  </svg>
}

function WarnIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
}

function SelectIcon({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
  </svg>
}

function PlateIcon({ size = 20 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="10" rx="1" /><rect x="5" y="4" width="14" height="3" rx="1" />
  </svg>
}

function UnlinkIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
    <line x1="4" y1="4" x2="20" y2="20"/>
  </svg>
}

function CompleteIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
}

function SaveIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
    <polyline points="17 21 17 13 7 13 7 21"/>
    <polyline points="7 3 7 8 15 8"/>
  </svg>
}

function JsonIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
}

function PdfIcon({ size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" /><path d="M9 13h.01M15 13h.01M9 17h6" />
  </svg>
}
