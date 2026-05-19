import { useState, useRef } from 'react'
import { Eye, EyeOff, Loader2, ShoppingCart, RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'

export default function AuthScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [serverDown, setServerDown] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const pollRef = useRef(null)

  async function submit(e) {
    e?.preventDefault()
    setError('')
    setServerDown(false)
    if (!username || !password) { setError('กรุณากรอก username และ password'); return }
    setLoading(true)
    try {
      const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'เกิดข้อผิดพลาด'); return }
      onLogin(data)
    } catch {
      setError('ไม่สามารถเชื่อมต่อ server ได้')
      setServerDown(true)
    } finally {
      setLoading(false)
    }
  }

  async function restartServer() {
    setRestarting(true)
    setError('')
    try {
      await fetch('/restart', { method: 'POST' })
    } catch {
      // server อาจตายก่อน response — ปกติ
    }
    // poll /health จนกว่า server จะกลับมา
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/health')
        if (res.ok) {
          clearInterval(pollRef.current)
          setRestarting(false)
          setServerDown(false)
          setError('Server พร้อมแล้ว — ลองเข้าสู่ระบบอีกครั้ง')
        }
      } catch {
        // ยังรอ server ขึ้น
      }
    }, 2000)
  }

  return (
    <div className="min-h-screen bg-(--bg) flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-brand/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-brand/5 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="bg-(--surface) border border-(--border) rounded-2xl shadow-xl overflow-hidden">
          <div className="h-1 bg-linear-to-r from-brand/40 via-brand to-brand/40" />

          <div className="px-8 py-8">
            <div className="flex flex-col items-center mb-8">
              <div className="w-12 h-12 rounded-2xl bg-brand flex items-center justify-center shadow-lg shadow-brand/25 mb-3">
                <ShoppingCart size={22} className="text-white" strokeWidth={2.5} />
              </div>
              <h1 className="text-xl font-bold text-(--text)">Wisdom Order</h1>
              <p className="text-sm text-(--text-muted) mt-0.5">เข้าสู่ระบบเพื่อดำเนินการต่อ</p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {error && (
                <div className={cn(
                  'border text-xs px-3 py-2.5 rounded-xl',
                  serverDown
                    ? 'bg-green-50 dark:bg-green-950/30 border-green-100 dark:border-green-900/40 text-green-600'
                    : 'bg-red-50 dark:bg-red-950/30 border-red-100 dark:border-red-900/40 text-red-500'
                )}>
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-(--text-muted) mb-1.5">Username</label>
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="กรอก username"
                  className={cn(
                    'w-full px-3.5 py-2.5 text-sm rounded-xl',
                    'bg-(--surface2) border border-(--border)',
                    'text-(--text) placeholder:text-(--text-muted)',
                    'focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand',
                    'transition-all'
                  )}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-(--text-muted) mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                    placeholder="กรอก password"
                    className={cn(
                      'w-full px-3.5 py-2.5 pr-10 text-sm rounded-xl',
                      'bg-(--surface2) border border-(--border)',
                      'text-(--text) placeholder:text-(--text-muted)',
                      'focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand',
                      'transition-all'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-(--text-muted) hover:text-(--text) transition-colors"
                  >
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || restarting}
                className={cn(
                  'w-full py-2.5 rounded-xl text-sm font-semibold text-white mt-2',
                  'bg-brand hover:bg-brand-600 active:scale-[0.98]',
                  'shadow-sm shadow-brand/20 hover:shadow hover:shadow-brand/30',
                  'transition-all duration-150 cursor-pointer',
                  'disabled:opacity-60 disabled:cursor-not-allowed',
                  'flex items-center justify-center gap-2'
                )}
              >
                {loading && <Loader2 size={15} className="animate-spin" />}
                {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
              </button>

              {serverDown && (
                <button
                  type="button"
                  onClick={restartServer}
                  disabled={restarting}
                  className={cn(
                    'w-full py-2.5 rounded-xl text-sm font-semibold',
                    'bg-(--surface2) border border-(--border)',
                    'text-(--text-muted) hover:text-(--text)',
                    'active:scale-[0.98] transition-all duration-150 cursor-pointer',
                    'disabled:opacity-60 disabled:cursor-not-allowed',
                    'flex items-center justify-center gap-2'
                  )}
                >
                  <RefreshCw size={14} className={restarting ? 'animate-spin' : ''} />
                  {restarting ? 'กำลัง Restart Server...' : 'Restart Server'}
                </button>
              )}
            </form>
          </div>
        </div>

        <p className="text-center text-xs text-(--text-muted) mt-4">
          Wisdom Order © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
