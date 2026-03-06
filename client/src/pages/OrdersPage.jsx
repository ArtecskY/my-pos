import { useState, useEffect, useMemo, useRef } from 'react'

const FILL_TYPE_BADGE = {
  'UID':        { label: 'UID',      cls: 'bg-slate-100 text-slate-600' },
  'EMAIL':      { label: 'Apple ID', cls: 'bg-blue-100 text-blue-700' },
  'RAZER':      { label: 'Razer',    cls: 'bg-green-100 text-green-700' },
  'ID_PASS':    { label: 'Stock77',  cls: 'bg-yellow-100 text-yellow-700' },
  'OTHER_UID':  { label: 'UID',      cls: 'bg-slate-100 text-slate-600' },
  'OTHER_EMAIL':{ label: 'Email',    cls: 'bg-purple-100 text-purple-700' },
}

function FillBadge({ fill_type, customTypes = [] }) {
  if (!fill_type) return <span className="text-slate-200 text-xs">—</span>
  const cfg = FILL_TYPE_BADGE[fill_type]
  if (cfg) return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
  // custom type
  const ct = customTypes.find(t => t.key === fill_type)
  if (ct) return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ct.color || 'bg-sky-100 text-sky-700'}`}>{ct.label}</span>
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">{fill_type}</span>
}

function formatThaiDate(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr.replace(' ', 'T'))
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatThaiDateShort(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr.replace(' ', 'T'))
  return date.toLocaleDateString('th-TH', { year: '2-digit', month: 'short', day: 'numeric' })
}

function formatTimeOnly(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr.replace(' ', 'T'))
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatDateTimeFull(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr.replace(' ', 'T'))
  return date.toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getDateKey(dateStr) {
  if (!dateStr) return 'unknown'
  return dateStr.slice(0, 10)
}

function InfoTooltip({ children, label = 'ⓘ' }) {
  const [show, setShow] = useState(false)
  const [above, setAbove] = useState(false)
  const ref = useRef(null)

  function handleMouseEnter() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setAbove(window.innerHeight - rect.bottom < 160)
    }
    setShow(true)
  }

  return (
    <span ref={ref} className="relative inline-block ml-1" onMouseEnter={handleMouseEnter} onMouseLeave={() => setShow(false)}>
      <span className="text-slate-300 hover:text-blue-400 cursor-help text-xs select-none">{label}</span>
      {show && (
        <div
          className={`absolute left-5 z-50 bg-slate-800 text-white text-xs rounded-lg px-3 py-2.5 shadow-xl pointer-events-none whitespace-pre ${above ? 'bottom-full mb-1' : 'top-1/2 -translate-y-1/2'}`}
          style={{ minWidth: '180px' }}
        >
          {children}
        </div>
      )}
    </span>
  )
}


function buildProductName(item) {
  if (item.merged) return item.mergedName ?? item.product_name
  if (item.cost_used != null && Number(item.cost_used) > 0) {
    return `${item.product_name} x${item.quantity}`
  }
  const dollarPat = /(\d+(?:\.\d+)?)\$/
  const m = dollarPat.exec(item.product_name)
  if (m && item.quantity > 1) {
    const total = Number(m[1]) * item.quantity
    return (Number.isInteger(total) ? total : total.toFixed(2)) + '$'
  }
  return item.product_name + (item.quantity > 1 ? ` ×${item.quantity}` : '')
}

export default function OrdersPage() {
  const [orderItems, setOrderItems] = useState([])
  const [customTypes, setCustomTypes] = useState([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedGame, setSelectedGame] = useState('')

  const [showExport, setShowExport] = useState(false)
  const [savedSheetId, setSavedSheetId] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [inputSheetId, setInputSheetId] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [exportMsg, setExportMsg] = useState('')
  const [exporting, setExporting] = useState(false)
  const [editTimeOrderId, setEditTimeOrderId] = useState(null)
  const [editTimeValue, setEditTimeValue] = useState('')
  const [editTimeValue2, setEditTimeValue2] = useState('')
  const [editAmountOrderId, setEditAmountOrderId] = useState(null)
  const [editAmountValue, setEditAmountValue] = useState('')

  useEffect(() => {
    function loadData() {
      fetch('/order-items').then(r => r.json()).then(setOrderItems)
      fetch('/email-types').then(r => r.json()).then(setCustomTypes)
    }
    loadData()
    const timer = setInterval(loadData, 8000)
    return () => clearInterval(timer)
  }, [])

  const groupedByDate = useMemo(() => {
    const dateMap = new Map()
    const dollarPat = /(\d+(?:\.\d+)?)\$/
    for (const item of orderItems) {
      const rawDate = item.transfer_time || item.created_at
      const dateKey = getDateKey(rawDate)
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { dateKey, rawDate, orders: [], orderMap: {} })
      }
      const dateGroup = dateMap.get(dateKey)
      if (!dateGroup.orderMap[item.order_id]) {
        const g = {
          order_id: item.order_id,
          transfer_time: item.transfer_time,
          transfer_time2: item.transfer_time2 || null,
          created_at: item.created_at,
          transfer_amount: item.transfer_amount,
          total: item.total,
          channel: item.channel || null,
          tw: item.tw || false,
          items: [],
        }
        dateGroup.orderMap[item.order_id] = g
        dateGroup.orders.push(g)
      }
      const order = dateGroup.orderMap[item.order_id]

      if (item.credit_deducted != null && item.email_used) {
        const existing = order.items.find(
          i => i.category_name === item.category_name && i.email_used === item.email_used && i.credit_deducted != null
        )
        if (existing) {
          existing.credit_deducted = Number(existing.credit_deducted) + Number(item.credit_deducted)
          existing.merged = true
          // Track individual components for ⓘ tooltip
          if (!existing.mergedItems) {
            const m1 = dollarPat.exec(existing.product_name)
            existing.mergedItems = [{ name: existing.product_name, qty: existing.quantity, dollarAmt: m1 ? Number(m1[1]) * existing.quantity : null }]
          }
          const m2 = dollarPat.exec(item.product_name)
          existing.mergedItems.push({ name: item.product_name, qty: item.quantity, dollarAmt: m2 ? Number(m2[1]) * item.quantity : null })

          const m1ex = dollarPat.exec(existing.mergedItems[0]?.name || '')
          if (m2) {
            if (existing.mergedDollarTotal === undefined) {
              existing.mergedDollarTotal = (m1ex ? Number(m1ex[1]) * existing.mergedItems[0].qty : 0)
            }
            existing.mergedDollarTotal += Number(m2[1]) * item.quantity
            const total = existing.mergedDollarTotal
            existing.mergedName = `${Number.isInteger(total) ? total : total.toFixed(2)}$`
          }
          continue
        }
      }
      order.items.push({ ...item })
    }
    return Array.from(dateMap.values())
  }, [orderItems])

  // auto-select วันล่าสุด
  useEffect(() => {
    if (groupedByDate.length > 0 && !selectedDate) {
      setSelectedDate(groupedByDate[0].dateKey)
    }
  }, [groupedByDate, selectedDate])

  // รายชื่อเกมทั้งหมด
  const uniqueGames = useMemo(() => {
    const s = new Set()
    for (const item of orderItems) { if (item.category_name) s.add(item.category_name) }
    return Array.from(s).sort()
  }, [orderItems])

  const currentGroup = groupedByDate.find(g => g.dateKey === selectedDate)

  const filteredOrders = useMemo(() => {
    if (!currentGroup) return []
    const orders = selectedGame
      ? currentGroup.orders.filter(o => o.items.some(i => i.category_name === selectedGame))
      : currentGroup.orders
    return [...orders].sort((a, b) => {
      const ta = (a.transfer_time || a.created_at || '').replace(' ', 'T')
      const tb = (b.transfer_time || b.created_at || '').replace(' ', 'T')
      return ta < tb ? 1 : ta > tb ? -1 : 0 // ล่าสุดขึ้นก่อน
    })
  }, [currentGroup, selectedGame])

  const dayTotal = filteredOrders.reduce((s, o) => s + (Number(o.transfer_amount) || 0), 0)

  function navigateDate(dir) {
    if (!selectedDate) return
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + dir)
    const next = d.toISOString().slice(0, 10)
    setSelectedDate(next)
    setSelectedGame('')
  }

  async function deleteOrder(id) {
    if (!confirm(`ลบรายการ #${id}? สต็อกสินค้าจะถูกคืนกลับ`)) return
    const res = await fetch(`/orders/${id}`, { method: 'DELETE' })
    if (!res.ok) { alert('ลบไม่สำเร็จ กรุณาลองใหม่'); return }
    setOrderItems(prev => prev.filter(i => i.order_id !== id))
  }

  function startEditTime(order) {
    const raw = order.transfer_time || order.created_at || ''
    setEditTimeOrderId(order.order_id)
    setEditTimeValue(raw ? raw.slice(11, 16) : '')
    setEditTimeValue2(order.transfer_time2 ? order.transfer_time2.slice(11, 16) : '')
  }

  async function saveEditTime(orderId) {
    if (!editTimeValue) { setEditTimeOrderId(null); return }
    const order = filteredOrders.find(o => o.order_id === orderId)
    const raw = order?.transfer_time || order?.created_at || ''
    const dateStr = raw.slice(0, 10)
    const formatted = `${dateStr} ${editTimeValue}:00`
    const formatted2 = editTimeValue2 ? `${dateStr} ${editTimeValue2}:00` : null
    const res = await fetch(`/orders/${orderId}/transfer-time`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transfer_time: formatted, transfer_time2: formatted2 }),
    })
    if (!res.ok) { alert('อัปเดตเวลาไม่สำเร็จ'); return }
    setOrderItems(prev => prev.map(i =>
      i.order_id === orderId ? { ...i, transfer_time: formatted, transfer_time2: formatted2 } : i
    ))
    setEditTimeOrderId(null)
  }

  function startEditAmount(order) {
    setEditAmountOrderId(order.order_id)
    setEditAmountValue(order.transfer_amount ?? '')
  }

  async function saveEditAmount(orderId) {
    const res = await fetch(`/orders/${orderId}/transfer-amount`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transfer_amount: Number(editAmountValue) }),
    })
    if (!res.ok) { alert('อัปเดตยอดโอนไม่สำเร็จ'); return }
    setOrderItems(prev => prev.map(i =>
      i.order_id === orderId ? { ...i, transfer_amount: Number(editAmountValue) } : i
    ))
    setEditAmountOrderId(null)
  }

  async function loadSheetConfig() {
    const data = await fetch('/sheet-config').then(r => r.json())
    setSavedSheetId(data.sheet_id)
    setInputSheetId(data.sheet_id ?? '')
    setEditMode(!data.sheet_id)
  }

  function openExport() {
    setExportMsg(''); setSaveMsg('')
    setShowExport(true)
    loadSheetConfig()
  }

  async function saveSheetId() {
    setSaveMsg('')
    const res = await fetch('/sheet-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_id: inputSheetId }),
    })
    const data = await res.json()
    if (!res.ok) { setSaveMsg(`❌ ${data.error}`); return }
    setSavedSheetId(data.sheet_id)
    setEditMode(false)
    setSaveMsg('✅ บันทึกแล้ว')
  }

  async function exportToSheets() {
    setExportMsg(''); setExporting(true)
    const res = await fetch('/export-to-sheets', { method: 'POST' })
    const data = await res.json()
    setExporting(false)
    setExportMsg(res.ok ? `✅ ${data.message}` : `❌ ${data.error}`)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-2">
        <h2 className="font-semibold text-slate-800 text-lg">ประวัติการทำรายการ</h2>
        <button
          onClick={openExport}
          className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-xs sm:text-sm cursor-pointer"
        >
          <img src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png" className="w-4 h-4" />
          Export to Google Sheets
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Date picker */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => navigateDate(-1)}
            className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 cursor-pointer text-sm"
          >←</button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => { setSelectedDate(e.target.value); setSelectedGame('') }}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white"
          />
          <button
            onClick={() => navigateDate(1)}
            className="px-2.5 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 cursor-pointer text-sm"
          >→</button>
        </div>

        {/* Game filter */}
        <select
          value={selectedGame}
          onChange={e => setSelectedGame(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white text-slate-700"
        >
          <option value="">ทุกเกม</option>
          {uniqueGames.map(g => <option key={g} value={g}>{g}</option>)}
        </select>

        {currentGroup && (
          <span className="text-sm text-slate-400">
            {formatThaiDate(currentGroup.rawDate)} · {filteredOrders.length} รายการ
          </span>
        )}
      </div>

      {!currentGroup || filteredOrders.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm text-center text-slate-400">
          {selectedDate ? 'ไม่มีรายการในวันที่เลือก' : 'ยังไม่มีรายการ'}
        </div>
      ) : (
        <>
          {/* Day summary */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl px-6 py-4 border border-blue-100 flex items-center justify-between">
            <div>
              <p className="text-xs text-blue-400 font-medium uppercase tracking-wide mb-0.5">วันที่</p>
              <p className="text-xl font-bold text-blue-900">{formatThaiDate(currentGroup.rawDate)}</p>
            </div>
            <div className="flex gap-8 text-right">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">จำนวนรายการ</p>
                <p className="text-2xl font-bold text-slate-700">{filteredOrders.length}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">ยอดโอนรวม</p>
                <p className="text-2xl font-bold text-emerald-600">฿{dayTotal.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-slate-500 text-left border-b-2 border-slate-100">
                  <th className="pb-3 pt-4 px-4 font-medium">No.</th>
                  <th className="pb-3 pt-4 px-3 font-medium">ยอดโอน</th>
                  <th className="pb-3 pt-4 px-3 font-medium">เวลา</th>
                  <th className="pb-3 pt-4 px-3 font-medium">ชื่อเกม</th>
                  <th className="pb-3 pt-4 px-3 font-medium">ชื่อสินค้า</th>
                  <th className="pb-3 pt-4 px-3 font-medium text-right">จำนวน / เครดิต</th>
                  <th className="pb-3 pt-4 px-3 font-medium">Email ที่ใช้</th>
                  <th className="pb-3 pt-4 px-3 font-medium text-center">ช่องทาง</th>
                  <th className="pb-3 pt-4 px-3 font-medium text-center">ประเภท</th>
                  <th className="pb-3 pt-4 px-2"></th>
                </tr>
              </thead>
              {filteredOrders.map((order, orderIdx) => {
                const orderUsdTotal = order.items.reduce((s, i) => {
                  if (i.price_usd_used == null) return s
                  // bundle: price_usd_used ถูก * quantity ไว้แล้วตอนบันทึก
                  // ID_PASS: price_usd_used คือราคาต่อหน่วย ต้องคูณ quantity
                  const qty = i.bundle_lot_info ? 1 : Number(i.quantity)
                  return s + Number(i.price_usd_used) * qty
                }, 0)
                const hasManual = order.items.some(i => i.manual_data)
                const hasUsd = orderUsdTotal > 0 && !hasManual
                const orderCostTotal = order.items.reduce((s, i) => {
                  if (i.manual_data || i.credit_deducted != null) return s
                  return s + (i.cost_used != null && Number(i.cost_used) > 0 ? Number(i.cost_used) * i.quantity : 0)
                }, 0)
                const hasCost = !hasUsd && !hasManual && !order.items.some(i => i.credit_deducted != null) && orderCostTotal > 0
                return (
                  <tbody key={order.order_id} className="border-t border-slate-100">
                    {order.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        {/* No. รีเซ็ตทุกวัน */}
                        {idx === 0 && (
                          <td rowSpan={order.items.length} className="py-3 px-4 align-top">
                            <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                              #{orderIdx + 1}
                            </span>
                          </td>
                        )}
                        {/* ยอดโอน */}
                        {idx === 0 && (
                          <td rowSpan={order.items.length} className="py-3 px-3 align-middle whitespace-nowrap">
                            {editAmountOrderId === order.order_id ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={editAmountValue}
                                  onChange={e => setEditAmountValue(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') saveEditAmount(order.order_id)
                                    if (e.key === 'Escape') setEditAmountOrderId(null)
                                  }}
                                  className="border border-blue-400 rounded px-1 py-0.5 text-xs font-mono w-20 focus:outline-none"
                                  autoFocus
                                />
                                <button onClick={() => saveEditAmount(order.order_id)} className="text-green-500 hover:text-green-700 text-xs cursor-pointer">✓</button>
                                <button onClick={() => setEditAmountOrderId(null)} className="text-slate-400 hover:text-slate-600 text-xs cursor-pointer">✕</button>
                              </div>
                            ) : (
                              <span
                                className="font-semibold text-emerald-600 cursor-pointer hover:text-emerald-700 hover:underline"
                                title="คลิกเพื่อแก้ไขยอดโอน"
                                onClick={() => startEditAmount(order)}
                              >
                                {order.transfer_amount != null
                                  ? `฿${Number(order.transfer_amount).toLocaleString()}`
                                  : <span className="text-slate-300 font-normal">—</span>
                                }
                              </span>
                            )}
                          </td>
                        )}
                        {/* เวลา */}
                        {idx === 0 && (
                          <td rowSpan={order.items.length} className="py-3 px-3 align-middle text-slate-500 whitespace-nowrap">
                            {editTimeOrderId === order.order_id ? (
                              <div className="flex flex-col gap-1">
                                <input
                                  type="time"
                                  value={editTimeValue}
                                  onChange={e => setEditTimeValue(e.target.value)}
                                  className="border border-blue-400 rounded px-1 py-0.5 text-xs font-mono w-24 focus:outline-none"
                                  autoFocus
                                />
                                <input
                                  type="time"
                                  value={editTimeValue2}
                                  onChange={e => setEditTimeValue2(e.target.value)}
                                  className="border border-slate-300 rounded px-1 py-0.5 text-xs font-mono w-24 focus:outline-none"
                                  placeholder="เวลา 2"
                                />
                                <div className="flex gap-1">
                                  <button onClick={() => saveEditTime(order.order_id)} className="text-green-500 hover:text-green-700 text-xs cursor-pointer">✓</button>
                                  <button onClick={() => setEditTimeOrderId(null)} className="text-slate-400 hover:text-slate-600 text-xs cursor-pointer">✕</button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <span
                                  className="font-mono cursor-pointer hover:text-blue-500 hover:underline"
                                  title="คลิกเพื่อแก้ไขเวลา"
                                  onClick={() => startEditTime(order)}
                                >
                                  {formatTimeOnly(order.transfer_time)}
                                  {order.transfer_time2 && `+${formatTimeOnly(order.transfer_time2)}`}
                                </span>
                                {order.tw && (
                                  <span className="text-xs font-bold px-1.5 py-0.5 bg-sky-100 text-sky-600 rounded">TW</span>
                                )}
                              </div>
                            )}
                          </td>
                        )}
                        {/* ชื่อเกม — แสดงเมื่อต่างจากแถวก่อน */}
                        <td className="py-2.5 px-3 text-slate-400 text-xs whitespace-nowrap">
                          {idx === 0 || item.category_name !== order.items[idx - 1]?.category_name
                            ? (item.category_name || <span className="text-slate-200">—</span>)
                            : null}
                        </td>
                        {/* ชื่อสินค้า + ⓘ */}
                        <td className="py-2.5 px-3 text-slate-800 font-medium">
                          {item.merged && !item.mergedName && item.mergedItems ? (
                            // Non-dollar merged (เช่น BLEACH) — แสดงชื่อแต่ละแพ็กเป็นบรรทัดๆ
                            <div className="space-y-0.5 leading-tight">
                              {item.mergedItems.map((mi, i) => (
                                <div key={i}>{mi.name} ×{mi.qty}</div>
                              ))}
                            </div>
                          ) : (
                            <>
                              <span>{buildProductName(item)}</span>
                              {/* ⓘ dollar merged — แสดง breakdown */}
                              {item.merged && item.mergedItems && (
                                <InfoTooltip>
                                  {item.mergedItems.map(mi =>
                                    `${mi.name} ×${mi.qty}${mi.dollarAmt != null ? ` = ${Number.isInteger(mi.dollarAmt) ? mi.dollarAmt : mi.dollarAmt.toFixed(2)}$` : ''}`
                                  ).join('\n')}
                                  {item.mergedDollarTotal != null
                                    ? `\n──────────\nรวม ${Number.isInteger(item.mergedDollarTotal) ? item.mergedDollarTotal : item.mergedDollarTotal.toFixed(2)}$`
                                    : ''}
                                </InfoTooltip>
                              )}
                            </>
                          )}
                        </td>
                        {/* จำนวน / เครดิต */}
                        {hasUsd ? (
                          idx === 0 ? (
                            <td rowSpan={order.items.length} className="py-2.5 px-3 text-right align-middle whitespace-nowrap">
                              <span className="text-slate-700 font-semibold text-sm">
                                ${Number.isInteger(orderUsdTotal) ? orderUsdTotal : orderUsdTotal.toFixed(2)}
                              </span>
                              {/* ⓘ ID-PASS — แสดงต้นทุน lot */}
                              <InfoTooltip>
                                {order.items.filter(i => i.price_usd_used != null || i.bundle_lot_info).map(i => {
                                  if (i.bundle_lot_info) {
                                    try {
                                      const comps = JSON.parse(i.bundle_lot_info)
                                      return `${i.product_name}\n` + comps.map(c =>
                                        `  ${c.name}${c.cost != null ? ` ต้นทุน ${c.cost}` : ''}`
                                      ).join('\n')
                                    } catch { return i.product_name }
                                  }
                                  return `${i.product_name}\n  ต้นทุน Lot: ${i.lot_cost_used != null ? `฿${i.lot_cost_used}` : '—'}`
                                }).join('\n')}
                              </InfoTooltip>
                            </td>
                          ) : null
                        ) : hasCost ? (
                          idx === 0 ? (
                            <td rowSpan={order.items.length} className="py-2.5 px-3 text-right align-middle whitespace-nowrap">
                              <span className="text-slate-700 font-semibold text-sm">
                                ฿{Number.isInteger(orderCostTotal) ? orderCostTotal : orderCostTotal.toFixed(2)}
                              </span>
                            </td>
                          ) : null
                        ) : (
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {item.manual_data ? (
                              item.cost_used != null && Number(item.cost_used) > 0
                                ? <span className="text-slate-700 font-semibold text-sm">฿{Number(item.cost_used).toLocaleString()}</span>
                                : <span className="text-slate-200">—</span>
                            ) : item.price_usd_used != null ? (() => {
                              const usdAmt = Number(item.price_usd_used) * (item.bundle_lot_info ? 1 : Number(item.quantity))
                              const tooltipText = item.bundle_lot_info ? (() => {
                                try {
                                  const comps = JSON.parse(item.bundle_lot_info)
                                  return comps.map(c => `${c.name}${c.cost != null ? ` ต้นทุน ${c.cost}` : ''}`).join('\n')
                                } catch { return item.product_name }
                              })() : `ต้นทุน Lot: ${item.lot_cost_used != null ? `฿${item.lot_cost_used}` : '—'}`
                              return (
                                <span className="text-slate-700 font-semibold text-sm">
                                  ${Number.isInteger(usdAmt) ? usdAmt : usdAmt.toFixed(2)}
                                  <InfoTooltip>{tooltipText}</InfoTooltip>
                                </span>
                              )
                            })() : item.credit_deducted != null ? (
                              <span className="text-slate-700 font-semibold text-sm">
                                {Number(item.credit_deducted).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-700 font-semibold text-sm">×{item.quantity}</span>
                            )}
                          </td>
                        )}
                        {/* Email */}
                        <td className="py-2.5 px-3 font-mono text-xs text-slate-400">
                          {item.email_used || <span className="text-slate-200">—</span>}
                        </td>
                        {/* ช่องทาง */}
                        {idx === 0 && (
                          <td rowSpan={order.items.length} className="py-3 px-3 align-middle text-center whitespace-nowrap">
                            {order.channel ? (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                order.channel === 'หน้าบ้าน'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-purple-100 text-purple-700'
                              }`}>
                                {order.channel}
                              </span>
                            ) : (
                              <span className="text-slate-200">—</span>
                            )}
                          </td>
                        )}
                        {/* ประเภท — แสดงทุกแถว */}
                        <td className="py-2.5 px-3 text-center whitespace-nowrap">
                          {item.manual_data ? (() => {
                            try {
                              const md = JSON.parse(item.manual_data)
                              return md.supplier_name
                                ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700">{md.supplier_name}</span>
                                : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">Manual</span>
                            } catch { return null }
                          })() : (
                            <FillBadge fill_type={item.fill_type} customTypes={customTypes} />
                          )}
                        </td>
                        {/* ปุ่มลบ */}
                        {idx === 0 && (
                          <td rowSpan={order.items.length} className="py-3 px-2 align-top">
                            <button
                              onClick={() => deleteOrder(order.order_id)}
                              className="text-slate-200 hover:text-red-500 cursor-pointer transition-colors"
                              title="ลบรายการ"
                            >🗑</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
        </>
      )}

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-end sm:items-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 w-full sm:max-w-[440px]">
            <h2 className="font-bold text-slate-800 mb-1">Export to Google Sheets</h2>
            <p className="text-sm text-slate-400 mb-5">ข้อมูลจะแยกตาม Tab วันที่ (พ.ศ.) โดยอัตโนมัติ</p>
            <div className="mb-5">
              <label className="block text-sm font-medium text-slate-600 mb-2">Google Sheet ID</label>
              {editMode ? (
                <div className="space-y-2">
                  <input
                    className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-green-500"
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
                    value={inputSheetId}
                    onChange={e => setInputSheetId(e.target.value)}
                    autoFocus
                  />
                  <p className="text-xs text-slate-400">
                    จาก URL: docs.google.com/spreadsheets/d/<span className="text-green-600 font-mono">SHEET_ID</span>/edit
                  </p>
                  <div className="flex gap-2">
                    <button onClick={saveSheetId} disabled={!inputSheetId.trim()} className="flex-1 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg text-sm cursor-pointer">บันทึก</button>
                    {savedSheetId && (
                      <button onClick={() => { setInputSheetId(savedSheetId); setEditMode(false); setSaveMsg('') }} className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm cursor-pointer">ยกเลิก</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="flex-1 text-sm font-mono text-slate-700 truncate">{savedSheetId}</span>
                  <button onClick={() => { setEditMode(true); setSaveMsg('') }} className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer whitespace-nowrap">เปลี่ยน</button>
                </div>
              )}
              {saveMsg && <p className={`text-sm mt-2 ${saveMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</p>}
            </div>
            {exportMsg && <p className={`text-sm mb-4 ${exportMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{exportMsg}</p>}
            <div className="flex gap-2.5">
              <button onClick={exportToSheets} disabled={exporting || !savedSheetId || editMode} className="flex-1 bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white py-2.5 rounded-lg cursor-pointer text-sm font-medium">
                {exporting ? 'กำลัง Export...' : 'Export'}
              </button>
              <button onClick={() => { setShowExport(false); setExportMsg('') }} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-2.5 rounded-lg cursor-pointer text-sm">ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
