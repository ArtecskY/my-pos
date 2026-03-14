import { useState, useEffect } from 'react'

export default function BankPage() {
  const [config, setConfig] = useState({ username: '', hasPassword: false, screenshot: null, snapshotTime: null })
  const [showConfig, setShowConfig] = useState(false)
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [configMsg, setConfigMsg] = useState('')
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState([])
  const [error, setError] = useState('')

  async function loadConfig() {
    const res = await fetch('/bank/config')
    const data = await res.json()
    setConfig(data)
  }

  useEffect(() => { loadConfig() }, [])

  function openConfig() {
    setConfigMsg('')
    setFormPassword('')
    setFormUsername(config.username || '')
    setShowConfig(true)
  }

  async function saveConfig() {
    setConfigMsg('')
    if (!formUsername.trim()) { setConfigMsg('❌ กรุณากรอก Username'); return }
    try {
      const body = { username: formUsername.trim() }
      if (formPassword) body.password = formPassword
      const res = await fetch('/bank/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setConfigMsg('❌ ' + (data.error || 'เกิดข้อผิดพลาด')); return }
      setConfigMsg('✅ บันทึกสำเร็จ')
      setConfig(prev => ({ ...prev, username: formUsername.trim(), hasPassword: !!(formPassword || prev.hasPassword) }))
      setFormPassword('')
    } catch (e) {
      setConfigMsg('❌ ' + e.message)
    }
  }

  async function runSnapshot() {
    setRunning(true)
    setLog([])
    setError('')
    try {
      const res = await fetch('/bank/snapshot', { method: 'POST' })
      const data = await res.json()
      setLog(data.log || [])
      if (!res.ok) {
        setError(data.error || 'เกิดข้อผิดพลาด')
      } else {
        setConfig(prev => ({ ...prev, screenshot: data.screenshot, snapshotTime: data.snapshotTime }))
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">เช็คเงินเข้า</h2>
          <p className="text-xs text-slate-400 mt-0.5">KBank KBiz — ดึงข้อมูลบัญชีอัตโนมัติ</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openConfig}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-sm cursor-pointer"
          >
            ⚙️ ตั้งค่า
          </button>
          <button
            onClick={runSnapshot}
            disabled={running}
            className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer ${
              running
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {running ? '⏳ กำลังดึงข้อมูล...' : '🔄 อัพเดท'}
          </button>
        </div>
      </div>

      {/* แจ้งเตือนขณะ bot ทำงาน */}
      {running && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-amber-800 font-medium text-sm mb-1">🤖 Bot กำลังทำงาน...</p>
          <p className="text-amber-600 text-xs">หน้าต่าง Browser จะเปิดขึ้น — กรุณาทำขั้นตอน Login และ OTP ในหน้าต่างนั้น</p>
          {log.length > 0 && (
            <div className="mt-3 space-y-0.5">
              {log.map((l, i) => (
                <p key={i} className="text-xs text-amber-700 font-mono">{l}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && !running && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-red-700 font-medium text-sm">❌ {error}</p>
          {log.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {log.map((l, i) => (
                <p key={i} className="text-xs text-red-500 font-mono">{l}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Screenshot */}
      {config.screenshot ? (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div>
              <p className="text-sm font-medium text-slate-700">ข้อมูลล่าสุด</p>
              {config.snapshotTime && (
                <p className="text-xs text-slate-400 mt-0.5">อัพเดทเมื่อ: {config.snapshotTime}</p>
              )}
            </div>
            <a
              href={config.screenshot}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer"
            >
              เปิดรูปเต็ม ↗
            </a>
          </div>
          <div className="p-2">
            <img
              src={`${config.screenshot}?t=${Date.now()}`}
              alt="Bank statement"
              className="w-full rounded-lg border border-slate-100"
              key={config.screenshot}
            />
          </div>
        </div>
      ) : !running && (
        <div className="bg-white rounded-xl shadow-sm p-14 text-center">
          <p className="text-slate-400 text-4xl mb-3">🏦</p>
          <p className="text-slate-500 font-medium mb-1">ยังไม่มีข้อมูล</p>
          <p className="text-slate-400 text-sm">กด "อัพเดท" เพื่อดึงข้อมูลจาก KBank KBiz</p>
          {!config.hasPassword && (
            <p className="text-amber-500 text-xs mt-3">⚠️ กรุณาตั้งค่า username/password ก่อน</p>
          )}
        </div>
      )}

      {/* Log after done */}
      {!running && !error && log.length > 0 && (
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-2 font-medium">Log การทำงาน:</p>
          <div className="space-y-0.5">
            {log.map((l, i) => (
              <p key={i} className="text-xs text-slate-600 font-mono">{l}</p>
            ))}
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-end sm:items-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-[400px]">
            <h2 className="font-bold text-slate-800 text-lg mb-1">⚙️ ตั้งค่า KBank KBiz</h2>
            <p className="text-xs text-slate-400 mb-5">บัญชีสำหรับเข้าระบบ KBiz</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-slate-500 mb-1">Username</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="username ของ KBiz"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">
                  Password {config.hasPassword && <span className="text-emerald-500 text-xs">(บันทึกแล้ว)</span>}
                </label>
                <input
                  type="password"
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder={config.hasPassword ? 'เว้นว่างถ้าไม่ต้องการเปลี่ยน' : 'รหัสผ่าน'}
                />
              </div>
            </div>
            {configMsg && (
              <p className={`mt-3 text-sm ${configMsg.startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>
                {configMsg}
              </p>
            )}
            <div className="flex gap-2 mt-5">
              <button
                onClick={saveConfig}
                className="flex-1 bg-slate-700 hover:bg-slate-800 text-white py-2.5 rounded-lg text-sm cursor-pointer font-medium"
              >
                บันทึก
              </button>
              <button
                onClick={() => { setShowConfig(false); setConfigMsg('') }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-lg text-sm cursor-pointer"
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
