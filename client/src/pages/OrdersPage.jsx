import { useState, useEffect, useMemo } from 'react'

function formatThaiDate(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr.replace(' ', 'T'))
  return date.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatTimeOnly(dateStr) {
  if (!dateStr) return '—'
  const date = new Date(dateStr.replace(' ', 'T'))
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export default function OrdersPage() {
  const [orderItems, setOrderItems] = useState([])

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

  // จัดกลุ่มตาม order_id โดยรักษาลำดับ
  const grouped = useMemo(() => {
    const map = {}
    const list = []
    for (const item of orderItems) {
      if (!map[item.order_id]) {
        const g = {
          order_id: item.order_id,
          transfer_time: item.transfer_time,
          created_at: item.created_at,
          transfer_amount: item.transfer_amount,
          total: item.total,
          items: [],
        }
        map[item.order_id] = g
        list.push(g)
      }
      map[item.order_id].items.push(item)
    }
    return list
  }, [orderItems])

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
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <div className="flex justify-between items-center mb-5">
        <h2 className="font-semibold text-slate-800">ประวัติการทำรายการ</h2>
        <button
          onClick={openExport}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm cursor-pointer"
        >
          <img src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png" className="w-4 h-4" />
          Export to Google Sheets
        </button>
      </div>

      {grouped.length === 0 ? (
        <p className="text-slate-400 text-center py-8">ยังไม่มีรายการ</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-slate-500 text-left border-b-2 border-slate-200">
                <th className="pb-2.5 px-3 font-medium">วันที่</th>
                <th className="pb-2.5 px-3 font-medium">เวลาโอน</th>
                <th className="pb-2.5 px-3 font-medium">ชื่อสินค้า</th>
                <th className="pb-2.5 px-3 font-medium text-right">จำนวน / เครดิต</th>
                <th className="pb-2.5 px-3 font-medium">Email ที่ใช้</th>
                <th className="pb-2.5 px-2"></th>
              </tr>
            </thead>
            {grouped.map(order => {
              const dateStr = order.transfer_time || order.created_at
              return (
                <tbody key={order.order_id} className="border-t-2 border-slate-100">
                  {order.items.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      {/* วันที่ — แสดงแค่แถวแรกของแต่ละ order */}
                      {idx === 0 && (
                        <td
                          rowSpan={order.items.length}
                          className="py-3 px-3 text-slate-600 align-top whitespace-nowrap"
                        >
                          {formatThaiDate(dateStr)}
                        </td>
                      )}
                      {/* เวลาโอน */}
                      {idx === 0 && (
                        <td
                          rowSpan={order.items.length}
                          className="py-3 px-3 font-mono text-slate-500 align-top whitespace-nowrap"
                        >
                          {formatTimeOnly(order.transfer_time)}
                        </td>
                      )}
                      {/* ชื่อสินค้า */}
                      <td className="py-2.5 px-3 text-slate-800">
                        {item.product_name}
                        {item.quantity > 1 && (
                          <span className="text-slate-400 ml-1.5 text-xs">×{item.quantity}</span>
                        )}
                      </td>
                      {/* จำนวน / เครดิต */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {item.credit_deducted != null ? (
                          <span className="text-blue-700 font-semibold">
                            {Number(item.credit_deducted).toFixed(2)} เครดิต
                          </span>
                        ) : item.price_usd_used != null ? (
                          <span className="text-green-700 font-semibold">
                            ${Number(item.price_usd_used).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-600">×{item.quantity}</span>
                        )}
                      </td>
                      {/* Email ที่ใช้ */}
                      <td className="py-2.5 px-3 font-mono text-xs text-slate-500">
                        {item.email_used || <span className="text-slate-300">—</span>}
                      </td>
                      {/* ปุ่มลบ — แสดงแค่แถวแรก */}
                      {idx === 0 && (
                        <td
                          rowSpan={order.items.length}
                          className="py-3 px-2 align-top"
                        >
                          <button
                            onClick={() => deleteOrder(order.order_id)}
                            className="text-slate-300 hover:text-red-500 cursor-pointer"
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
