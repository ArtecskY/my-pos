import { Sun, Moon, Menu, LogOut, Database } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { cn } from '../../lib/utils'

const PAGE_LABELS = {
  pos:             'หน้าขาย',
  manage:          'จัดการสินค้า',
  emails:          'จัดการ Email',
  'email-summary': 'สรุป Email',
  orders:          'ประวัติรายการ',
  dashboard:       'Dashboard',
  razer:           'Razer Bot',
  users:           'จัดการผู้ใช้',
  bank:            'เช็คเงินเข้า',
}

export default function TopBar({ page, user, onLogout, onMenuOpen }) {
  const { dark, toggle } = useTheme()

  return (
    <header className={cn(
      'sticky top-0 z-30 flex items-center justify-between',
      'px-4 sm:px-6 h-14',
      'bg-(--surface)/80 backdrop-blur-md',
      'border-b border-(--border)'
    )}>
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuOpen}
          className="lg:hidden p-2 -ml-1 rounded-xl hover:bg-(--surface2) text-(--text-muted) transition-colors"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-sm font-semibold text-(--text)">{PAGE_LABELS[page] || page}</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Dark mode toggle */}
        <button
          onClick={toggle}
          className={cn(
            'relative w-12 h-6 rounded-full transition-colors duration-300 focus:outline-none cursor-pointer',
            dark ? 'bg-brand' : 'bg-slate-200'
          )}
          aria-label="Toggle dark mode"
        >
          <span className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full flex items-center justify-center',
            'bg-white shadow-sm transition-transform duration-300',
            dark ? 'translate-x-6' : 'translate-x-0'
          )}>
            {dark
              ? <Moon size={11} className="text-brand" />
              : <Sun size={11} className="text-amber-500" />
            }
          </span>
        </button>

        {user?.is_admin && (
          <a
            href="/admin/download-db"
            download="pos.db"
            title="Download pos.db"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-(--text-muted) hover:bg-brand/10 hover:text-brand transition-colors"
          >
            <Database size={14} />
            <span className="hidden sm:inline">DB</span>
          </a>
        )}

        <span className="hidden sm:block text-xs text-(--text-muted) px-1">{user?.username}</span>

        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-(--text-muted) hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">ออกจากระบบ</span>
        </button>
      </div>
    </header>
  )
}
