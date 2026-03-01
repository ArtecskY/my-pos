import { useState, useEffect, useMemo, useRef } from 'react'

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

function Tooltip({ transfer_time, created_at }) {
  const [show, setShow] = useState(false)
  const ref = useRef(null)
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono">{formatTimeOnly(transfer_time)}</span>
      <span
        ref={ref}
        className="relative"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        <span className="text-slate-300 hover:text-blue-400 cursor-help text-xs select-none">ⓘ</span>
        {show && (
          <div className="absolute left-5 top-1/2 -translate-y-1/2 z-50 bg-slate-800 text-white text-xs rounded-lg px-3 py-2.5 whitespace-nowrap shadow-xl pointer-events-none">
            {transfer_time && <div className="mb-1"><span className="text-slate-400">โอน: </span>{formatDateTimeFull(transfer_time)}</div>}
            <div><span className="text-slate-400">บันทึก: </span>{formatDateTimeFull(created_at)}</div>
          </div>
        )}
      </span>
    </div>
  )
}

function buildProductName(item) {
  if (item.merged) return item.mergedName ?? '—'
  // UID products ที่มีราคาทุน: แสดง x{qty} เสมอ
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
  const [selectedDate, setSelectedDate] = useState(null)

  const [showExport, setShowExport] = useState(false)
  const [savedSheetId, setSavedSheetId] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [inputSheetId, setInputSheetId] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [exportMsg, setExportMsg] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetch('/order-items').then(r => r.json()).then(setOrderItems)
  }, [])

  // จัดกลุ่มตามวันที่ แล้วค่อยจัดกลุ่มตาม order_id
  const groupedByDate = useMemo(() => {
    const dateMap = new Map()

    for (const item of orderItems) {
      const rawDate = item.transfer_time || item.created_at
      const dateKey = getDateKey(rawDate)

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          dateKey,
          rawDate,
          orders: [],
          orderMap: {},
        })
      }

      const dateGroup = dateMap.get(dateKey)

      if (!dateGroup.orderMap[item.order_id]) {
        const g = {
          order_id: item.order_id,
          transfer_time: item.transfer_time,
          created_at: item.created_at,
          transfer_amount: item.transfer_amount,
          total: item.total,
          items: [],
        }
        dateGroup.orderMap[item.order_id] = g
        dateGroup.orders.push(g)
      }

      const order = dateGroup.orderMap[item.order_id]

      // merge email-credit rows ที่ category + email เหมือนกัน
      if (item.credit_deducted != null && item.email_used) {
        const existing = order.items.find(
          i => i.category_name === item.category_name && i.email_used === item.email_used && i.credit_deducted != null
        )
        if (existing) {
          existing.credit_deducted = Number(existing.credit_deducted) + Number(item.credit_deducted)
          existing.merged = true
          const dollarPat = /(\d+(?:\.\d+)?)\$/
          const m1 = dollarPat.exec(existing.product_name)
          const m2 = dollarPat.exec(item.product_name)
          if (m1 && m2) {
            if (existing.mergedDollarTotal === undefined) {
              existing.mergedDollarTotal = Number(m1[1]) * existing.quantity
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

  const currentGroup = groupedByDate.find(g => g.dateKey === selectedDate)

  const dayTotal = currentGroup?.orders.reduce((s, o) => s + (Number(o.transfer_amount) || 0), 0) ?? 0

  async function deleteOrder(id) {
    if (!confirm(`ลบรายการ #${id}? สต็อกสินค้าจะถูกคืนกลับ`)) return
    const res = await fetch(`/orders/${id}`, { method: 'DELETE' })
    if (!res.ok) { alert('ลบไม่สำเร็จ กรุณาลองใหม่'); return }
    setOrderItems(prev => prev.filter(i => i.order_id !== id))
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
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-slate-800 text-lg">ประวัติการทำรายการ</h2>
        <button
          onClick={openExport}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm cursor-pointer"
        >
          <img src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png" className="w-4 h-4" />
          Export to Google Sheets
        </button>
      </div>

      {groupedByDate.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm text-center text-slate-400">ยังไม่มีรายการ</div>
      ) : (
        <>
          {/* Date tabs */}
          <div className="flex gap-2 flex-wrap">
            {groupedByDate.map(g => (
              <button
                key={g.dateKey}
                onClick={() => setSelectedDate(g.dateKey)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                  g.dateKey === selectedDate
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {formatThaiDateShort(g.rawDate)}
                <span className={`ml-1.5 text-xs ${g.dateKey === selectedDate ? 'text-blue-100' : 'text-slate-400'}`}>
                  ({g.orders.length})
                </span>
              </button>
            ))}
          </div>

          {currentGroup && (
            <>
              {/* Dashboard header */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl px-6 py-4 border border-blue-100 flex items-center justify-between">
                <div>
                  <p className="text-xs text-blue-400 font-medium uppercase tracking-wide mb-0.5">วันที่</p>
                  <p className="text-xl font-bold text-blue-900">{formatThaiDate(currentGroup.rawDate)}</p>
                </div>
                <div className="flex gap-8 text-right">
                  <div>
                    <p className="text-xs text-slate-400 mb-0.5">จำนวนรายการ</p>
                    <p className="text-2xl font-bold text-slate-700">{currentGroup.orders.length}</p>
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
                      <th className="pb-3 pt-4 px-4 font-medium">Order No.</th>
                      <th className="pb-3 pt-4 px-3 font-medium">ยอดโอน</th>
                      <th className="pb-3 pt-4 px-3 font-medium">เวลา</th>
                      <th className="pb-3 pt-4 px-3 font-medium">ชื่อเกม</th>
                      <th className="pb-3 pt-4 px-3 font-medium">ชื่อสินค้า</th>
                      <th className="pb-3 pt-4 px-3 font-medium text-right">จำนวน / เครดิต</th>
                      <th className="pb-3 pt-4 px-3 font-medium">Email ที่ใช้</th>
                      <th className="pb-3 pt-4 px-2"></th>
                    </tr>
                  </thead>
                  {currentGroup.orders.map(order => {
                    const orderUsdTotal = order.items.reduce((s, i) => s + (i.price_usd_used != null ? Number(i.price_usd_used) : 0), 0)
                    const hasUsd = orderUsdTotal > 0
                    return (
                    <tbody key={order.order_id} className="border-t border-slate-100">
                      {order.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          {/* Order No. */}
                          {idx === 0 && (
                            <td rowSpan={order.items.length} className="py-3 px-4 align-top">
                              <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                                #{order.order_id}
                              </span>
                            </td>
                          )}
                          {/* ยอดโอน */}
                          {idx === 0 && (
                            <td rowSpan={order.items.length} className="py-3 px-3 align-top whitespace-nowrap">
                              {order.transfer_amount != null
                                ? <span className="font-semibold text-emerald-600">฿{Number(order.transfer_amount).toLocaleString()}</span>
                                : <span className="text-slate-300">—</span>
                              }
                            </td>
                          )}
                          {/* เวลา + tooltip */}
                          {idx === 0 && (
                            <td rowSpan={order.items.length} className="py-3 px-3 align-top text-slate-500 whitespace-nowrap">
                              <Tooltip transfer_time={order.transfer_time} created_at={order.created_at} />
                            </td>
                          )}
                          {/* ชื่อเกม — แสดงครั้งแรกเท่านั้น */}
                          <td className="py-2.5 px-3 text-slate-400 text-xs whitespace-nowrap">
                            {idx === 0 ? (item.category_name || <span className="text-slate-200">—</span>) : null}
                          </td>
                          {/* ชื่อสินค้า */}
                          <td className="py-2.5 px-3 text-slate-800 font-medium">
                            {buildProductName(item)}
                          </td>
                          {/* จำนวน / เครดิต */}
                          {hasUsd ? (
                            idx === 0 ? (
                              <td rowSpan={order.items.length} className="py-2.5 px-3 text-right align-middle whitespace-nowrap">
                                <span className="text-green-600 font-bold text-base">
                                  ${Number.isInteger(orderUsdTotal) ? orderUsdTotal : orderUsdTotal.toFixed(2)}
                                </span>
                              </td>
                            ) : null
                          ) : (
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              {item.credit_deducted != null ? (
                                <span className="text-blue-600 font-semibold">
                                  {Number(item.credit_deducted).toFixed(2)}
                                </span>
                              ) : item.cost_used != null && Number(item.cost_used) > 0 ? (
                                <span className="text-amber-700 font-semibold">
                                  {(() => { const v = Number(item.cost_used) * item.quantity; return Number.isInteger(v) ? v : v.toFixed(2) })()}
                                </span>
                              ) : (
                                <span className="text-slate-500">×{item.quantity}</span>
                              )}
                            </td>
                          )}
                          {/* Email */}
                          <td className="py-2.5 px-3 font-mono text-xs text-slate-400">
                            {item.email_used || <span className="text-slate-200">—</span>}
                          </td>
                          {/* ปุ่มลบ */}
                          {idx === 0 && (
                            <td rowSpan={order.items.length} className="py-3 px-2 align-top">
                              <button
                                onClick={() => deleteOrder(order.order_id)}
                                className="text-slate-200 hover:text-red-500 cursor-pointer transition-colors"
                                title="ลบรายการ"
                              >
                                🗑
                              </button>
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
        </>
      )}

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[440px]">
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
                    <button
                      onClick={saveSheetId}
                      disabled={!inputSheetId.trim()}
                      className="flex-1 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg text-sm cursor-pointer"
                    >
                      บันทึก
                    </button>
                    {savedSheetId && (
                      <button
                        onClick={() => { setInputSheetId(savedSheetId); setEditMode(false); setSaveMsg('') }}
                        className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-sm cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                  <span className="flex-1 text-sm font-mono text-slate-700 truncate">{savedSheetId}</span>
                  <button
                    onClick={() => { setEditMode(true); setSaveMsg('') }}
                    className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer whitespace-nowrap"
                  >
                    เปลี่ยน
                  </button>
                </div>
              )}
              {saveMsg && (
                <p className={`text-sm mt-2 ${saveMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</p>
              )}
            </div>

            {exportMsg && (
              <p className={`text-sm mb-4 ${exportMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{exportMsg}</p>
            )}

            <div className="flex gap-2.5">
              <button
                onClick={exportToSheets}
                disabled={exporting || !savedSheetId || editMode}
                className="flex-1 bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white py-2.5 rounded-lg cursor-pointer text-sm font-medium"
              >
                {exporting ? 'กำลัง Export...' : 'Export'}
              </button>
              <button
                onClick={() => { setShowExport(false); setExportMsg('') }}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-2.5 rounded-lg cursor-pointer text-sm"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
