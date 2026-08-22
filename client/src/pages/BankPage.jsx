import { useState, useEffect, useRef } from 'react'

export default function BankPage() {
  const [status, setStatus] = useState({
    sessionActive: false, cooldownRemaining: 0, botRunning: false,
    username: '', hasPassword: false, screenshot: null, snapshotTime: null,
  })
  const [showConfig, setShowConfig] = useState(false)
  const [formUsername, setFormUsername] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [configMsg, setConfigMsg] = useState('')
  const [log, setLog] = useState([])
  const [error, setError] = useState('')
  const [actionRunning, setActionRunning] = useState(false) // login หรือ snapshot กำลังทำงาน
  const pollingRef = useRef(null)

  async function loadStatus() {
    try {
      const res = await fetch('/bank/status')
      if (res.ok) setStatus(await res.json())
    } catch {}
  }

  useEffect(() => {
    loadStatus()
    pollingRef.current = setInterval(loadStatus, 10000)
    return () => clearInterval(pollingRef.current)
  }, [])

  function openConfig() {
    setConfigMsg('')
    setFormPassword('')
    setFormUsername(status.username || '')
    setShowConfig(true)
  }

  async function saveConfig() {
    setConfigMsg('')
    if (!formUsername.trim()) { setConfigMsg('❌ กรุณากรอก Username'); return }
    try {
      const body = { username: formUsername.trim() }
      if (formPassword) body.password = formPassword
      const res = await fetch('/bank/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setConfigMsg('❌ ' + (data.error || 'เกิดข้อผิดพลาด')); return }
      setConfigMsg('✅ บันทึกสำเร็จ')
      setFormPassword('')
      loadStatus()
    } catch (e) { setConfigMsg('❌ ' + e.message) }
  }

  async function runLogin() {
    setActionRunning(true)
    setLog([])
    setError('')
    try {
      const res = await fetch('/bank/login', { method: 'POST' })
      const data = await res.json()
      setLog(data.log || [])
      if (!res.ok) setError(data.error || 'เกิดข้อผิดพลาด')
      else loadStatus()
    } catch (e) { setError(e.message) }
    finally { setActionRunning(false) }
  }

  async function runSnapshot() {
    setActionRunning(true)
    setLog([])
    setError('')
    try {
      const res = await fetch('/bank/snapshot', { method: 'POST' })
      const data = await res.json()
      setLog(data.log || [])
      if (!res.ok) { setError(data.error || 'เกิดข้อผิดพลาด') }
      else {
        setStatus(prev => ({ ...prev, screenshot: data.screenshot, snapshotTime: data.snapshotTime }))
      }
    } catch (e) { setError(e.message) }
    finally { setActionRunning(false) }
  }

  const cooldown = status.cooldownRemaining || 0
  const canLogin = !actionRunning && !status.botRunning && cooldown === 0
  const canSnapshot = !actionRunning && !status.botRunning && status.sessionActive
  const isWorking = actionRunning || status.botRunning

  return (
    <div className="space-y-4 max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-800">เช็คเงินเข้า</h2>
          <p className="text-xs text-slate-400 mt-0.5">KBank KBiz — ดึงข้อมูลบัญชีอัตโนมัติ</p>
        </div>
        <button
          onClick={openConfig}
          className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm cursor-pointer"
        >
          ⚙️ ตั้งค่า
        </button>
      </div>

      {/* Session status + buttons */}
      <div className="bg-white rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-3">
        {/* Status badge */}
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
          status.sessionActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
        }`}>
          <span className={`w-2 h-2 rounded-full ${status.sessionActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
          {status.sessionActive ? 'Session เปิดอยู่' : 'ยังไม่ได้ Login'}
        </div>

        <div className="flex gap-2 ml-auto flex-wrap">
          {/* ปุ่ม Login */}
          <button
            onClick={runLogin}
            disabled={!canLogin}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 ${
              !canLogin
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600 text-white cursor-pointer'
            }`}
          >
            🔑 {isWorking && !status.sessionActive ? 'กำลัง Login...'
              : cooldown > 0 ? `Login (${cooldown}s)`
              : 'Login'}
          </button>

          {/* ปุ่ม อัพเดท */}
          <button
            onClick={runSnapshot}
            disabled={!canSnapshot}
            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 ${
              !canSnapshot
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-green-500 hover:bg-green-600 text-white cursor-pointer'
            }`}
          >
            🔄 {isWorking && status.sessionActive ? 'กำลังดึงข้อมูล...' : 'อัพเดท'}
          </button>
        </div>
      </div>

      {/* แจ้งเตือนขณะ login */}
      {isWorking && !status.sessionActive && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-blue-800 font-medium text-sm mb-1">🔑 กำลัง Login...</p>
          <p className="text-blue-600 text-xs">หน้าต่าง Browser จะเปิดขึ้น — กรุณาทำ reCAPTCHA → กด Login → รอ OTP ถ้ามี</p>
          <LogList log={log} color="blue" />
        </div>
      )}

      {/* แจ้งเตือนขณะ snapshot */}
      {isWorking && status.sessionActive && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-amber-800 font-medium text-sm mb-1">🔄 กำลังดึงข้อมูล...</p>
          <LogList log={log} color="amber" />
        </div>
      )}

      {/* Error */}
      {error && !isWorking && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-red-700 font-medium text-sm">❌ {error}</p>
          <LogList log={log} color="red" />
        </div>
      )}

      {/* Screenshot */}
      {status.screenshot ? (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div>
              <p className="text-sm font-medium text-slate-700">ข้อมูลล่าสุด</p>
              {status.snapshotTime && (
                <p className="text-xs text-slate-400 mt-0.5">อัพเดทเมื่อ: {status.snapshotTime}</p>
              )}
            </div>
            <a href={status.screenshot} target="_blank" rel="noreferrer"
              className="text-xs text-blue-500 hover:text-blue-700 cursor-pointer">
              เปิดรูปเต็ม ↗
            </a>
          </div>
          <div className="p-2">
            <img
              src={`${status.screenshot}?t=${status.snapshotTime}`}
              alt="Bank statement"
              className="w-full rounded-lg border border-slate-100"
            />
          </div>
        </div>
      ) : !isWorking && (
        <div className="bg-white rounded-xl shadow-sm p-14 text-center">
          <p className="text-slate-400 text-4xl mb-3">🏦</p>
          <p className="text-slate-500 font-medium mb-1">ยังไม่มีข้อมูล</p>
          {!status.hasPassword
            ? <p className="text-amber-500 text-xs mt-2">⚠️ กรุณาตั้งค่า username/password ก่อน</p>
            : !status.sessionActive
            ? <p className="text-slate-400 text-sm mt-1">กด "Login" เพื่อเชื่อมต่อ KBiz</p>
            : <p className="text-slate-400 text-sm mt-1">กด "อัพเดท" เพื่อดึงข้อมูล</p>
          }
        </div>
      )}

      {/* Log หลัง done */}
      {!isWorking && !error && log.length > 0 && (
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-xs text-slate-400 mb-2 font-medium">Log การทำงาน:</p>
          <LogList log={log} color="slate" />
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
                <input type="text" value={formUsername} onChange={e => setFormUsername(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder="username ของ KBiz" autoFocus />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1">
                  Password {status.hasPassword && <span className="text-emerald-500 text-xs">(บันทึกแล้ว)</span>}
                </label>
                <input type="password" value={formPassword} onChange={e => setFormPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                  placeholder={status.hasPassword ? 'เว้นว่างถ้าไม่ต้องการเปลี่ยน' : 'รหัสผ่าน'} />
              </div>
            </div>
            {configMsg && (
              <p className={`mt-3 text-sm ${configMsg.startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>
                {configMsg}
              </p>
            )}
            <div className="flex gap-2 mt-5">
              <button onClick={saveConfig}
                className="flex-1 bg-slate-700 hover:bg-slate-800 text-white py-2.5 rounded-lg text-sm cursor-pointer font-medium">
                บันทึก
              </button>
              <button onClick={() => { setShowConfig(false); setConfigMsg('') }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-lg text-sm cursor-pointer">
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LogList({ log, color }) {
  if (!log || log.length === 0) return null
  const cls = {
    blue: 'text-blue-700',
    amber: 'text-amber-700',
    red: 'text-red-500',
    slate: 'text-slate-600',
  }[color] || 'text-slate-600'
  return (
    <div className="mt-2 space-y-0.5">
      {log.map((l, i) => <p key={i} className={`text-xs font-mono ${cls}`}>{l}</p>)}
    </div>
  )
}
