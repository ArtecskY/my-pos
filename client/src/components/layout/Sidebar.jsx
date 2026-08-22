import { cn } from '../../lib/utils'
import {
  ShoppingCart, Package, Mail, FileText, LayoutDashboard,
  Bot, Users, CreditCard, X, ChevronRight, ChevronLeft
} from 'lucide-react'

const NAV_GROUPS = [
  {
    label: 'Main',
    items: [
      { key: 'pos',       label: 'หน้าขาย',      icon: ShoppingCart },
      { key: 'orders',    label: 'ประวัติรายการ', icon: CreditCard },
      { key: 'dashboard', label: 'Dashboard',     icon: LayoutDashboard },
    ],
  },
  {
    label: 'Manage',
    items: [
      { key: 'manage',        label: 'จัดการสินค้า', icon: Package },
      { key: 'emails',        label: 'จัดการ Email', icon: Mail },
      { key: 'email-summary', label: 'สรุป Email',   icon: FileText },
    ],
  },
]

const ADMIN_GROUP = {
  label: 'Admin',
  items: [
    { key: 'razer',    label: 'Razer Bot',     icon: Bot },
    { key: 'pay24',    label: '24Pay จัดการ',  icon: Package },
    { key: 'pay24-bot', label: '24Pay Bot',    icon: Bot },
    { key: 'users',    label: 'จัดการผู้ใช้',  icon: Users },
  ],
}

export default function Sidebar({ page, onChangePage, user, open, onClose, collapsed, onToggleCollapse }) {
  const groups = [...NAV_GROUPS, ...(user?.is_admin ? [ADMIN_GROUP] : [])]

  function handleNav(key) {
    onChangePage(key)
    onClose()
  }

  function NavItem({ navKey, label, icon: Icon }) {
    const active = page === navKey
    return (
      <button
        title={collapsed ? label : undefined}
        onClick={() => handleNav(navKey)}
        className={cn(
          'w-full flex items-center rounded-xl text-sm font-medium',
          'transition-all duration-150 cursor-pointer group',
          collapsed ? 'justify-center px-2 py-2.5' : 'gap-3 px-3 py-2.5',
          active
            ? 'bg-brand/10 text-brand'
            : 'text-(--text-muted) hover:bg-(--surface2) hover:text-(--text)'
        )}
      >
        <Icon size={17} strokeWidth={active ? 2.5 : 2} className={cn(
          'shrink-0 transition-colors',
          active ? 'text-brand' : 'text-(--text-muted) group-hover:text-(--text)'
        )} />
        {!collapsed && <span className="flex-1 text-left">{label}</span>}
        {!collapsed && active && <ChevronRight size={14} className="text-brand opacity-60" />}
      </button>
    )
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={cn(
        'fixed top-0 left-0 h-full z-50 flex flex-col',
        collapsed ? 'w-16' : 'w-56',
        'border-r border-(--border)',
        'bg-(--sidebar-bg)',
        'transition-all duration-300 ease-in-out',
        'lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen lg:z-auto',
        open ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className={cn(
          'flex items-center py-5 border-b border-(--border)',
          collapsed ? 'justify-center px-3' : 'justify-between px-5'
        )}>
          {collapsed ? (
            <button
              onClick={onToggleCollapse}
              title="Expand sidebar"
              className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center shadow-sm cursor-pointer hover:opacity-80 transition-opacity"
            >
              <ShoppingCart size={16} className="text-white" strokeWidth={2.5} />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center shadow-sm">
                  <ShoppingCart size={16} className="text-white" strokeWidth={2.5} />
                </div>
                <div>
                  <p className="text-sm font-bold text-(--text) leading-tight">WisdomTopup</p>
                  <p className="text-xs text-(--text-muted) leading-tight">POS system</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={onToggleCollapse}
                  title="Collapse sidebar"
                  className="hidden lg:flex p-1 rounded-lg hover:bg-(--surface2) text-(--text-muted) cursor-pointer transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <button onClick={onClose} className="lg:hidden p-1 rounded-lg hover:bg-(--surface2) text-(--text-muted)">
                  <X size={16} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-4 overflow-y-auto space-y-4">
          {groups.map(group => (
            <div key={group.label}>
              {!collapsed && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-(--text-muted) opacity-60">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavItem key={item.key} navKey={item.key} label={item.label} icon={item.icon} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User info bottom */}
        <div className={cn('py-4 border-t border-(--border)', collapsed ? 'flex justify-center px-2' : 'px-4')}>
          {collapsed ? (
            <div
              title={user?.username}
              className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-brand text-xs font-bold uppercase shrink-0 cursor-default"
            >
              {(user?.username || 'U').slice(0, 1)}
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-brand/10 flex items-center justify-center text-brand text-xs font-bold uppercase shrink-0">
                {(user?.username || 'U').slice(0, 1)}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-(--text) truncate">{user?.username}</p>
                <p className="text-xs text-(--text-muted)">{user?.is_admin ? 'Admin' : 'Staff'}</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
