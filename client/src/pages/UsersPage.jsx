import { useState, useEffect } from 'react'

const inputCls = 'border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500 text-sm'

export default function UsersPage({ currentUser }) {
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ username: '', password: '', is_admin: false })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function load() {
    const res = await fetch('/users')
    if (res.ok) setUsers(await res.json())
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
    setForm({ username: '', password: '', is_admin: false })
    load()
  }

  async function deleteUser(id, username) {
    if (!confirm(`ลบผู้ใช้ "${username}" ใช่ไหม?`)) return
    const res = await fetch(`/users/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) { setError(data.error); return }
    load()
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
        <label className="flex items-center gap-2 text-sm text-slate-600 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.is_admin}
            onChange={e => setForm(f => ({ ...f, is_admin: e.target.checked }))}
            className="w-4 h-4 accent-blue-500"
          />
          ให้สิทธิ์ Admin
        </label>
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
            <div key={u.id} className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-800">{u.username}</span>
                {u.is_admin && (
                  <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">Admin</span>
                )}
                {u.id === currentUser.id && (
                  <span className="text-xs text-slate-400">(คุณ)</span>
                )}
              </div>
              {u.id !== currentUser.id && (
                <button
                  onClick={() => deleteUser(u.id, u.username)}
                  className="text-xs px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg cursor-pointer"
                >
                  ลบ
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}
