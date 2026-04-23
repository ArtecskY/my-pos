import { useState, useEffect } from 'react'

export default function RazerPage() {
  const [emails, setEmails] = useState([])
  const [accountTypes, setAccountTypes] = useState([])
  const [editModal, setEditModal] = useState(null)
  const [editCodes, setEditCodes] = useState('')
  const [editAccountType, setEditAccountType] = useState('')
  const [saving, setSaving] = useState(false)
  const [regenning, setRegenning] = useState({})
  const [msg, setMsg] = useState('')
  const [razerOrders, setRazerOrders] = useState([])
  const [searchEmail, setSearchEmail] = useState('')
  const [ordersCollapsed, setOrdersCollapsed] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [typeError, setTypeError] = useState('')
  const [serverRegenning, setServerRegenning] = useState(new Set())

  function loadEmails() {
    fetch('/emails').then(r => r.json())
      .then(all => setEmails(all.filter(e => e.fill_type === 'RAZER')))
  }
  function loadAccountTypes() {
    fetch('/razer-account-types').then(r => r.json()).then(setAccountTypes)
  }
  function loadRazerOrders() {
    fetch('/razer-orders').then(r => r.json()).then(setRazerOrders).catch(() => {})
  }
  function loadRegenStatus() {
    fetch('/razer-regen-status').then(r => r.json()).then(ids => setServerRegenning(new Set(ids))).catch(() => {})
  }

  useEffect(() => {
    loadEmails(); loadAccountTypes(); loadRazerOrders(); loadRegenStatus()
    const t = setInterval(() => { loadEmails(); loadAccountTypes(); loadRazerOrders(); loadRegenStatus() }, 3000)
    return () => clearInterval(t)
  }, [])

  async function addAccountType() {
    setTypeError('')
    if (!newTypeName.trim()) { setTypeError('กรุณากรอกชื่อ'); return }
    const res = await fetch('/razer-account-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTypeName.trim() }),
    })
    const d = await res.json()
    if (!res.ok) { setTypeError(d.error); return }
    setNewTypeName(''); loadAccountTypes()
  }

  async function deleteAccountType(id) {
    await fetch(`/razer-account-types/${id}`, { method: 'DELETE' })
    loadAccountTypes()
  }

  function openEdit(email) {
    setEditModal(email)
    setEditCodes((email.backup_codes || []).join('\n'))
    setEditAccountType(email.razer_account_type || '')
    setMsg('')
  }

  async function saveEdit() {
    if (!editModal) return
    setSaving(true)
    const codes = editCodes.split('\n').map(s => s.trim()).filter(Boolean)
    await fetch(`/emails/${editModal.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editModal, backup_codes: codes, razer_account_type: editAccountType || null }),
    })
    setSaving(false); setEditModal(null); loadEmails()
  }

  async function triggerRegen(id) {
    setRegenning(prev => ({ ...prev, [id]: true })); setMsg('')
    try {
      const res = await fetch(`/razer-accounts/${id}/regen`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) setMsg(d.error || 'เกิดข้อผิดพลาด')
    } catch {
      setMsg('ไม่สามารถเชื่อมต่อได้')
    } finally {
      // local state หาย แต่ serverRegenning จะค้าง spinner ต่อจนกว่า regen จะเสร็จจริง
      setRegenning(prev => ({ ...prev, [id]: false }))
    }
  }

  const botReadyCount = emails.filter(e => e.razer_account_type && (e.backup_codes || []).length > 0 && !e.broken).length
  const filteredEmails = emails.filter(e =>
    !searchEmail.trim() || e.email.toLowerCase().includes(searchEmail.toLowerCase())
  )

  const pendingCount = razerOrders.filter(o => o.razer_status === 'pending').length
  const processingCount = razerOrders.filter(o => o.razer_status === 'processing').length

  return (
    <div className="max-w-5xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Razer Bot Accounts</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            พร้อมใช้งาน <span className="font-semibold text-green-600">{botReadyCount}</span> / {emails.length} accounts
          </p>
        </div>
        {(pendingCount + processingCount) > 0 && (
          <div className="flex gap-2">
            {processingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                ⚙️ กำลังทำ {processingCount}
              </span>
            )}
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                ⏳ คิวรอ {pendingCount}
              </span>
            )}
          </div>
        )}
      </div>

      {msg && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">{msg}</div>
      )}

      {/* Razer Orders — collapsible */}
      {razerOrders.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <button
            onClick={() => setOrdersCollapsed(v => !v)}
            className="w-full px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-700 text-sm">รายการ Razer Auto ล่าสุด</h3>
              <span className="text-xs text-slate-400">({razerOrders.length} รายการ)</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">อัปเดตทุก 5 วินาที</span>
              <span className="text-slate-400 text-xs">{ordersCollapsed ? '▼' : '▲'}</span>
            </div>
          </button>

          {!ordersCollapsed && (
            <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {razerOrders.map(o => {
                const status = o.razer_status
                const badge =
                  status === 'success'     ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold whitespace-nowrap">✅ สำเร็จ</span>
                  : status === 'failed'   ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold whitespace-nowrap">❌ ล้มเหลว</span>
                  : status === 'processing' ? <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold whitespace-nowrap">⚙️ กำลังทำ</span>
                  : <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold whitespace-nowrap">⏳ รอ</span>

                const toThai = iso => {
                  if (!iso) return '—'
                  return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false,
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit' })
                }

                let durSec = null
                if (o.razer_started_at && o.razer_finished_at) {
                  durSec = Math.round((new Date(o.razer_finished_at) - new Date(o.razer_started_at)) / 1000)
                }

                return (
                  <div key={o.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-700 truncate">{o.product_name || `Order #${o.id}`}</p>
                      <p className="text-xs text-slate-400">
                        {toThai(o.created_at)} · ฿{Number(o.total).toFixed(2)}
                        {durSec !== null && <span className="ml-2 text-slate-300">⏱ {durSec}s</span>}
                      </p>
                      {o.razer_note && <p className="text-xs text-red-500 truncate max-w-sm">{o.razer_note}</p>}
                    </div>
                    <div className="flex-shrink-0">{badge}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Account Types + Accounts — side by side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Account Types */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h3 className="font-semibold text-slate-700 mb-3 text-sm">Account Types</h3>
          <div className="flex gap-2 mb-3">
            <input
              type="text" value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addAccountType()}
              placeholder="เช่น TH-A, SG-B..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
            <button onClick={addAccountType}
              className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm cursor-pointer font-medium">
              +
            </button>
          </div>
          {typeError && <p className="text-red-500 text-xs mb-2">{typeError}</p>}
          {accountTypes.length === 0 ? (
            <p className="text-slate-400 text-xs">ยังไม่มี Account Type</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {accountTypes.map(t => (
                <div key={t.id} className="flex items-center gap-1 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1">
                  <span className="text-xs font-semibold text-orange-700">{t.name}</span>
                  <button onClick={() => deleteAccountType(t.id)}
                    className="text-orange-400 hover:text-red-500 text-xs cursor-pointer leading-none">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Accounts Table */}
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {/* Search bar */}
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
            <input
              type="text" value={searchEmail}
              onChange={e => setSearchEmail(e.target.value)}
              placeholder="ค้นหา Email..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
            />
            {searchEmail && (
              <button onClick={() => setSearchEmail('')}
                className="text-slate-400 hover:text-slate-600 text-sm cursor-pointer">✕</button>
            )}
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {filteredEmails.length}/{emails.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 text-left">Email</th>
                  <th className="px-4 py-2.5 text-left">Type</th>
                  <th className="px-4 py-2.5 text-right">Credits</th>
                  <th className="px-4 py-2.5 text-center">Codes</th>
                  <th className="px-4 py-2.5 text-center">สถานะ</th>
                  <th className="px-4 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEmails.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-400 text-sm">
                    {searchEmail ? 'ไม่พบ Email ที่ค้นหา' : 'ยังไม่มี Razer accounts'}
                  </td></tr>
                )}
                {filteredEmails.map(email => {
                  const codes = email.backup_codes || []
                  const hasType = !!email.razer_account_type
                  const botReady = hasType && codes.length > 0 && !email.broken
                  const creditsNeg = Number(email.credits) < 0
                  return (
                    <tr key={email.id} className={
                      email.broken ? 'bg-red-50' :
                      email.is_locked ? 'bg-yellow-50' :
                      creditsNeg ? 'bg-orange-50' : ''
                    }>
                      <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[180px] truncate">{email.email}</td>
                      <td className="px-4 py-2.5">
                        {hasType
                          ? <span className="bg-orange-100 text-orange-700 rounded-full px-2 py-0.5 text-xs font-semibold">{email.razer_account_type}</span>
                          : <span className="bg-slate-100 text-slate-400 rounded-full px-2 py-0.5 text-xs">—</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono text-xs ${creditsNeg ? 'text-red-500 font-semibold' : 'text-slate-600'}`}>
                        {Number(email.credits).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          codes.length >= 3 ? 'bg-green-100 text-green-700' :
                          codes.length > 0  ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-red-100 text-red-700'}`}>
                          {codes.length}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {email.broken   && <span className="bg-red-100 text-red-600 rounded-full px-2 py-0.5 text-xs">Broken</span>}
                        {email.is_locked && <span className="bg-yellow-100 text-yellow-600 rounded-full px-2 py-0.5 text-xs">Locked</span>}
                        {creditsNeg && !email.broken && <span className="bg-orange-100 text-orange-600 rounded-full px-2 py-0.5 text-xs">Credit-</span>}
                        {botReady && !email.is_locked && !creditsNeg && <span className="bg-green-100 text-green-600 rounded-full px-2 py-0.5 text-xs">พร้อม</span>}
                        {!botReady && !email.broken && !email.is_locked && !creditsNeg && <span className="bg-slate-100 text-slate-400 rounded-full px-2 py-0.5 text-xs">ไม่พร้อม</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => openEdit(email)}
                            className="px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs cursor-pointer">แก้ไข</button>
                          {(() => {
                            const isRegenning = regenning[email.id] || serverRegenning.has(email.id)
                            return (
                              <button onClick={() => triggerRegen(email.id)} disabled={isRegenning}
                                className="px-2.5 py-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white rounded-lg text-xs cursor-pointer flex items-center gap-1">
                                {isRegenning ? (
                                  <>
                                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                                    </svg>
                                    Regen...
                                  </>
                                ) : 'Regen'}
                              </button>
                            )
                          })()}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-800">แก้ไข Razer Account</h3>
            <p className="text-sm text-slate-500">{editModal.email}</p>
            <div>
              <label className="block text-sm text-slate-500 mb-1.5">Razer Account Type</label>
              {accountTypes.length === 0
                ? <p className="text-xs text-orange-500">ยังไม่มี Account Type</p>
                : <select value={editAccountType} onChange={e => setEditAccountType(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400">
                    <option value="">— ยังไม่ได้ตั้ง —</option>
                    {accountTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
              }
            </div>
            <div>
              <label className="block text-sm text-slate-500 mb-1.5">
                Backup Codes <span className="text-slate-400">(1 code ต่อบรรทัด)</span>
              </label>
              <textarea value={editCodes} onChange={e => setEditCodes(e.target.value)} rows={8}
                placeholder={'12345678\n87654321\n...'}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-400 resize-none" />
              <p className="text-xs text-slate-400 mt-1">{editCodes.split('\n').filter(s => s.trim()).length} codes</p>
            </div>
            <div className="flex gap-2.5">
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white py-2.5 rounded-xl cursor-pointer font-medium">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button onClick={() => setEditModal(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-xl cursor-pointer">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
