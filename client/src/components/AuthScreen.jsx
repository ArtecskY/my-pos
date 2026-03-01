import { useState } from 'react'

export default function AuthScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit() {
    setError('')
    if (!username || !password) { setError('กรุณากรอก username และ password'); return }
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); return }
    onLogin(data)
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-slate-100">
      <div className="bg-white rounded-2xl p-10 w-[360px] shadow-lg">
        <h2 className="text-xl font-bold text-blue-900 text-center mb-6">ระบบ POS</h2>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <div className="mb-4">
          <label className="block text-sm text-slate-500 mb-1.5">Username</label>
          <input
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="กรอก username"
          />
        </div>
        <div className="mb-5">
          <label className="block text-sm text-slate-500 mb-1.5">Password</label>
          <input
            type="password"
            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="กรอก password"
          />
        </div>
        <button
          onClick={submit}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg font-medium cursor-pointer"
        >
          เข้าสู่ระบบ
        </button>
      </div>
    </div>
  )
}
