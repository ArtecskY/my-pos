export default function NavTabs({ page, onChangePage }) {
  const tabs = [
    ['pos', 'หน้าขาย'],
    ['manage', 'จัดการสินค้า'],
    ['emails', 'จัดการ Email'],
    ['orders', 'ประวัติรายการ'],
  ]
  return (
    <div className="flex gap-1 border-b-2 border-slate-200 mb-5">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChangePage(key)}
          className={`px-5 py-2.5 text-sm border-b-2 -mb-0.5 cursor-pointer ${
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
