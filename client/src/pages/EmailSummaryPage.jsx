import { useState, useEffect, useMemo } from 'react'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function firstDayOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function splitDateTime(str) {
  if (!str) return { date: '—', time: '' }
  const s = str.replace('T', ' ')
  const [date, time] = s.split(' ')
  return { date: date || '—', time: time ? time.slice(0, 5) : '' }
}

const TYPE_CONFIG = {
  EMAIL: { label: 'Apple ID', color: 'bg-blue-100 text-blue-700' },
  RAZER: { label: 'Razer', color: 'bg-green-100 text-green-700' },
}

function TypeBadge({ fill_type, emailTypes }) {
  const cfg = TYPE_CONFIG[fill_type] || emailTypes.find(t => t.key === fill_type)
  if (!cfg) return null
  const color = cfg.color || 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
      {cfg.label}
    </span>
  )
}

export default function EmailSummaryPage() {
  const [emails, setEmails] = useState([])
  const [emailTypes, setEmailTypes] = useState([])
  const [selectedEmailId, setSelectedEmailId] = useState('')
  const [from, setFrom] = useState(firstDayOfMonth())
  const [to, setTo] = useState(todayStr())
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('') // '' = ทั้งหมด
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/emails').then(r => r.json()).then(setEmails).catch(() => {})
    fetch('/email-types').then(r => r.json()).then(setEmailTypes).catch(() => {})
  }, [])

  // สร้างตัวเลือก type จาก emails จริง
  const availableTypes = useMemo(() => {
    const types = new Set(emails.map(e => e.fill_type).filter(Boolean))
    const result = []
    if (types.has('EMAIL')) result.push({ key: 'EMAIL', label: 'Apple ID', color: 'bg-blue-100 text-blue-700' })
    if (types.has('RAZER')) result.push({ key: 'RAZER', label: 'Razer', color: 'bg-green-100 text-green-700' })
    for (const et of emailTypes) {
      if (types.has(et.key) && et.key !== 'EMAIL' && et.key !== 'RAZER') {
        result.push({ key: et.key, label: et.label, color: et.color || 'bg-slate-100 text-slate-600' })
      }
    }
    return result
  }, [emails, emailTypes])

  const filteredEmails = useMemo(() => emails.filter(e => {
    if (filterType && e.fill_type !== filterType) return false
    if (search && !e.email?.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [emails, filterType, search])

  async function loadSummary(emailId, fromDate = from, toDate = to) {
    if (!emailId) return
    setLoading(true)
    setError('')
    setData(null)
    try {
      const params = new URLSearchParams({ email_id: emailId, from: fromDate, to: toDate })
      const res = await fetch(`/email-summary?${params}`)
      if (!res.ok) throw new Error(await res.text())
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function selectEmail(id) {
    setSelectedEmailId(id)
    loadSummary(id)
  }

  function handleDateChange(field, val) {
    const newFrom = field === 'from' ? val : from
    const newTo = field === 'to' ? val : to
    if (field === 'from') setFrom(val)
    else setTo(val)
    if (selectedEmailId) loadSummary(selectedEmailId, newFrom, newTo)
  }

  const selectedEmail = emails.find(e => e.id === selectedEmailId)

  return (
    <div className="max-w-5xl mx-auto space-y-4">

      {/* Header bar */}
      <div className="bg-white rounded-xl p-5 shadow-sm">
        <h2 className="text-lg font-bold text-slate-800 mb-4">สรุปการใช้งาน Email</h2>

        {/* ช่วงวันที่ */}
        <div className="flex flex-wrap gap-3 mb-4 items-center">
          <span className="text-sm font-semibold text-slate-500">ช่วงวันที่</span>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">จาก</label>
            <input type="date" value={from}
              onChange={e => handleDateChange('from', e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:border-blue-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400">ถึง</label>
            <input type="date" value={to}
              onChange={e => handleDateChange('to', e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>

        {/* Filter ประเภท */}
        {availableTypes.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setFilterType('')}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border cursor-pointer transition-colors ${
                filterType === '' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
              }`}
            >ทั้งหมด</button>
            {availableTypes.map(t => (
              <button key={t.key}
                onClick={() => setFilterType(prev => prev === t.key ? '' : t.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border cursor-pointer transition-colors ${
                  filterType === t.key ? t.color + ' border-transparent' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                }`}
              >{t.label}</button>
            ))}
          </div>
        )}

        {/* ค้นหา */}
        <div className="mb-3">
          <input type="text" value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา email..."
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
          />
        </div>

        {/* รายการ Email */}
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {filteredEmails.length === 0 && (
            <p className="text-sm text-slate-400 py-4 text-center">ไม่พบ email</p>
          )}
          {filteredEmails.map(e => {
            const typeCfg = TYPE_CONFIG[e.fill_type] || emailTypes.find(t => t.key === e.fill_type)
            const typeColor = typeCfg?.color || 'bg-slate-100 text-slate-600'
            const typeLabel = typeCfg?.label || e.fill_type || '—'
            const isSelected = selectedEmailId === e.id
            return (
              <button key={e.id} onClick={() => selectEmail(e.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected ? 'bg-blue-50 border-blue-400 shadow-sm' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <div className="flex justify-between items-center gap-3 flex-wrap">
                  <span className={`text-sm font-bold break-all ${isSelected ? 'text-blue-700' : 'text-slate-800'}`}>
                    {e.email}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${typeColor}`}>{typeLabel}</span>
                    <span className="text-xs font-semibold text-slate-500">
                      {e.credits?.toFixed(2) ?? '—'} <span className="font-normal text-slate-400">ดอลล์</span>
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="bg-white rounded-xl p-8 text-center text-slate-400 shadow-sm">กำลังโหลด...</div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm font-medium text-red-600">{error}</div>
      )}

      {/* Summary */}
      {data && !loading && (
        <>
          {/* Email info + stats */}
          <div className="bg-white rounded-xl p-5 shadow-sm">
            <div className="flex flex-wrap gap-4 items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-base font-bold text-slate-800 break-all">{data.email.email}</p>
                  <TypeBadge fill_type={data.email.fill_type} emailTypes={emailTypes} />
                </div>
                {data.email.note && <p className="text-xs text-slate-400">{data.email.note}</p>}
              </div>
              <div className="flex gap-3 flex-wrap">
                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-center min-w-[90px]">
                  <p className="text-xs font-semibold text-blue-400 mb-1">เครดิตเริ่มต้น</p>
                  <p className="text-xl font-bold text-blue-700">${data.summary.initial_credits?.toFixed(2) ?? '—'}</p>
                </div>
                <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-center min-w-[90px]">
                  <p className="text-xs font-semibold text-red-400 mb-1">ใช้ไป</p>
                  <p className="text-xl font-bold text-red-600">${data.summary.total_used?.toFixed(2) ?? '0.00'}</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-center min-w-[90px]">
                  <p className="text-xs font-semibold text-emerald-500 mb-1">คงเหลือ</p>
                  <p className="text-xl font-bold text-emerald-700">${data.email.credits?.toFixed(2) ?? '—'}</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-slate-400">{from} — {to} · <span className="font-semibold text-slate-600">{data.items.length} รายการ</span></p>
          </div>

          {/* Table */}
          {data.items.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center text-slate-400 shadow-sm">ไม่มีรายการในช่วงเวลานี้</div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">วันที่ / เวลา</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">สินค้า</th>
                    <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">จำนวน</th>
                    <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">เครดิตที่ตัด</th>
                    <th className="text-right px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wide">Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((item, i) => {
                    const { date, time } = splitDateTime(item.created_at)
                    return (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-bold text-slate-700">{date}</p>
                          {time && <p className="text-xs text-slate-400 mt-0.5">{time}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800">{item.product_name || '—'}</p>
                          {item.category_name && (
                            <p className="text-xs text-slate-400 mt-0.5">{item.category_name}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-700">{item.quantity}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-bold text-red-600">
                            {item.credit_deducted != null ? `$${Number(item.credit_deducted).toFixed(2)}` : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-semibold text-slate-400">#{item.order_id}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-sm font-bold text-slate-600">รวมทั้งหมด</td>
                    <td className="px-4 py-3 text-right text-base font-bold text-red-600">
                      ${data.summary.total_used?.toFixed(2) ?? '0.00'}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
