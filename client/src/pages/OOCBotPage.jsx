import { useState, useEffect } from 'react'

const STATUS_LABEL = {
  pending:    { label: 'รอดำเนินการ',    cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  processing: { label: 'กำลังดำเนินการ', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  success:    { label: 'สำเร็จ',          cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  failed:     { label: 'ล้มเหลว',         cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
}

export default function OOCBotPage() {
  const [status, setStatus] = useState(null)
  const [orders, setOrders] = useState([])
  const [filter, setFilter] = useState('all')
  const [retrying, setRetrying] = useState(new Set())
  const [apiKeys, setApiKeys] = useState([])

  // Config modal
  const [showConfig, setShowConfig] = useState(false)
  const [cfgEmail, setCfgEmail] = useState('')
  const [cfgPassword, setCfgPassword] = useState('')
  const [cfgMsg, setCfgMsg] = useState('')

  // Topup modal
  const [showTopup, setShowTopup] = useState(false)
  const [topupAmount, setTopupAmount] = useState('')
  const [topupCost, setTopupCost] = useState('')
  const [topupNote, setTopupNote] = useState('')
  const [topupMsg, setTopupMsg] = useState('')

  // New API key modal
  const [showNewKey, setShowNewKey] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyResult, setNewKeyResult] = useState(null)
  const [newKeyMsg, setNewKeyMsg] = useState('')

  function loadStatus() {
    fetch('/ooc/status').then(r => r.json()).then(setStatus).catch(() => {})
  }
  function loadOrders() {
    fetch('/ooc/orders').then(r => r.json()).then(setOrders).catch(() => {})
  }
  function loadApiKeys() {
    fetch('/ooc/api-keys').then(r => r.json()).then(setApiKeys).catch(() => {})
  }

  useEffect(() => {
    loadStatus(); loadOrders(); loadApiKeys()
    const t = setInterval(() => { loadStatus(); loadOrders() }, 10000)
    return () => clearInterval(t)
  }, [])

  async function saveConfig() {
    setCfgMsg('')
    const body = {}
    if (cfgEmail) body.email = cfgEmail
    if (cfgPassword) body.password = cfgPassword
    const r = await fetch('/ooc/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json()
    if (!r.ok) { setCfgMsg('❌ ' + (d.error || 'เกิดข้อผิดพลาด')); return }
    setCfgMsg('✅ บันทึกแล้ว')
    setCfgPassword('')
    loadStatus()
  }

  async function saveTopup() {
    setTopupMsg('')
    if (!topupAmount || Number(topupAmount) <= 0) { setTopupMsg('❌ ระบุจำนวน credit ที่ถูกต้อง'); return }
    const r = await fetch('/ooc/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(topupAmount), cost: Number(topupCost) || 0, note: topupNote || null }),
    })
    const d = await r.json()
    if (!r.ok) { setTopupMsg('❌ ' + (d.error || 'เกิดข้อผิดพลาด')); return }
    setTopupMsg(`✅ เติม ${topupAmount} credit แล้ว (ยอดใหม่: ${d.credit})`)
    setTopupAmount(''); setTopupCost(''); setTopupNote('')
    loadStatus()
  }

  async function retry(id) {
    setRetrying(prev => new Set([...prev, id]))
    await fetch(`/ooc/retry/${id}`, { method: 'POST' })
    loadOrders()
    setTimeout(() => setRetrying(prev => { const n = new Set(prev); n.delete(id); return n }), 2000)
  }

  async function createApiKey() {
    setNewKeyMsg('')
    if (!newKeyLabel.trim()) { setNewKeyMsg('❌ ระบุชื่อ key'); return }
    const r = await fetch('/ooc/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newKeyLabel.trim() }),
    })
    const d = await r.json()
    if (!r.ok) { setNewKeyMsg('❌ ' + (d.error || 'เกิดข้อผิดพลาด')); return }
    setNewKeyResult(d)
    loadApiKeys()
  }

  async function toggleKey(id, active) {
    await fetch(`/ooc/api-keys/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    })
    loadApiKeys()
  }

  async function deleteKey(id) {
    if (!confirm('ลบ API Key นี้?')) return
    await fetch(`/ooc/api-keys/${id}`, { method: 'DELETE' })
    loadApiKeys()
  }

  const filtered = orders.filter(o => filter === 'all' || o.status === filter)
  const counts = orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc }, {})

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-(--text)">OOC Bot</h1>
        <p className="text-sm text-(--text-muted) mt-0.5">จัดการบัญชี OOC และติดตาม status การเติม</p>
      </div>

      {/* Account Section */}
      <div className="bg-(--surface) border border-(--border) rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-(--text)">บัญชี OOC</h2>
          <div className="flex gap-2">
            <button
              onClick={() => { setCfgEmail(status?.email || ''); setCfgPassword(''); setCfgMsg(''); setShowConfig(true) }}
              className="px-3 py-1.5 bg-(--surface2) hover:bg-(--border) text-(--text) rounded-lg text-xs font-medium cursor-pointer transition-colors"
            >
              ⚙️ ตั้งค่า
            </button>
            <button
              onClick={() => { setTopupAmount(''); setTopupCost(''); setTopupNote(''); setTopupMsg(''); setShowTopup(true) }}
              className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-medium cursor-pointer transition-colors"
            >
              + เติม Credit
            </button>
          </div>
        </div>

        {status && (
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-(--text-muted)">Email</p>
              <p className="text-sm font-medium text-(--text)">{status.email || <span className="text-(--text-muted) italic">ยังไม่ตั้งค่า</span>}</p>
            </div>
            <div>
              <p className="text-xs text-(--text-muted)">Password</p>
              <p className="text-sm font-medium text-(--text)">{status.hasPassword ? '••••••••' : <span className="text-amber-500 text-xs">ยังไม่ตั้งค่า</span>}</p>
            </div>
            <div>
              <p className="text-xs text-(--text-muted)">Credit คงเหลือ</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{Number(status.credit || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-(--text-muted)">Queue</p>
              <p className="text-sm font-medium text-(--text)">
                {status.running ? <span className="text-blue-500">กำลังทำงาน</span> : 'ว่าง'}
                {status.queueLength > 0 && <span className="ml-1 text-(--text-muted)">({status.queueLength} รอ)</span>}
              </p>
            </div>
          </div>
        )}

        {/* Topup history */}
        {status?.topups?.length > 0 && (
          <div>
            <p className="text-xs text-(--text-muted) font-medium mb-2">ประวัติเติม Credit ล่าสุด</p>
            <div className="space-y-1">
              {status.topups.slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center gap-3 text-xs text-(--text-muted)">
                  <span className="text-emerald-600 font-medium">+{t.amount}</span>
                  <span>ต้นทุน {t.cost || 0} ฿</span>
                  {t.note && <span>{t.note}</span>}
                  <span className="ml-auto">{new Date(t.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* API Keys Section */}
      <div className="bg-(--surface) border border-(--border) rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-(--text)">API Keys (Partner)</h2>
          <button
            onClick={() => { setNewKeyLabel(''); setNewKeyResult(null); setNewKeyMsg(''); setShowNewKey(true) }}
            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs font-medium cursor-pointer"
          >
            + สร้าง Key
          </button>
        </div>
        {apiKeys.length === 0 ? (
          <p className="text-sm text-(--text-muted) text-center py-3">ยังไม่มี API Key</p>
        ) : (
          <div className="space-y-2">
            {apiKeys.map(k => (
              <div key={k.id} className="flex items-center gap-3 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${k.active ? 'bg-green-500' : 'bg-slate-300'}`} />
                <span className="font-medium text-(--text) flex-1">{k.label}</span>
                <span className="font-mono text-xs text-(--text-muted)">{k.prefix}…</span>
                <span className="text-xs text-(--text-muted)">{new Date(k.created_at).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}</span>
                <button onClick={() => toggleKey(k.id, !k.active)}
                  className={`px-2 py-0.5 rounded text-xs cursor-pointer ${k.active ? 'bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}>
                  {k.active ? 'ปิด' : 'เปิด'}
                </button>
                <button onClick={() => deleteKey(k.id)} className="px-2 py-0.5 rounded text-xs bg-red-50 text-red-600 hover:bg-red-100 cursor-pointer">ลบ</button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-(--text-muted)">Partner ส่ง <code className="font-mono bg-(--surface2) px-1 rounded">X-Api-Key: &lt;key&gt;</code> ใน header เพื่อใช้งาน <code className="font-mono bg-(--surface2) px-1 rounded">POST /ooc/external/order</code></p>
      </div>

      {/* Orders Section */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'all',        label: 'ทั้งหมด',    count: orders.length },
            { key: 'pending',    label: 'รอ',          count: counts.pending || 0 },
            { key: 'processing', label: 'กำลังทำ',     count: counts.processing || 0 },
            { key: 'success',    label: 'สำเร็จ',      count: counts.success || 0 },
            { key: 'failed',     label: 'ล้มเหลว',     count: counts.failed || 0 },
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${
                filter === f.key ? 'bg-blue-500 text-white border-transparent' : 'bg-(--surface) text-(--text-muted) border-(--border) hover:border-slate-400'
              }`}>
              {f.label} {f.count > 0 && <span className="ml-1 opacity-80">({f.count})</span>}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="bg-(--surface) border border-(--border) rounded-2xl p-10 text-center text-(--text-muted) text-sm">ไม่มีรายการ</div>
        ) : (
          <div className="space-y-3">
            {filtered.map(order => {
              const st = STATUS_LABEL[order.status] || { label: order.status, cls: 'bg-slate-100 text-slate-700' }
              return (
                <div key={order.id} className="bg-(--surface) border border-(--border) rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-(--text) text-sm">{order.product_name}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--text-muted)">
                        <span>Order #{order.order_id}</span>
                        <span>{new Date(order.created_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</span>
                        {order.price > 0 && <span>ราคา: {Number(order.price).toLocaleString()} ฿</span>}
                        {order.cost > 0 && <span>ต้นทุน: {Number(order.cost).toLocaleString()}</span>}
                      </div>
                      {order.url && (
                        <p className="mt-1 text-xs text-(--text-muted) break-all">
                          URL: <span className="font-mono">{order.url}</span>
                        </p>
                      )}
                      {order.error && (
                        <p className="mt-1 text-xs text-red-500">{order.error}</p>
                      )}
                      {order.finished_at && (
                        <p className="mt-1 text-xs text-(--text-muted)">
                          เสร็จเมื่อ: {new Date(order.finished_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                        </p>
                      )}
                    </div>
                    {order.status === 'failed' && (
                      <button
                        onClick={() => retry(order.id)}
                        disabled={retrying.has(order.id)}
                        className="shrink-0 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600 disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {retrying.has(order.id) ? 'กำลัง Retry...' : 'Retry'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-end sm:items-center z-50 p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md">
            <h2 className="font-bold text-slate-800 dark:text-white text-lg mb-4">⚙️ ตั้งค่าบัญชี OOC</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-slate-500 mb-1">Email</label>
                <input type="email" value={cfgEmail} onChange={e => setCfgEmail(e.target.value)}
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 bg-white dark:bg-slate-700 dark:text-white"
                  placeholder="email@example.com" autoFocus />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">
                  Password {status?.hasPassword && <span className="text-emerald-500 text-xs">(บันทึกแล้ว)</span>}
                </label>
                <input type="password" value={cfgPassword} onChange={e => setCfgPassword(e.target.value)}
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 bg-white dark:bg-slate-700 dark:text-white"
                  placeholder={status?.hasPassword ? 'เว้นว่างถ้าไม่ต้องการเปลี่ยน' : 'รหัสผ่าน'} />
              </div>
            </div>
            {cfgMsg && <p className={`mt-3 text-sm ${cfgMsg.startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>{cfgMsg}</p>}
            <div className="flex gap-2 mt-5">
              <button onClick={saveConfig} className="flex-1 bg-slate-700 hover:bg-slate-800 text-white py-2.5 rounded-lg text-sm cursor-pointer font-medium">บันทึก</button>
              <button onClick={() => setShowConfig(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-lg text-sm cursor-pointer">ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* Topup Modal */}
      {showTopup && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-end sm:items-center z-50 p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md">
            <h2 className="font-bold text-slate-800 dark:text-white text-lg mb-4">+ เติม Credit OOC</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-slate-500 mb-1">จำนวน Credit ที่เติม</label>
                <input type="number" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} min="0" step="any"
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 bg-white dark:bg-slate-700 dark:text-white"
                  placeholder="เช่น 1000" autoFocus />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">ต้นทุน (฿)</label>
                <input type="number" value={topupCost} onChange={e => setTopupCost(e.target.value)} min="0" step="any"
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 bg-white dark:bg-slate-700 dark:text-white"
                  placeholder="เช่น 350" />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">หมายเหต��� (ไม่บังคับ)</label>
                <input type="text" value={topupNote} onChange={e => setTopupNote(e.target.value)}
                  className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 bg-white dark:bg-slate-700 dark:text-white"
                  placeholder="เช่น โอนแล้ว ref #..." />
              </div>
            </div>
            {topupMsg && <p className={`mt-3 text-sm ${topupMsg.startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>{topupMsg}</p>}
            <div className="flex gap-2 mt-5">
              <button onClick={saveTopup} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2.5 rounded-lg text-sm cursor-pointer font-medium">เติม Credit</button>
              <button onClick={() => setShowTopup(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-lg text-sm cursor-pointer">ปิด</button>
            </div>
          </div>
        </div>
      )}

      {/* New API Key Modal */}
      {showNewKey && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-end sm:items-center z-50 p-0 sm:p-4">
          <div className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-md">
            <h2 className="font-bold text-slate-800 dark:text-white text-lg mb-4">+ สร้าง API Key</h2>
            {!newKeyResult ? (
              <>
                <div>
                  <label className="block text-sm text-slate-500 mb-1">ชื่อ / Partner</label>
                  <input type="text" value={newKeyLabel} onChange={e => setNewKeyLabel(e.target.value)}
                    className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 bg-white dark:bg-slate-700 dark:text-white"
                    placeholder="เช่น My Shop, Partner A" autoFocus />
                </div>
                {newKeyMsg && <p className="mt-3 text-sm text-red-500">{newKeyMsg}</p>}
                <div className="flex gap-2 mt-5">
                  <button onClick={createApiKey} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg text-sm cursor-pointer font-medium">สร้าง</button>
                  <button onClick={() => setShowNewKey(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-lg text-sm cursor-pointer">ปิด</button>
                </div>
              </>
            ) : (
              <>
                <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-2">
                  <p className="text-sm font-medium text-yellow-800">⚠️ คัดลอก key นี้ไว้ก่อน — จะไม่แสดงอีกครั้ง</p>
                  <p className="font-mono text-xs break-all bg-white border border-yellow-300 rounded-lg p-3 select-all">{newKeyResult.key}</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(newKeyResult.key)}
                    className="w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm cursor-pointer"
                  >
                    คัดลอก
                  </button>
                </div>
                <button onClick={() => setShowNewKey(false)} className="w-full mt-3 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-lg text-sm cursor-pointer">ปิด</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
