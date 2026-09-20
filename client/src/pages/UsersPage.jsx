import { useState, useEffect } from 'react'

const inputCls = 'border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 text-sm'

function fmtDate(v) {
  if (!v) return '-'
  try { return new Date(v).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) } catch { return v }
}

const ROLE_LABEL = { superadmin: 'SuperAdmin', admin: 'Admin' }
const ROLE_CLS = {
  superadmin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
}

export default function UsersPage({ currentUser }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ username: '', password: '', role: 'admin' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [editUser, setEditUser] = useState(null) // { id, username, role }
  const [editRole, setEditRole] = useState('admin')
  const [newPassword, setNewPassword] = useState('')
  const [editError, setEditError] = useState('')
  const [editSuccess, setEditSuccess] = useState('')

  const [auditLog, setAuditLog] = useState([])
  const [showAudit, setShowAudit] = useState(false)

  async function load() {
    const res = await fetch('/users')
    if (res.ok) setUsers(await res.json())
  }

  async function loadAudit() {
    const res = await fetch('/audit-log')
    if (res.ok) setAuditLog(await res.json())
  }

  useEffect(() => { load() }, [])

  async function createUser() {
    setError(''); setSuccess('')
    if (!form.username || !form.password) { setError('กรุณากรอก Username และ Password'); return }
    const res = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); return }
    setSuccess(`สร้างผู้ใช้ "${form.username}" สำเร็จ`)
    setForm({ username: '', password: '', role: 'admin' })
    load()
  }

  async function toggleStatus(u) {
    const nextActive = !u.active
    if (!nextActive && !confirm(`ระงับการใช้งานบัญชี "${u.username}" ใช่ไหม?`)) return
    const res = await fetch(`/users/${u.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: nextActive }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error); return }
    load()
  }

  function openEdit(u) {
    setEditUser(u)
    setEditRole(u.role)
    setNewPassword('')
    setEditError('')
    setEditSuccess('')
  }

  async function saveRole() {
    setEditError(''); setEditSuccess('')
    if (editRole === editUser.role) return
    const res = await fetch(`/users/${editUser.id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: editRole }),
    })
    const data = await res.json()
    if (!res.ok) { setEditError(data.error); return }
    setEditSuccess('อัปเดต Role สำเร็จ')
    load()
  }

  async function resetPassword() {
    setEditError(''); setEditSuccess('')
    if (!newPassword || newPassword.length < 4) { setEditError('รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร'); return }
    const res = await fetch(`/users/${editUser.id}/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword }),
    })
    const data = await res.json()
    if (!res.ok) { setEditError(data.error); return }
    setEditSuccess('รีเซ็ตรหัสผ่านสำเร็จ')
    setNewPassword('')
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* สร้างผู้ใช้ใหม่ */}
      <div className="bg-white rounded-2xl shadow p-6">
        <h2 className="font-bold text-slate-800 mb-4">สร้างผู้ใช้ใหม่</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            type="text" placeholder="Username"
            value={form.username}
            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
            className={`flex-1 min-w-[140px] ${inputCls}`}
          />
          <input
            type="password" placeholder="Password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && createUser()}
            className={`flex-1 min-w-[140px] ${inputCls}`}
          />
        </div>
        <div className="flex gap-2 mb-3">
          {['admin', 'superadmin'].map(r => (
            <button
              key={r}
              type="button"
              onClick={() => setForm(f => ({ ...f, role: r }))}
              className={`px-3 py-1.5 rounded-lg text-sm border cursor-pointer transition-colors ${
                form.role === r
                  ? 'bg-blue-500 text-white border-transparent'
                  : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
              }`}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
        {success && <p className="text-emerald-600 text-sm mb-2">{success}</p>}
        <button
          onClick={createUser}
          className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm cursor-pointer"
        >
          + สร้างผู้ใช้
        </button>
      </div>

      {/* รายชื่อผู้ใช้ */}
      <div className="bg-white rounded-2xl shadow p-6">
        <h2 className="font-bold text-slate-800 mb-4">ผู้ใช้ทั้งหมด ({users.length} คน)</h2>
        <div className="space-y-2">
          {users.map(u => (
            <div key={u.id} className={`flex items-center justify-between px-4 py-3 rounded-xl ${u.active ? 'bg-slate-50' : 'bg-red-50'}`}>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-800">{u.username}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_CLS[u.role] || ROLE_CLS.admin}`}>
                    {ROLE_LABEL[u.role] || u.role}
                  </span>
                  {!u.active && (
                    <span className="text-xs px-2 py-0.5 bg-red-100 text-red-600 rounded-full font-medium">ระงับใช้งาน</span>
                  )}
                  {u.id === currentUser.id && (
                    <span className="text-xs text-slate-400">(คุณ)</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">เข้าสู่ระบบล่าสุด: {fmtDate(u.last_login_at)}</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => openEdit(u)}
                  className="text-xs px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg cursor-pointer"
                >
                  แก้ไข
                </button>
                {u.id !== currentUser.id && (
                  <button
                    onClick={() => toggleStatus(u)}
                    className={`text-xs px-3 py-1.5 rounded-lg cursor-pointer ${
                      u.active
                        ? 'bg-red-100 hover:bg-red-200 text-red-600'
                        : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-700'
                    }`}
                  >
                    {u.active ? 'ระงับ' : 'เปิดใช้งาน'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ประวัติการเปลี่ยนแปลง */}
      <div className="bg-white rounded-2xl shadow p-6">
        <button
          onClick={() => { setShowAudit(v => !v); if (!showAudit) loadAudit() }}
          className="font-bold text-slate-800 cursor-pointer flex items-center gap-2"
        >
          ประวัติการเปลี่ยนแปลง {showAudit ? '▲' : '▼'}
        </button>
        {showAudit && (
          <div className="mt-4 overflow-x-auto">
            {auditLog.length === 0 ? (
              <p className="text-slate-400 text-sm py-4 text-center">ยังไม่มีประวัติ</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="pb-2 pr-3 font-medium whitespace-nowrap">เวลา</th>
                    <th className="pb-2 pr-3 font-medium whitespace-nowrap">ผู้ทำรายการ</th>
                    <th className="pb-2 pr-3 font-medium whitespace-nowrap">การกระทำ</th>
                    <th className="pb-2 pr-3 font-medium whitespace-nowrap">เป้าหมาย</th>
                    <th className="pb-2 font-medium">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map(l => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-500">{fmtDate(l.created_at)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{l.actor_username || '-'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{l.action}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{l.target_type ? `${l.target_type}#${l.target_id}` : '-'}</td>
                      <td className="py-2 text-slate-500">{l.detail || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* แก้ไขผู้ใช้ */}
      {editUser && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-end sm:items-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-[420px]">
            <h3 className="font-bold text-slate-800 mb-1">แก้ไขผู้ใช้</h3>
            <p className="text-sm text-slate-500 mb-4">{editUser.username}</p>

            <div className="mb-4">
              <label className="block text-xs text-slate-500 mb-1.5">Role</label>
              <div className="flex gap-2">
                {['admin', 'superadmin'].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setEditRole(r)}
                    className={`px-3 py-1.5 rounded-lg text-sm border cursor-pointer transition-colors ${
                      editRole === r
                        ? 'bg-blue-500 text-white border-transparent'
                        : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
                    }`}
                  >
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
              <button
                onClick={saveRole}
                disabled={editRole === editUser.role}
                className="mt-2 px-4 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white rounded-lg text-xs cursor-pointer"
              >
                บันทึก Role
              </button>
            </div>

            <div className="mb-2">
              <label className="block text-xs text-slate-500 mb-1.5">รีเซ็ตรหัสผ่านใหม่</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="รหัสผ่านใหม่"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className={`flex-1 ${inputCls}`}
                />
                <button
                  onClick={resetPassword}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm cursor-pointer whitespace-nowrap"
                >
                  รีเซ็ต
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">ผู้ใช้จะถูกบังคับให้ Login ใหม่หลังเปลี่ยนรหัสผ่าน</p>
            </div>

            {editError && <p className="text-red-500 text-sm mt-3">{editError}</p>}
            {editSuccess && <p className="text-emerald-600 text-sm mt-3">{editSuccess}</p>}

            <button
              onClick={() => setEditUser(null)}
              className="w-full mt-5 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-lg text-sm cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
