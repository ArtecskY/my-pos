import { useState, useEffect } from 'react'

function formatDate(dateStr) {
  const date = new Date(dateStr.replace(' ', 'T'))
  return date.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [items, setItems] = useState({})

  const [showExport, setShowExport] = useState(false)
  const [savedSheetId, setSavedSheetId] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [inputSheetId, setInputSheetId] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [exportMsg, setExportMsg] = useState('')
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    fetch('/orders').then(r => r.json()).then(setOrders)
  }, [])

  async function loadSheetConfig() {
    const data = await fetch('/sheet-config').then(r => r.json())
    setSavedSheetId(data.sheet_id)
    setInputSheetId(data.sheet_id ?? '')
    setEditMode(!data.sheet_id)
  }

  function openExport() {
    setExportMsg('')
    setSaveMsg('')
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
    setExportMsg('')
    setExporting(true)
    const res = await fetch('/export-to-sheets', { method: 'POST' })
    const data = await res.json()
    setExporting(false)
    setExportMsg(res.ok ? `✅ ${data.message}` : `❌ ${data.error}`)
  }

  async function toggleOrder(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!items[id]) {
      const res = await fetch(`/orders/${id}/items`)
      const data = await res.json()
      setItems(prev => ({ ...prev, [id]: data }))
    }
  }

  async function deleteOrder(id) {
    if (!confirm(`ลบรายการ #${id}? สต็อกสินค้าจะถูกคืนกลับ`)) return
    const res = await fetch(`/orders/${id}`, { method: 'DELETE' })
    if (!res.ok) { alert('ลบไม่สำเร็จ กรุณาลองใหม่'); return }
    setOrders(prev => prev.filter(o => o.id !== id))
    setItems(prev => { const n = { ...prev }; delete n[id]; return n })
    if (expanded === id) setExpanded(null)
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h2 className="font-semibold text-slate-800">ประวัติการทำรายการ</h2>
        <button
          onClick={openExport}
          className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm cursor-pointer"
        >
          <img src="https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_32dp.png" className="w-4 h-4" />
          Export to Google Sheets
        </button>
      </div>

      {orders.length === 0
        ? <p className="text-slate-400 text-center py-6">ยังไม่มีรายการ</p>
        : (
          <div className="space-y-2">
            {orders.map(order => (
              <div key={order.id} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-center">
                  <button
                    onClick={() => toggleOrder(order.id)}
                    className="flex-1 flex justify-between items-center px-4 py-3 hover:bg-slate-50 cursor-pointer"
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                        #{order.id}
                      </span>
                      <span className="text-sm text-slate-600">
                        {order.transfer_time ? formatDate(order.transfer_time) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-blue-900">฿{order.total}</span>
                      <span className="text-slate-300 text-xs">{expanded === order.id ? '▲' : '▼'}</span>
                    </div>
                  </button>
                  <button
                    onClick={() => deleteOrder(order.id)}
                    className="px-3 py-3 text-slate-300 hover:text-red-500 cursor-pointer"
                    title="ลบรายการ"
                  >
                    🗑
                  </button>
                </div>

                {expanded === order.id && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
                    {items[order.id]
                      ? items[order.id].map(item => (
                          <div key={item.id} className="flex justify-between text-sm">
                            <span className="text-slate-600">{item.name} × {item.quantity}</span>
                            <span className="text-slate-700 font-medium">฿{item.price * item.quantity}</span>
                          </div>
                        ))
                      : <p className="text-slate-400 text-sm text-center py-1">กำลังโหลด...</p>
                    }
                    <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                      {order.transfer_amount != null && (
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">จำนวนเงินโอน</span>
                          <span className="text-slate-700 font-medium">฿{order.transfer_amount}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">เวลาทำรายการ</span>
                        <span className="text-slate-700">{formatDate(order.created_at)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      }

      {/* Export Modal */}
      {showExport && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[440px]">
            <h2 className="font-bold text-slate-800 mb-1">Export to Google Sheets</h2>
            <p className="text-sm text-slate-400 mb-5">ข้อมูลจะแยกตาม Tab วันที่ (พ.ศ.) โดยอัตโนมัติ</p>

            {/* Sheet ID section */}
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
