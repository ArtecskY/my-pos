import { useState, useEffect } from 'react'
import AuthScreen from './components/AuthScreen'
import NavTabs from './components/NavTabs'
import POSPage from './pages/POSPage'
import ManagePage from './pages/ManagePage'
import OrdersPage from './pages/OrdersPage'
import EmailsPage from './pages/EmailsPage'
import UsersPage from './pages/UsersPage'
import DashboardPage from './pages/DashboardPage'
import BankPage from './pages/BankPage'
import RazerPage from './pages/RazerPage'
import EmailSummaryPage from './pages/EmailSummaryPage'

const VALID_PAGES = ['pos', 'manage', 'emails', 'orders', 'dashboard', 'bank', 'email-summary', 'razer', 'users']
const ADMIN_PAGES = new Set(['razer', 'users'])

function hashPage() {
  const h = window.location.hash.slice(1)
  return VALID_PAGES.includes(h) ? h : 'pos'
}

export default function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(hashPage)
  const [loading, setLoading] = useState(true)

  function navigate(p) {
    setPage(p)
    window.location.hash = p
  }

  useEffect(() => {
    fetch('/me')
      .then(r => r.ok ? r.json() : null)
      .then(u => {
        setUser(u)
        setLoading(false)
        if (u && ADMIN_PAGES.has(hashPage()) && !u.is_admin) navigate('pos')
      })
  }, [])

  useEffect(() => {
    const onHashChange = () => setPage(hashPage())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  async function logout() {
    await fetch('/logout', { method: 'POST' })
    setUser(null)
    navigate('pos')
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
    <div className="bg-slate-100 min-h-screen overflow-x-hidden">
      {/* Sticky header */}
      <div className="sticky top-0 z-40 bg-slate-100 border-b border-slate-200 px-3 sm:px-6 pt-3 sm:pt-5">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
          <h1 className="text-xl sm:text-2xl font-bold text-blue-900">Wisdom Order</h1>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="hidden sm:inline">{user.username}</span>
            <button
              onClick={logout}
              className="px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-200 hover:bg-slate-300 rounded-lg cursor-pointer text-xs sm:text-sm"
            >
              ออกจากระบบ
            </button>
          </div>
        </div>
        <NavTabs page={page} onChangePage={navigate} user={user} />
      </div>

      {/* Page content */}
      <div className="px-3 sm:px-6 py-4 sm:py-6">
        {page === 'pos' && <POSPage onNavigate={navigate} />}
        {page === 'manage' && <ManagePage />}
        {page === 'emails' && <EmailsPage />}
        {page === 'orders' && <OrdersPage />}
        {page === 'dashboard' && <DashboardPage />}
        {page === 'bank' && <BankPage />}
        {page === 'email-summary' && <EmailSummaryPage />}
        {page === 'razer' && user?.is_admin && <RazerPage />}
        {page === 'users' && user?.is_admin && <UsersPage currentUser={user} />}
      </div>
    </div>
  )
}
