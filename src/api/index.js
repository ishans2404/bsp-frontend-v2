/**
 * API Layer — BSP Plate Loading System
 * All network calls go through this module.
 */

const PROXY = '/api-proxy/MES_MOB/APP'
const LOADING_REPORT_CACHE_KEY = 'bsp_loading_report_cache_v1'
const LOADING_REPORT_CACHE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

let destinationsCache = null
let loadingReportCache = loadLoadingReportCache()
let loadingReportInFlight = {}

function loadLoadingReportCache() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(LOADING_REPORT_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}

    const now = Date.now()
    const valid = {}
    Object.entries(parsed).forEach(([destCode, entry]) => {
      if (!entry || typeof entry !== 'object') return
      if (!Array.isArray(entry.data)) return
      if (typeof entry.cachedAt !== 'number') return
      if (now - entry.cachedAt > LOADING_REPORT_CACHE_TTL_MS) return
      valid[destCode] = entry
    })
    return valid
  } catch {
    return {}
  }
}

function persistLoadingReportCache() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOADING_REPORT_CACHE_KEY, JSON.stringify(loadingReportCache))
  } catch {
    // Ignore storage quota/private mode issues.
  }
}

function getCachedLoadingReport(destCode) {
  const entry = loadingReportCache[destCode]
  if (!entry) return null
  if (Date.now() - entry.cachedAt > LOADING_REPORT_CACHE_TTL_MS) {
    delete loadingReportCache[destCode]
    persistLoadingReportCache()
    return null
  }
  return entry.data
}

function setCachedLoadingReport(destCode, data) {
  loadingReportCache[destCode] = {
    data,
    cachedAt: Date.now(),
  }
  persistLoadingReportCache()
}

// ══════════════════════════════════════════════════════════════════
//  DESTINATIONS
// ══════════════════════════════════════════════════════════════════
export async function fetchDestinations() {
  if (destinationsCache !== null) return destinationsCache
  try {
    const res = await fetch(`${PROXY}/destData.jsp`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    destinationsCache = normalizeDestinations(data)
    return destinationsCache
  } catch (err) {
    console.error('fetchDestinations failed:', err.message)
    throw err
  }
}

function normalizeDestinations(raw) {
  const arr = Array.isArray(raw) ? raw
    : Array.isArray(raw?.data) ? raw.data
      : Array.isArray(raw?.destinations) ? raw.destinations
        : Object.values(raw || {})
  return arr.map(d => {
    const code = d.dest_cd || d.code || d.DEST_CD || d.Code || String(d)
    let name = d.dest_nm || d.name || d.DEST_NM || d.Name || String(d)
    if (typeof name === 'string' && name.includes('/')) name = name.split('/').pop().trim()
    return { code, name }
  }).filter(d => d.code && d.name)
}

// ══════════════════════════════════════════════════════════════════
//  LOADING REPORT  (consignees + plates for a destination)
// ══════════════════════════════════════════════════════════════════
export async function fetchLoadingReport(destCode) {
  const cached = getCachedLoadingReport(destCode)
  if (cached) return cached
  if (loadingReportInFlight[destCode]) return loadingReportInFlight[destCode]

  const requestPromise = (async () => {
    try {
      const url = `${PROXY}/loaderReport.jsp?dest_cd=${destCode}&dispatch_mode=RAIL&ord_status=O`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const normalized = normalizeLoadingData(data, destCode)
      setCachedLoadingReport(destCode, normalized)
      return normalized
    } catch (err) {
      console.error('fetchLoadingReport failed:', err.message)
      throw err
    }
  })()

  loadingReportInFlight[destCode] = requestPromise

  try {
    return await requestPromise
  } finally {
    delete loadingReportInFlight[destCode]
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function parseConsigneeInfo(raw = '') {
  const m = raw.match(/^(.*?)\s*Consignee Code:\s*(\S+)/i)
  if (m) return { name: m[1].trim(), code: m[2].trim() }
  return { name: raw.trim(), code: raw.trim() }
}

function inferTypeFromContext(contextBefore, fieldDefault) {
  const upper = String(contextBefore || '').toUpperCase()
  const labels = [
    { type: 'OK', pattern: 'OK PLATES' },
    { type: 'RA', pattern: 'RA PLATES' },
    { type: 'TPI', pattern: 'TPI PLATES' },
    { type: 'MTI', pattern: 'MTI PENDING' },
    { type: 'DIV', pattern: 'DIV' },
  ]

  let best = { type: fieldDefault, idx: -1 }
  for (const { type, pattern } of labels) {
    const idx = upper.lastIndexOf(pattern)
    if (idx > best.idx) best = { type, idx }
  }
  return best.type
}

/**
 * Parse all plate numbers from one field string.
 * Supported patterns:
 * 1) OK format: B413518#OK-3514900,902,903
 * 2) Non-OK format: B412712-3513103,104,106
 */
function parseFieldPlates(fieldStr, fieldName) {
  if (!fieldStr || typeof fieldStr !== 'string') return []
  const str = fieldStr.trim()
  if (!str) return []

  const FIELD_DEFAULTS = {
    HEAT: 'OK',
    PLATES: 'RA',
    TPI_PLATES: 'TPI',
    MTI_PENDING_PLATES: 'MTI',
    DIV: 'DIV',
  }
  const fieldDefault = FIELD_DEFAULTS[fieldName] || 'OK'

  const out = []

  const okRe = /([A-Z]\d+)#OK-([\d,\s]+)/g
  let m
  while ((m = okRe.exec(str)) !== null) {
    const heatNo = m[1]
    const parts = m[2]
      .split(',')
      .map(s => s.trim())
      .filter(s => /^\d+$/.test(s))
    if (!parts.length) continue

    const first = parts[0]
    parts.forEach((num, idx) => {
      const plateNum = idx === 0 ? num : first.slice(0, first.length - num.length) + num
      out.push({ plateNo: `${plateNum}`, heatNo, plateType: 'OK' })
    })
  }

  const nonOkRe = /([A-Z]\d{5,6})-(\d{7,}(?:\s*,\s*\d+)*)/g
  while ((m = nonOkRe.exec(str)) !== null) {
    if (m.index > 0 && str[m.index - 1] === '#') continue

    const heatNo = m[1]
    const parts = m[2]
      .split(',')
      .map(s => s.trim())
      .filter(s => /^\d+$/.test(s))
    if (!parts.length) continue

    const first = parts[0]
    const type = inferTypeFromContext(str.substring(0, m.index), fieldDefault)

    parts.forEach((num, idx) => {
      const plateNum = idx === 0 ? num : first.slice(0, first.length - num.length) + num
      out.push({ plateNo: plateNum, heatNo, plateType: type })
    })
  }

  return out
}

function parseSize(ordSize = '') {
  const parts = ordSize.trim().split('x').map(s => s.trim())
  return {
    thickness: parts[0] || '',
    width: parts[1] || '',
    length: parts[2] || '',
  }
}

const PLATE_TYPE_ORDER = { OK: 0, RA: 1, TPI: 2, MTI: 3, DIV: 4 }

/**
 * Main normalizer — groups rows by consignee and extracts all plate types.
 * OK remains first priority in sorting and UI flows.
 */
export function normalizeLoadingData(raw, _destCode) {
  if (!Array.isArray(raw)) return []

  const map = new Map()

  for (const row of raw) {
    const { name, code } = parseConsigneeInfo(row.CONSIGNEE_NM || '')
    if (!code) continue

    if (!map.has(code)) {
      map.set(code, {
        consigneeCode: code,
        consigneeName: name,
        wagonNo: null,
        plates: [],
        orders: [],
      })
    }

    const c = map.get(code)

    const { thickness, width, length } = parseSize(row.ORD_SIZE || '')
    const order = {
      ordNo: row.ORD_NO || '',
      grade: row.GRADE || '',
      tdc: (row.TDC || '').trim(),
      colourCd: row.COLOUR_CD || '',
      ordSize: row.ORD_SIZE || '',
      thickness,
      width,
      length,
      pcWgt: row.PC_WGT ?? null,
      ordType: row.ORD_TYPE || '',
      usageGrp: row.USAGE_GRP || '',
      destNm: row.DEST_NM || '',
      dispatchMode: row.DISPATCH_MODE || '',
      ordThk: row.ORD_THK ?? null,
      ord: row.ORD ?? 0,
      desp: row.DESP ?? 0,
      bal: row.BAL ?? 0,
      bfr: row.BFR ?? 0,
      bfr1: row.BFR1 ?? null,
      fin: row.FIN ?? 0,
      finstk: row.FINSTK ?? 0,
      norm: row.NORM ?? 0,
      test: row.TEST ?? 0,
      ra: row.RA ?? 0,
      tpi: row.TPI ?? 0,
      nop: row.NOP ?? '',
      wgt: row.WGT || '',
      pmBfd: row.PM_BFD ?? 0,
      remart: (row.REMART || '').replace(/^\/|\/$/g, '').trim(),
      ordPr: (row.ORD_PR || '').trim(),
      nor: row.NOR || '',
      heatRaw: (row.HEAT || '').trim(),
      platesRaw: (row.PLATES || '').trim(),
      tpiPlatesRaw: (row.TPI_PLATES || '').trim(),
      mtiPendingRaw: (row.MTI_PENDING_PLATES || '').trim(),
      divRaw: (row.DIV || '').trim(),
    }
    c.orders.push(order)

    for (const [fieldName, fieldValue] of [
      ['HEAT', row.HEAT],
      ['PLATES', row.PLATES],
      ['TPI_PLATES', row.TPI_PLATES],
      ['MTI_PENDING_PLATES', row.MTI_PENDING_PLATES],
      ['DIV', row.DIV],
    ]) {
      const parsed = parseFieldPlates(fieldValue, fieldName)
      for (const { plateNo, heatNo, plateType } of parsed) {
        c.plates.push({
          plateNo,
          heatNo,
          plateType,
          ordNo: order.ordNo,
          grade: order.grade,
          tdc: order.tdc,
          colourCd: order.colourCd,
          ordSize: order.ordSize,
          thickness: order.thickness,
          width: order.width,
          length: order.length,
          pcWgt: order.pcWgt,
          loaded: false,
          loadedAt: null,
        })
      }
    }
  }

  for (const c of map.values()) {
    const byPhysicalPlate = new Map()
    for (const p of c.plates) {
      const key = p.plateNo.replace(/^OK-/, '')
      const existing = byPhysicalPlate.get(key)
      if (!existing) {
        byPhysicalPlate.set(key, p)
        continue
      }
      const oldRank = PLATE_TYPE_ORDER[existing.plateType] ?? 99
      const newRank = PLATE_TYPE_ORDER[p.plateType] ?? 99
      if (newRank < oldRank) byPhysicalPlate.set(key, p)
    }

    c.plates = Array.from(byPhysicalPlate.values())
      .sort((a, b) => {
        const rank = (PLATE_TYPE_ORDER[a.plateType] ?? 99) - (PLATE_TYPE_ORDER[b.plateType] ?? 99)
        if (rank !== 0) return rank
        return a.plateNo.localeCompare(b.plateNo)
      })

    c.okPlateCount = c.plates.filter(p => p.plateType === 'OK').length
    c.totalPlateCount = c.plates.length
  }

  return Array.from(map.values()).sort(
    (a, b) => b.okPlateCount - a.okPlateCount || a.consigneeName.localeCompare(b.consigneeName)
  )
}

// ══════════════════════════════════════════════════════════════════
//  PLATE INFO
// ══════════════════════════════════════════════════════════════════
export async function fetchPlateInfo(plateNo) {
  try {
    // Strip any existing /N suffix before appending /1
    const base = String(plateNo).replace(/\/\d+$/, '')
    const res = await fetch(`${PROXY}/plateInfo.jsp?plateNo=${encodeURIComponent(base)}/1`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data?.[0] || null
  } catch (err) {
    console.error('fetchPlateInfo failed:', err.message)
    throw err
  }
}

// ══════════════════════════════════════════════════════════════════
//  HOME / RAKES LIST
// ══════════════════════════════════════════════════════════════════

function normalizeRakeStatus(raw) {
  const s = String(raw || '').toUpperCase().trim()
  if (['IN_PROGRESS', 'INPROGRESS', 'IN PROGRESS', 'P', 'LOADING'].includes(s)) return 'IN_PROGRESS'
  if (['COMPLETED', 'COMPLETE', 'DONE', 'C', 'CLOSED'].includes(s)) return 'COMPLETED'
  return 'ACTIVE'
}

function cleanRakeDestName(name, code) {
  if (!name) return code || ''
  // Strip trailing slash-separated prefix (BSP sometimes returns "ZONE/DEST NAME")
  const cleaned = name.includes('/') ? name.split('/').pop().trim() : name.trim()
  // Strip trailing (CODE) if appended
  return cleaned.replace(new RegExp(`\\s*[/(]${code}[/)]?\\s*$`, 'i'), '').trim() || cleaned
}

function normalizeRakesList(raw) {
  const arr = Array.isArray(raw) ? raw
    : Array.isArray(raw?.data) ? raw.data
    : Object.values(raw || {})

  // Group by RakeId — API may return one row per rake or one row per destination
  const map = new Map()

  for (const row of arr) {
    const rakeId = String(
      row.RAKEID_INT || row.RakeId || row.RAKE_ID || row.rakeid || row.RAKEID || ''
    ).trim()
    if (!rakeId) continue

    if (!map.has(rakeId)) {
      map.set(rakeId, {
        rakeId,
        destinations: [],
        status: normalizeRakeStatus(row.STATUS || row.RAKE_STATUS || row.LOAD_STATUS || ''),
        totalWagons: row.TOTAL_WAGONS ?? row.TOT_WAGONS ?? row.NO_OF_WAGONS ?? null,
        createdAt: row.CREATED_TM || row.CREATED_DT || row.RAKE_DT || row.CREATE_DT || null,
        createdBy: (row.CREATED_ID || row.CREATED_BY || row.USER_ID || row.USERID || '').trim(),
        completedAt: row.COMPLETED_DT || row.COMP_DT || null,
        loadedPlates: row.LOADED_PLATES ?? row.LOAD_PLATES ?? null,
        totalPlates: row.TOTAL_PLATES ?? row.TOT_PLATES ?? null,
      })
    }

    const rake = map.get(rakeId)

    // Handle both single-dest (DEST_CD/DEST_NM) and dual-dest (DEST_CD1/DEST_NM1 + DEST_CD2/DEST_NM2)
    const pairs = [
      [row.DEST_CD1 || row.DEST_CD || row.dest_cd1 || row.dest_cd || '', row.DEST_NM1 || row.DEST_NM || row.dest_nm1 || row.dest_nm || ''],
      [row.DEST_CD2 || row.dest_cd2 || '', row.DEST_NM2 || row.dest_nm2 || ''],
    ]
    for (const [code, name] of pairs) {
      const c = code.trim()
      if (c && !rake.destinations.find(d => d.code === c)) {
        rake.destinations.push({ code: c, name: cleanRakeDestName(name, c) })
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return tb - ta
  })
}

export async function fetchRakesList() {
  try {
    const res = await fetch(`${PROXY}/getRakeidDet.jsp`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return normalizeRakesList(data)
  } catch (err) {
    console.error('fetchRakesList failed:', err.message)
    throw err
  }
}

// ══════════════════════════════════════════════════════════════════
//  RAKE — Generate & Fetch
// ══════════════════════════════════════════════════════════════════
export async function generateRakeId(dest1Code, dest2Code) {
  try {
    const params = `destCd1=${dest1Code}${dest2Code ? `&destCd2=${dest2Code}` : ''}`
    const res = await fetch(`${PROXY}/genRakeid.jsp?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const rakeId = data?.[0]?.RakeId
    if (!rakeId) throw new Error('Invalid rake response: RakeId not found')
    return { rakeId }
  } catch (err) {
    console.error('generateRakeId failed:', err.message)
    throw err
  }
}

export async function fetchRakeInfo(rakeId) {
  try {
    const res = await fetch(`${PROXY}/getRakeidDet.jsp?rakeid=${encodeURIComponent(rakeId)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const list = normalizeRakesList(data)
    if (list.length > 0) return list[0]
    // API returned no rows for this rake ID — return a safe stub so loading can proceed
    return {
      rakeId: String(rakeId),
      status: 'ACTIVE',
      destinations: [],
      totalWagons: null,
      createdAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error('fetchRakeInfo failed:', err.message)
    throw err
  }
}

// ══════════════════════════════════════════════════════════════════
//  SUBMIT LOADING — JSON export until backend ready
// ══════════════════════════════════════════════════════════════════
export async function submitLoadingSession(_sessionPayload) {
  await new Promise(r => setTimeout(r, 1200))
  return { success: true, referenceNo: `REF-${Date.now()}` }
}

