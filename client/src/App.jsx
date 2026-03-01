import { useState, useEffect } from 'react'
import AuthScreen from './components/AuthScreen'
import NavTabs from './components/NavTabs'
import POSPage from './pages/POSPage'
import ManagePage from './pages/ManagePage'
import OrdersPage from './pages/OrdersPage'
import EmailsPage from './pages/EmailsPage'
import UsersPage from './pages/UsersPage'

export default function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('pos')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/me')
      .then(r => r.ok ? r.json() : null)
      .then(u => { setUser(u); setLoading(false) })
  }, [])

  async function logout() {
    await fetch('/logout', { method: 'POST' })
    setUser(null)
    setPage('pos')
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-slate-100 text-slate-400">
        กำลังโหลด...
      </div>
    )
  }

  if (!user) return <AuthScreen onLogin={setUser} />

  return (
    <div className="p-6 bg-slate-100 min-h-screen">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-blue-900">ระบบ POS</h1>
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span>{user.username}</span>
          <button
            onClick={logout}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg cursor-pointer"
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
      <NavTabs page={page} onChangePage={setPage} user={user} />
      {page === 'pos' && <POSPage />}
      {page === 'manage' && <ManagePage />}
      {page === 'emails' && <EmailsPage />}
      {page === 'orders' && <OrdersPage />}
      {page === 'users' && user?.is_admin && <UsersPage currentUser={user} />}
    </div>
  )
}
