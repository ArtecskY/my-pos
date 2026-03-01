import { useState, useEffect, useCallback, useMemo } from 'react'

const FILL_TYPE_CONFIG = {
  'EMAIL':       { label: 'Apple ID',       cls: 'bg-blue-100 text-blue-700' },
  'RAZER':       { label: 'Razer',          cls: 'bg-green-100 text-green-700' },
  'OTHER_EMAIL': { label: 'อื่นๆ · Email', cls: 'bg-purple-100 text-purple-700' },
}

const FILTER_TYPES = [
  { key: '',            label: 'ทั้งหมด' },
  { key: 'EMAIL',       label: 'Apple ID' },
  { key: 'RAZER',       label: 'Razer' },
  { key: 'OTHER_EMAIL', label: 'อื่นๆ · Email' },
]

function FillTypeBadge({ fill_type }) {
  const cfg = FILL_TYPE_CONFIG[fill_type]
  if (!cfg) return null
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

function CopyCell({ value, masked, maskChar = '••••••••' }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [value])
  return (
    <span
      onClick={copy}
      title="คลิกเพื่อ copy"
      className="font-mono text-xs cursor-pointer select-none group relative"
    >
      {masked ? maskChar : value}
      <span className={`absolute -top-6 left-0 px-1.5 py-0.5 bg-slate-700 text-white text-xs rounded whitespace-nowrap transition-opacity ${copied ? 'opacity-100' : 'opacity-0'}`}>
        Copied!
      </span>
    </span>
  )
}

export default function EmailsPage() {
  const [emails, setEmails] = useState([])
  const [form, setForm] = useState({ email: '', password: '', link_sms: '', credits: '', cost: '', fill_type: '', note: '' })
  const [formError, setFormError] = useState('')
  const [showPass, setShowPass] = useState({})
  const [editModal, setEditModal] = useState(null)
  const [editShowPass, setEditShowPass] = useState(false)

  // Filter state
  const [hideZero, setHideZero] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')

  async function loadAll() {
    setEmails(await fetch('/emails').then(r => r.json()))
  }

  useEffect(() => { loadAll() }, [])

  // Filtered email list
  const filtered = useMemo(() => emails.filter(e => {
    if (hideZero && Number(e.credits) === 0) return false
    if (filterType && e.fill_type !== filterType) return false
    if (search && !e.email.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [emails, hideZero, filterType, search])

  // Filter types present in the data
  const presentTypes = useMemo(() => {
    const types = new Set(emails.map(e => e.fill_type).filter(Boolean))
    return FILTER_TYPES.filter(f => f.key === '' || types.has(f.key))
  }, [emails])

  async function addEmail() {
    setFormError('')
    if (!form.email.trim() || !form.password.trim()) { setFormError('กรุณากรอก Email และ Password'); return }
    if (form.credits !== '' && isNaN(Number(form.credits))) { setFormError('เครดิตต้องเป็นตัวเลข'); return }
    if (form.cost !== '' && isNaN(Number(form.cost))) { setFormError('ต้นทุนต้องเป็นตัวเลข'); return }
    const res = await fetch('/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email.trim(),
        password: form.password,
        link_sms: form.link_sms.trim() || null,
        credits: form.credits !== '' ? Number(form.credits) : 0,
        cost: form.cost !== '' ? Number(form.cost) : 0,
        fill_type: form.fill_type || null,
        note: form.note.trim() || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setFormError(data.error); return }
    setForm({ email: '', password: '', link_sms: '', credits: '', cost: '', fill_type: '', note: '' })
    loadAll()
  }

  async function saveEdit() {
    const { id, email, password, link_sms, credits, cost, fill_type, note } = editModal
    await fetch(`/emails/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email, password,
        link_sms: link_sms || null,
        credits: Number(credits) || 0,
        cost: Number(cost) || 0,
        fill_type: fill_type || null,
        note: note || null,
      }),
    })
    setEditModal(null)
    setEditShowPass(false)
    loadAll()
  }

  async function deleteEmail(id) {
    if (!confirm('ลบ Email นี้?')) return
    await fetch(`/emails/${id}`, { method: 'DELETE' })
    loadAll()
  }

  const inputCls = 'border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500'

  return (
    <div className="space-y-5">
      {/* Add Email */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="font-semibold text-slate-800 mb-4">เพิ่ม Email ใหม่</h2>
        <div className="grid grid-cols-2 gap-2.5 mb-2">
          <input
            className={inputCls}
            placeholder="Email"
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          />
          <input
            className={inputCls}
            placeholder="Password"
            type="text"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          />
          <input
            className={inputCls}
            placeholder="เครดิต (เช่น 211.11)"
            type="number"
            step="0.01"
            value={form.credits}
            onChange={e => setForm(f => ({ ...f, credits: e.target.value }))}
          />
          <input
            className={inputCls}
            placeholder="ต้นทุน (เช่น 150.00)"
            type="number"
            step="0.01"
            value={form.cost}
            onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
          />
          <input
            className={inputCls}
            placeholder="Link SMS (ไม่บังคับ)"
            value={form.link_sms}
            onChange={e => setForm(f => ({ ...f, link_sms: e.target.value }))}
          />
          <select
            className={`${inputCls} text-slate-600`}
            value={form.fill_type}
            onChange={e => setForm(f => ({ ...f, fill_type: e.target.value }))}
          >
            <option value="">— เลือกประเภท Email —</option>
            {Object.entries(FILL_TYPE_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>{cfg.label}</option>
            ))}
          </select>
          <textarea
            className={`col-span-2 ${inputCls} resize-none`}
            placeholder="หมายเหตุ (ไม่บังคับ)"
            rows={2}
            value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          />
        </div>
        {formError && <p className="text-red-500 text-sm mb-2">{formError}</p>}
        <button
          onClick={addEmail}
          className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm cursor-pointer"
        >
          + เพิ่ม Email
        </button>
      </div>

      {/* Email list */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold text-slate-800">
            รายการ Email ทั้งหมด
            <span className="ml-2 text-slate-400 font-normal text-sm">
              ({filtered.length}{filtered.length !== emails.length ? `/${emails.length}` : ''})
            </span>
          </h2>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 mb-4">
          {/* Search */}
          <input
            type="text"
            placeholder="ค้นหา Email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 min-w-[180px]"
          />

          {/* ซ่อน 0 เครดิต toggle */}
          <button
            onClick={() => setHideZero(v => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm border cursor-pointer transition-colors ${
              hideZero
                ? 'bg-slate-700 text-white border-transparent'
                : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
            }`}
          >
            ซ่อน 0 เครดิต
          </button>

          {/* กรองตามประเภท */}
          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            {presentTypes.map(t => (
              <button
                key={t.key}
                onClick={() => setFilterType(t.key)}
                className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                  filterType === t.key
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                } ${t.key !== presentTypes[presentTypes.length - 1].key ? 'border-r border-slate-300' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ล้าง filter */}
          {(hideZero || filterType || search) && (
            <button
              onClick={() => { setHideZero(false); setFilterType(''); setSearch('') }}
              className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ล้างตัวกรอง ×
            </button>
          )}
        </div>

        {filtered.length === 0
          ? <p className="text-slate-400 text-center py-6">
              {emails.length === 0 ? 'ยังไม่มี Email' : 'ไม่มี Email ตรงเงื่อนไข'}
            </p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-left">
                    <th className="pb-2 px-2 font-medium">ประเภท</th>
                    <th className="pb-2 px-2 font-medium text-right">ต้นทุน</th>
                    <th className="pb-2 px-2 font-medium text-right">เครดิต</th>
                    <th className="pb-2 px-2 font-medium">Email</th>
                    <th className="pb-2 px-2 font-medium">Password</th>
                    <th className="pb-2 px-2 font-medium">หมายเหตุ</th>
                    <th className="pb-2 px-2 font-medium text-center">Link SMS</th>
                    <th className="pb-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => (
                    <tr key={e.id} className={`border-b border-slate-100 hover:bg-slate-50 ${Number(e.credits) === 0 ? 'opacity-50' : ''}`}>
                      {/* ประเภท */}
                      <td className="py-2.5 px-2">
                        {e.fill_type ? <FillTypeBadge fill_type={e.fill_type} /> : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      {/* ต้นทุน */}
                      <td className="py-2.5 px-2 text-right font-semibold text-slate-600 whitespace-nowrap">
                        ฿{Number(e.cost).toFixed(2)}
                      </td>
                      {/* เครดิต */}
                      <td className={`py-2.5 px-2 text-right font-semibold whitespace-nowrap ${Number(e.credits) === 0 ? 'text-slate-300' : 'text-blue-700'}`}>
                        {Number(e.credits).toFixed(2)}
                      </td>
                      {/* Email */}
                      <td className="py-2.5 px-2 text-slate-700 relative">
                        <CopyCell value={e.email} />
                      </td>
                      {/* Password */}
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-1.5">
                          <span className="relative">
                            <CopyCell value={e.password} masked={!showPass[e.id]} />
                          </span>
                          <button
                            onClick={() => setShowPass(p => ({ ...p, [e.id]: !p[e.id] }))}
                            className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                          >
                            {showPass[e.id] ? 'ซ่อน' : 'แสดง'}
                          </button>
                        </div>
                      </td>
                      {/* หมายเหตุ */}
                      <td className="py-2.5 px-2 text-xs text-slate-500 max-w-[140px] truncate">
                        {e.note || <span className="text-slate-300">—</span>}
                      </td>
                      {/* Link SMS */}
                      <td className="py-2.5 px-2 text-center">
                        {e.link_sms ? (
                          <a
                            href={e.link_sms}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block px-2.5 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-md text-xs font-medium cursor-pointer transition-colors"
                          >
                            SMS
                          </a>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      {/* Actions */}
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => { setEditModal({ ...e }); setEditShowPass(false) }}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md mr-1.5 cursor-pointer text-xs"
                        >
                          แก้ไข
                        </button>
                        <button
                          onClick={() => deleteEmail(e.id)}
                          className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-md cursor-pointer text-xs"
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </div>

      {/* Edit modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[460px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-blue-900 font-bold mb-5">แก้ไข Email</h2>
            <div className="space-y-3.5">
              <div>
                <label className="block text-sm text-slate-500 mb-1.5">ประเภท Email</label>
                <select
                  className={`w-full ${inputCls} text-slate-600`}
                  value={editModal.fill_type ?? ''}
                  onChange={e => setEditModal(m => ({ ...m, fill_type: e.target.value || null }))}
                >
                  <option value="">— ไม่ระบุ —</option>
                  {Object.entries(FILL_TYPE_CONFIG).map(([key, cfg]) => (
                    <option key={key} value={key}>{cfg.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-slate-500 mb-1.5">ต้นทุน (฿)</label>
                  <input
                    type="number" step="0.01" className={`w-full ${inputCls}`}
                    value={editModal.cost ?? 0}
                    onChange={e => setEditModal(m => ({ ...m, cost: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-500 mb-1.5">เครดิต</label>
                  <input
                    type="number" step="0.01" className={`w-full ${inputCls}`}
                    value={editModal.credits}
                    onChange={e => setEditModal(m => ({ ...m, credits: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1.5">Email</label>
                <input
                  type="email" className={`w-full ${inputCls}`}
                  value={editModal.email}
                  onChange={e => setEditModal(m => ({ ...m, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1.5">Password</label>
                <div className="flex gap-2">
                  <input
                    type={editShowPass ? 'text' : 'password'} className={`flex-1 ${inputCls}`}
                    value={editModal.password}
                    onChange={e => setEditModal(m => ({ ...m, password: e.target.value }))}
                  />
                  <button onClick={() => setEditShowPass(p => !p)} className="px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-500 cursor-pointer hover:border-slate-400">
                    {editShowPass ? 'ซ่อน' : 'แสดง'}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1.5">Link SMS (ไม่บังคับ)</label>
                <input
                  className={`w-full ${inputCls}`}
                  value={editModal.link_sms || ''}
                  onChange={e => setEditModal(m => ({ ...m, link_sms: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-sm text-slate-500 mb-1.5">หมายเหตุ</label>
                <textarea
                  className={`w-full ${inputCls} resize-none`}
                  rows={2}
                  value={editModal.note || ''}
                  onChange={e => setEditModal(m => ({ ...m, note: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex gap-2.5 mt-6">
              <button onClick={saveEdit} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-lg cursor-pointer">บันทึก</button>
              <button onClick={() => { setEditModal(null); setEditShowPass(false) }} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-2.5 rounded-lg cursor-pointer">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
