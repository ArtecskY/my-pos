export default function NavTabs({ page, onChangePage, user }) {
  const tabs = [
    ['pos', 'หน้าขาย'],
    ['manage', 'จัดการสินค้า'],
    ['emails', 'จัดการ Email'],
    ['orders', 'ประวัติรายการ'],
    ['dashboard', 'Dashboard'],
    ...(user?.is_admin ? [['users', 'จัดการผู้ใช้']] : []),
  ]
  return (
    <div className="flex gap-0.5 border-b-2 border-slate-200 mb-5 overflow-x-auto">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChangePage(key)}
          className={`px-3 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm whitespace-nowrap border-b-2 -mb-0.5 cursor-pointer flex-shrink-0 ${
            page === key
              ? 'text-blue-500 font-semibold border-blue-500'
              : 'text-slate-500 border-transparent hover:text-slate-700'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
