/**
 * Export Utilities
 * - exportSessionJson: downloads session as JSON file
 * - generateLoadingPdf: creates PDF report using jsPDF + autotable
 */

// ── JSON Export ──────────────────────────────────────────────────
function resolveReportMode(session, explicitMode) {
  if (explicitMode === 'completion' || explicitMode === 'progress') return explicitMode
  return session?.step === 'COMPLETED' ? 'completion' : 'progress'
}

export function exportSessionJson(session) {
  const reportMode = resolveReportMode(session)
  const reportLabel = reportMode === 'completion' ? 'Completion' : 'Progress'
  const payload = buildSubmitPayload(session)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `BSP_Loading_${reportLabel}_${session.rakeId}_${formatDateForFile(new Date())}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function buildSubmitPayload(session) {
  const allSessions = session.allSessions
    ? Object.values(session.allSessions)
    : [session]

  const rakeWagons = session.wagons || []   // [{wagonNo, consigneeCode}]

  // Build a quick lookup: consigneeCode -> destinationCode
  const consToDest = {}
  allSessions.forEach(s =>
    s.consignees.forEach(c => { consToDest[c.consigneeCode] = s.destination?.code })
  )

  // Per-destination block
  const destinations = allSessions.map(s => {
    const destCode = s.destination?.code

    const consignees = s.consignees.map(c => {
      const loaded      = c.plates.filter(p => p.loaded)
      const assignedWagons = [...new Set(loaded.map(p => p.wagonNo).filter(Boolean))]

      return {
        consigneeCode:   c.consigneeCode,
        consigneeName:   c.consigneeName,
        wagons:          assignedWagons,
        platesLoaded:    loaded.length,
        plates: loaded.map(p => ({
          plateNo:   p.plateNo,
          plateType: p.plateType,
          grade:     p.grade,
          heatNo:    p.heatNo,
          ordNo:     p.ordNo  || null,
          size:      p.ordSize || null,
          weight:    p.pcWgt  || null,
          tdc:       p.tdc    || null,
          colourCd:  p.colourCd || null,
          loaded:    p.loaded,
          wagonNo:   p.wagonNo  || null,
          loadedAt:  p.loadedAt || null,
        })),
      }
    })

    // Wagon-level summary for this destination
    const destWagonNos = new Set(
      rakeWagons
        .filter(w => w.consigneeCode && consToDest[w.consigneeCode] === destCode)
        .map(w => w.wagonNo)
    )
    const wagons = [...destWagonNos].map(wNo => {
      const assignment = rakeWagons.find(w => w.wagonNo === wNo) || {}
      const cons = s.consignees.find(c => c.consigneeCode === assignment.consigneeCode)
      const platesInWagon = (cons?.plates || []).filter(p => p.loaded && p.wagonNo === wNo)
      return {
        wagonNo:       wNo,
        consigneeCode: assignment.consigneeCode || null,
        consigneeName: cons?.consigneeName     || null,
        platesLoaded:  platesInWagon.length,
      }
    })

    return {
      code:       s.destination?.code,
      name:       s.destination?.name,
      wagons,
      consignees,
    }
  })

  // Flat wagon list (all destinations)
  const wagons = rakeWagons.map(w => {
    const cons = allSessions
      .flatMap(s => s.consignees)
      .find(c => c.consigneeCode === w.consigneeCode)
    const platesLoaded = (cons?.plates || []).filter(p => p.loaded && p.wagonNo === w.wagonNo).length
    return {
      wagonNo:         w.wagonNo,
      consigneeCode:   w.consigneeCode || null,
      consigneeName:   cons?.consigneeName || null,
      destinationCode: w.consigneeCode ? consToDest[w.consigneeCode] || null : null,
      platesLoaded,
    }
  })

  // Summary
  const allConsignees  = allSessions.flatMap(s => s.consignees)
  const totalLoaded    = allConsignees.reduce((s, c) => s + c.plates.filter(p => p.loaded).length, 0)
  const reportMode = resolveReportMode(session)
  const nowIso = new Date().toISOString()
  const savedAt = session.savedAt || nowIso
  const completedAt = session.completedAt || nowIso

  return {
    rakeId:       session.rakeId,
    operatedBy:   session.operatedBy || 'admin',
    startedAt:    session.startedAt,
    savedAt,
    ...(reportMode === 'completion' ? { completedAt } : {}),
    reportType: reportMode.toUpperCase(),
    summary: {
      totalDestinations: destinations.length,
      totalConsignees:   allConsignees.length,
      totalWagons:       rakeWagons.length,
      platesLoaded:      totalLoaded,
    },
    destinations,
    wagons,
    loadingLog: allSessions.flatMap(s => s.loadingLog || []),
  }
}

// ── PDF Report ───────────────────────────────────────────────────
export async function generateLoadingPdf(session, reportMode) {
  const { default: jsPDF }     = await import('jspdf')
  const { default: autoTable } = await import('jspdf-autotable')

  const resolvedReportMode = resolveReportMode(session, reportMode)
  const isCompletionReport = resolvedReportMode === 'completion'
  const reportHeaderTitle = isCompletionReport
    ? 'BHILAI STEEL PLANT  —  PLATE MILL LOADING COMPLETION REPORT'
    : 'BHILAI STEEL PLANT  —  PLATE MILL LOADING PROGRESS REPORT'
  const reportTimestamp = isCompletionReport
    ? (session.completedAt || session.startedAt || new Date().toISOString())
    : (session.savedAt || new Date().toISOString())
  const completedWagonSet = new Set(Array.isArray(session.completedWagons) ? session.completedWagons : [])

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const PW  = doc.internal.pageSize.getWidth()   // 297
  const PH  = doc.internal.pageSize.getHeight()  // 210
  const M   = 12

  const allSessions   = session.allSessions ? Object.values(session.allSessions) : [session]
  const allConsignees = allSessions.flatMap(s => s.consignees)
  const rakeWagons    = session.wagons || []

  const totalLoaded = allConsignees.reduce((s, c) => s + c.plates.filter(p => p.loaded).length, 0)
  const destString  = allSessions.map(s => `${s.destination?.name || ''} (${s.destination?.code || ''})`).join(' · ')

  // ── Per-page header ────────────────────────────────────────────
  function drawPageHeader() {
    doc.setFillColor(15, 31, 61)
    doc.rect(0, 0, PW, 18, 'F')
    doc.setFillColor(234, 107, 26)
    doc.rect(0, 18, PW, 1.5, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(255, 255, 255)
    doc.text(reportHeaderTitle, M, 8)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(170, 195, 230)
    doc.text('STEEL AUTHORITY OF INDIA LIMITED  |  FOR INTERNAL USE ONLY', M, 14)

    doc.setFontSize(7.5)
    doc.setTextColor(200, 215, 235)
    doc.text(
      `Rake ID: ${session.rakeId}   |   Dest: ${destString}   |   ${formatDateTimeFull(new Date())}`,
      PW - M, 8, { align: 'right' }
    )
  }

  // ── Page 1: info + summary ─────────────────────────────────────
  drawPageHeader()
  let y = 23

  // Info block
  doc.setFillColor(239, 245, 253)
  doc.setDrawColor(168, 195, 237)
  doc.setLineWidth(0.3)
  doc.roundedRect(M, y, PW - M * 2, 20, 2, 2, 'FD')

  const infoItems = [
    ['RAKE ID',       String(session.rakeId)],
    ['DESTINATION',   destString],
    ['OPERATOR',      session.operatedBy || 'admin'],
    [isCompletionReport ? 'COMPLETED AT' : 'SAVED AT',  formatDateTimeFull(reportTimestamp)],
  ]
  const infoColW = (PW - M * 2) / infoItems.length
  infoItems.forEach(([label, value], i) => {
    const x = M + i * infoColW + 5
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(80, 110, 155)
    doc.text(label, x, y + 6)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(15, 31, 61)
    doc.text(String(value), x, y + 14, { maxWidth: infoColW - 10 })
  })
  y += 24

  // Summary tiles
  // Summary tiles — count only consignees with at least one loaded plate
  const consigneesWithLoads = allConsignees.filter(c => c.plates.some(p => p.loaded)).length
  const totalWeightLoaded = allConsignees.reduce((sum, c) => sum + c.plates
    .filter(p => p.loaded && p.pcWgt)
    .reduce((s, p) => s + (parseFloat(p.pcWgt) || 0), 0)
  , 0)

  // Count wagons that actually have loaded plates
  const loadedWagonsCount = new Set(
    allConsignees
      .flatMap(c => c.plates)
      .filter(p => p.loaded && p.wagonNo)
      .map(p => p.wagonNo)
  ).size

  const tiles = [
    { label: 'CONSIGNEES', value: consigneesWithLoads,        fg: [21, 43, 82],   bg: [240, 245, 255] },
    { label: 'WAGONS',     value: loadedWagonsCount,           fg: [21, 43, 82],   bg: [240, 245, 255] },
    { label: 'LOADED',     value: totalLoaded,                 fg: [21, 128, 61],  bg: [240, 253, 244] },
    { label: 'WEIGHT (T)', value: Number(totalWeightLoaded.toFixed(1)), fg: [234, 107, 26], bg: [255, 247, 235] },
  ]
  const tileW = (PW - M * 2) / tiles.length
  const tileH = 15
  tiles.forEach((t, i) => {
    const x = M + i * tileW
    doc.setFillColor(...t.bg)
    doc.setDrawColor(210, 220, 235)
    doc.rect(x, y, tileW, tileH, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6)
    doc.setTextColor(100, 120, 155)
    doc.text(t.label, x + tileW / 2, y + 4.5, { align: 'center' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...t.fg)
    doc.text(String(t.value), x + tileW / 2, y + 12, { align: 'center' })
  })
  y += tileH + 6

  // ── Per-destination loading detail ─────────────────────────────
  for (const sess of allSessions) {
    if (allSessions.length > 1) {
      if (y > PH - 35) { doc.addPage(); drawPageHeader(); y = 23 }
      doc.setFillColor(27, 56, 101)
      doc.rect(M, y, PW - M * 2, 7, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(255, 255, 255)
      doc.text(
        `DESTINATION:  ${sess.destination?.name || ''}  (${sess.destination?.code || ''})`,
        M + 4, y + 5
      )
      y += 10
    }

    for (const c of sess.consignees) {
      const loadedPlates = c.plates.filter(p => p.loaded)
      if (!loadedPlates.length) continue

      // Sort and group plates by wagon number for a single table with section dividers
      const sortedPlates = [...loadedPlates].sort((a, b) => {
        const wagA = (a.wagonNo || '').trim() || '~~~'
        const wagB = (b.wagonNo || '').trim() || '~~~'
        const wagonCompare = wagA.localeCompare(wagB, undefined, { numeric: true, sensitivity: 'base' })
        if (wagonCompare !== 0) return wagonCompare

        const plateCompare = String(a.plateNo || '').localeCompare(String(b.plateNo || ''), undefined, { numeric: true, sensitivity: 'base' })
        if (plateCompare !== 0) return plateCompare

        return String(a.loadedAt || '').localeCompare(String(b.loadedAt || ''))
      })

      const wagonsForCons = [...new Set(sortedPlates.map(p => (p.wagonNo || '').trim()).filter(Boolean))]
      if (sortedPlates.some(p => !(p.wagonNo || '').trim())) {
        wagonsForCons.push('Unassigned')
      }

      const groupedRows = []
      let currentWagonLabel = null
      let plateSerial = 0

      sortedPlates.forEach(p => {
        const wagonNo = (p.wagonNo || '').trim()
        const wagonLabel = wagonNo || 'Unassigned'
        const isCompletedWagon = wagonNo && completedWagonSet.has(wagonNo)

        if (wagonLabel !== currentWagonLabel) {
          groupedRows.push([
            {
              content: wagonNo ? `Wagon No.: ${wagonLabel}${isCompletedWagon ? '  (Complete)' : ''}` : 'Wagon No.: Unassigned',
              colSpan: 10,
              styles: {
                fillColor: [236, 240, 244],
                textColor: [54, 63, 78],
                fontStyle: 'bold',
                fontSize: 7.3,
                cellPadding: { top: 2, bottom: 2, left: 4, right: 4 },
                lineWidth: { top: 0.25, bottom: 0.25 },
                lineColor: [178, 188, 202],
              },
            },
          ])
          currentWagonLabel = wagonLabel
        }

        plateSerial += 1
        groupedRows.push([
          plateSerial,
          p.plateNo  || '—',
          p.plateType !== 'OK' ? p.plateType : '',
          p.heatNo   || '—',
          p.grade    || '—',
          p.ordSize  || '—',
          p.pcWgt != null ? Number(p.pcWgt).toFixed(3) : '—',
          p.tdc      || '—',
          p.wagonNo  || '—',
        ])
      })

      if (y > PH - 30) { doc.addPage(); drawPageHeader(); y = 23 }

      autoTable(doc, {
        startY: y,
        head: [
          [{ content: `${c.consigneeCode}  —  ${c.consigneeName}`, colSpan: 9 }],
          [{ content: `Wagon(s): ${wagonsForCons.join(', ') || 'N/A'}   |   Plates loaded: ${loadedPlates.length}`, colSpan: 9 }],
          ['Sl.', 'Plate No.', 'Type', 'Heat No.', 'Grade', 'Size (mm)', 'Wt. (T)', 'TDC', 'Wagon No.'],
        ],
        body: groupedRows,
        headStyles: { fillColor: [27, 56, 101], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        didParseCell(data) {
          if (data.section === 'head') {
            if (data.row.index === 0) {
              data.cell.styles.fillColor  = [15, 31, 61]
              data.cell.styles.fontSize   = 8.5
              data.cell.styles.cellPadding = { top: 3.5, bottom: 3.5, left: 4, right: 2 }
            }
            if (data.row.index === 1) {
              data.cell.styles.fillColor  = [42, 74, 130]
              data.cell.styles.textColor  = [190, 215, 255]
              data.cell.styles.fontSize   = 7
              data.cell.styles.fontStyle  = 'normal'
              data.cell.styles.cellPadding = { top: 2, bottom: 2, left: 4, right: 2 }
            }
            if (data.row.index === 2) {
              data.cell.styles.fillColor  = [21, 43, 82]
              data.cell.styles.fontSize   = 7.5
            }
          }
          if (data.section === 'body' && data.column.index === 8) {
            data.cell.styles.textColor  = [21, 56, 101]
            data.cell.styles.fontStyle  = 'bold'
          }
          if (data.section === 'body' && data.column.index === 2 && data.cell.text?.[0]) {
            data.cell.styles.textColor  = [180, 83, 9]
            data.cell.styles.fontStyle  = 'bold'
          }
        },
        bodyStyles: { fontSize: 7.5, cellPadding: { top: 2, bottom: 2, left: 3, right: 2 } },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 9,  halign: 'center' },
          1: { cellWidth: 34 },
          2: { cellWidth: 12, halign: 'center' },
          3: { cellWidth: 24 },
          4: { cellWidth: 28 },
          5: { cellWidth: 38 },
          6: { cellWidth: 20, halign: 'right' },
          7: { cellWidth: 28 },
          8: { cellWidth: 34 },
        },
        theme: 'striped',
        margin: { left: M, right: M },
        tableLineColor: [210, 220, 235],
        tableLineWidth: 0.2,
      })

      y = doc.lastAutoTable.finalY + 5
    }
  }

  // ── Wagon summary page ─────────────────────────────────────────
  doc.addPage()
  drawPageHeader()
  y = 23

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(15, 31, 61)
  doc.text(isCompletionReport ? 'WAGON-WISE COMPLETION SUMMARY' : 'WAGON-WISE PROGRESS SUMMARY', M, y)
  y += 5

  const wagonRows = []
  for (const sess of allSessions) {
    for (const c of sess.consignees) {
      const loaded = c.plates.filter(p => p.loaded)
      if (!loaded.length) continue
      const wNos = [...new Set(loaded.map(p => p.wagonNo).filter(Boolean))]
      if (!wNos.length) {
        const loadedWeight = loaded.reduce((s, p) => s + (parseFloat(p.pcWgt) || 0), 0)
        wagonRows.push(['—', c.consigneeCode, c.consigneeName, sess.destination?.code || '—', loaded.length, Number(loadedWeight.toFixed(3)), ''])
      } else {
        wNos.forEach(wNo => {
          const platesInWagon = loaded.filter(p => p.wagonNo === wNo)
          const weightInWagon = platesInWagon.reduce((s, p) => s + (parseFloat(p.pcWgt) || 0), 0)
          wagonRows.push([
            wNo,
            c.consigneeCode,
            c.consigneeName,
            sess.destination?.code || '—',
            platesInWagon.length,
            Number(weightInWagon.toFixed(3)),
            completedWagonSet.has(wNo) ? 'Complete' : '',
          ])
        })
      }
    }
  }

  autoTable(doc, {
    startY: y,
    head: [['Wagon No.', 'Cons. Code', 'Consignee Name', 'Dest.', 'Plates Loaded', 'Wt. (T)', 'Completed']],
    body: wagonRows,
    headStyles: { fillColor: [15, 31, 61], textColor: 255, fontSize: 8, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, cellPadding: 2.5 },
    didParseCell(data) {
      if (data.section === 'body' && data.column.index === 6 && data.cell.text?.[0]) {
        data.cell.styles.textColor = [21, 128, 61]
        data.cell.styles.fontStyle = 'bold'
      }
    },
    columnStyles: {
      0: { cellWidth: 40 },
      1: { cellWidth: 26 },
      2: { cellWidth: 96 },
      3: { cellWidth: 24 },
      4: { cellWidth: 28, halign: 'center', fontStyle: 'bold' },
      5: { cellWidth: 28, halign: 'center' },
      6: { cellWidth: 24, halign: 'center' },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    theme: 'striped',
    margin: { left: M, right: M },
  })

  y = doc.lastAutoTable.finalY + 22
  if (y > PH - 45) { doc.addPage(); drawPageHeader(); y = 40 }

  // Signature block
  const sigLabels = ['Prepared By (Operator)', 'Verified By (Supervisor)', 'Approved By (In-charge)']
  const sigW = (PW - M * 2) / 3
  sigLabels.forEach((label, i) => {
    const x = M + i * sigW
    doc.setDrawColor(160, 170, 190)
    doc.setLineWidth(0.4)
    doc.line(x + 8, y + 18, x + sigW - 8, y + 18)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(120, 130, 150)
    doc.text(label, x + sigW / 2, y + 22, { align: 'center' })
    doc.text('Date: ___________', x + sigW / 2, y + 27, { align: 'center' })
  })

  // Footer — page numbers on every page
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(160, 170, 185)
    doc.text(
      'Bhilai Steel Plant — Plate Mill Division, SAIL  |  This document is for internal use only',
      M, PH - 5
    )
    doc.text(`Page ${p} of ${totalPages}`, PW - M, PH - 5, { align: 'right' })
  }

  const reportLabel = isCompletionReport ? 'Completion' : 'Progress'
  doc.save(`BSP_Plate_Loading_${reportLabel}_${session.rakeId}_${formatDateForFile(new Date())}.pdf`)
}

// ── Helpers ──────────────────────────────────────────────────────
function formatDateForFile(d) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`
}

function formatDateTimeFull(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

// ── Wagon-wise submission ─────────────────────────────────────────
const FAILED_SUBMISSIONS_KEY = 'bsp_failed_submissions'

export function buildWagonPayloads(session) {
  const allSessions = session.allSessions
    ? Object.values(session.allSessions)
    : [session]

  const rakeWagons = session.wagons || []
  const payloads = []

  for (const sess of allSessions) {
    for (const wagon of rakeWagons) {
      if (!wagon.consigneeCode) continue
      const cons = sess.consignees.find(c => c.consigneeCode === wagon.consigneeCode)
      if (!cons) continue

      const loadedPlates = cons.plates.filter(p => p.loaded && p.wagonNo === wagon.wagonNo)
      if (!loadedPlates.length) continue

      payloads.push({
        rakeId:          session.rakeId,
        wagonNo:         wagon.wagonNo,
        consigneeCode:   cons.consigneeCode,
        destinationCode: sess.destination?.code || null,
        operatedBy:      session.operatedBy || 'admin',
        completedAt:     session.completedAt || new Date().toISOString(),
        plateNo: loadedPlates.map(p => p.plateNo),
      })
    }
  }

  return payloads
}

export async function submitWagonRequests(payloads, submitFn, onProgress, status = 1) {
  const results = { succeeded: [], failed: [] }

  await Promise.allSettled(
    payloads.map(async (payload) => {
      try {
        await submitFn(payload, status)
        results.succeeded.push(payload)
      } catch (err) {
        results.failed.push({ payload, error: err.message })
      }
      onProgress?.({
        succeeded: results.succeeded.length,
        failed:    results.failed.length,
        total:     payloads.length,
      })
    })
  )

  if (results.failed.length > 0) {
    try {
      localStorage.setItem(FAILED_SUBMISSIONS_KEY, JSON.stringify(results.failed))
    } catch {}
  } else {
    localStorage.removeItem(FAILED_SUBMISSIONS_KEY)
  }

  return results
}

export function loadFailedSubmissions() {
  try { return JSON.parse(localStorage.getItem(FAILED_SUBMISSIONS_KEY) || '[]') } catch { return [] }
}

export function clearFailedSubmissions() {
  localStorage.removeItem(FAILED_SUBMISSIONS_KEY)
}
