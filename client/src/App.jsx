import { useState, useEffect, useRef } from 'react'
import { ThemeProvider } from './context/ThemeContext'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import AuthScreen from './components/AuthScreen'
import POSPage from './pages/POSPage'
import ManagePage from './pages/ManagePage'
import OrdersPage from './pages/OrdersPage'
import EmailsPage from './pages/EmailsPage'
import UsersPage from './pages/UsersPage'
import DashboardPage from './pages/DashboardPage'
import BankPage from './pages/BankPage'
import RazerPage from './pages/RazerPage'
import EmailSummaryPage from './pages/EmailSummaryPage'
import Pay24Page from './pages/Pay24Page'
import Pay24BotPage from './pages/Pay24BotPage'

const VALID_PAGES = ['pos', 'manage', 'emails', 'orders', 'dashboard', 'bank', 'email-summary', 'razer', 'pay24', 'pay24-bot', 'users']
const ADMIN_PAGES = new Set(['razer', 'pay24', 'pay24-bot', 'users'])

function hashPage() {
  const h = window.location.hash.slice(1)
  return VALID_PAGES.includes(h) ? h : 'pos'
}

function AppShell({ user, onLogout }) {
  const [page, setPage] = useState(hashPage)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const [showScrollTop, setShowScrollTop] = useState(false)
  const mainRef = useRef(null)

  function toggleCollapse() {
    setSidebarCollapsed(v => {
      const next = !v
      try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
      return next
    })
  }

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onScroll = () => setShowScrollTop(el.scrollTop > 350)
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  function navigate(p) {
    setPage(p)
    window.location.hash = p
  }

  useEffect(() => {
    const onHashChange = () => setPage(hashPage())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const code = e.code
      if (code === 'KeyB') navigate(page === 'pos' ? 'orders' : 'pos')
      if (code === 'KeyD') navigate('dashboard')
      if (code === 'KeyM') navigate('manage')
      if (code === 'KeyE') navigate('emails')
      if (code === 'KeyK' && user?.is_admin) navigate('razer')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [page, user])

  return (
    <div className="flex h-screen overflow-hidden bg-(--bg)">
      <Sidebar
        page={page}
        onChangePage={navigate}
        user={user}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleCollapse}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar page={page} user={user} onLogout={onLogout} onMenuOpen={() => setSidebarOpen(true)} />
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 py-5 sm:py-6 max-w-screen-2xl mx-auto">
            {page === 'pos'           && <POSPage onNavigate={navigate} />}
            {page === 'manage'        && <ManagePage />}
            {page === 'emails'        && <EmailsPage />}
            {page === 'orders'        && <OrdersPage />}
            {page === 'dashboard'     && <DashboardPage />}
            {page === 'bank'          && <BankPage />}
            {page === 'email-summary' && <EmailSummaryPage />}
            {page === 'razer'     && user?.is_admin && <RazerPage />}
            {page === 'pay24'     && user?.is_admin && <Pay24Page />}
            {page === 'pay24-bot' && user?.is_admin && <Pay24BotPage />}
            {page === 'users'     && user?.is_admin && <UsersPage currentUser={user} />}
          </div>
        </main>
      </div>

      {showScrollTop && (
        <button
          onClick={() => mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-4 lg:right-6 z-50 w-10 h-10 rounded-full bg-brand text-white shadow-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all cursor-pointer"
          title="กลับขึ้นบนสุด"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m18 15-6-6-6 6"/>
          </svg>
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/me')
      .then(r => r.ok ? r.json() : null)
      .then(u => {
        setUser(u)
        setLoading(false)
        if (u && ADMIN_PAGES.has(hashPage()) && !u.is_admin) window.location.hash = 'pos'
      })
  }, [])

  async function logout() {
    await fetch('/logout', { method: 'POST' })
    setUser(null)
    window.location.hash = 'pos'
  }

  if (loading) {
    return (
      <ThemeProvider>
        <div className="flex justify-center items-center min-h-screen bg-(--bg) text-(--text-muted) text-sm">
          กำลังโหลด...
        </div>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      {!user
        ? <AuthScreen onLogin={setUser} />
        : <AppShell user={user} onLogout={logout} />
      }
    </ThemeProvider>
  )
}
