import { useState, useEffect, useCallback, useMemo } from 'react'

const BUILTIN_TYPES = {
  'EMAIL': { label: 'Apple ID', color: 'bg-blue-100 text-blue-700' },
  'RAZER': { label: 'Razer',    color: 'bg-green-100 text-green-700' },
}

const CUSTOM_COLORS = [
  'bg-orange-100 text-orange-700',
  'bg-teal-100 text-teal-700',
  'bg-pink-100 text-pink-700',
  'bg-indigo-100 text-indigo-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
  'bg-rose-100 text-rose-700',
  'bg-lime-100 text-lime-700',
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function FillTypeBadge({ fill_type, allTypes }) {
  const cfg = allTypes[fill_type]
  if (!cfg) return null
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
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
  const [customTypes, setCustomTypes] = useState([])
  const [form, setForm] = useState({
    email: '', password: '', link_sms: '', credits: '', cost: '',
    fill_type: '', note: '', created_date: todayStr(),
  })
  const [formError, setFormError] = useState('')
  const [showPass, setShowPass] = useState({})
  const [editModal, setEditModal] = useState(null)
  const [editShowPass, setEditShowPass] = useState(false)

  // new type form
  const [showNewType, setShowNewType] = useState(false)
  const [newTypeLabel, setNewTypeLabel] = useState('')
  const [newTypeBehavior, setNewTypeBehavior] = useState('EMAIL')
  const [newTypeError, setNewTypeError] = useState('')

  // Inline note editing
  const [inlineNote, setInlineNote] = useState(null) // { id, value }

  // Filter state
  const [hideZero, setHideZero] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')

  async function loadAll() {
    const [emailData, typeData] = await Promise.all([
      fetch('/emails').then(r => r.json()),
      fetch('/email-types').then(r => r.json()),
    ])
    setEmails(emailData)
    setCustomTypes(typeData)
  }

  useEffect(() => {
    loadAll()
    const timer = setInterval(loadAll, 10000)
    return () => clearInterval(timer)
  }, [])

  // allTypes = builtin + custom รวมกัน
  const allTypes = useMemo(() => {
    const combined = { ...BUILTIN_TYPES }
    customTypes.forEach((t, idx) => {
      combined[t.key] = { label: t.label, color: t.color || CUSTOM_COLORS[idx % CUSTOM_COLORS.length] }
    })
    return combined
  }, [customTypes])

  function hasCreditsBehavior(fill_type) {
    if (!fill_type) return false
    const t = customTypes.find(ct => ct.key === fill_type)
    return t?.behavior === 'CREDITS'
  }

  // Filtered email list
  const filtered = useMemo(() => emails.filter(e => {
    if (hideZero && Number(e.credits) === 0) return false
    if (filterType && e.fill_type !== filterType) return false
    if (search && !e.email.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [emails, hideZero, filterType, search])

  // Filter tabs — ประเภทที่มีอยู่จริงในข้อมูล + ทั้งหมด
  const presentFilterTypes = useMemo(() => {
    const used = new Set(emails.map(e => e.fill_type).filter(Boolean))
    const tabs = [{ key: '', label: 'ทั้งหมด' }]
    Object.entries(allTypes).forEach(([key, cfg]) => {
      if (used.has(key)) tabs.push({ key, label: cfg.label })
    })
    return tabs
  }, [emails, allTypes])

  async function addEmail() {
    setFormError('')
    const isCredits = hasCreditsBehavior(form.fill_type)
    if (!form.email.trim()) {
      setFormError('กรุณากรอก ' + (isCredits ? 'ชื่อ Supplier' : 'Email'))
      return
    }
    if (!isCredits && !form.password.trim()) { setFormError('กรุณากรอก Password'); return }
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
        created_date: form.created_date || null,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setFormError(data.error); return }
    setForm({ email: '', password: '', link_sms: '', credits: '', cost: '', fill_type: '', note: '', created_date: todayStr() })
    loadAll()
  }

  async function saveEdit() {
    const { id, email, password, link_sms, credits, cost, fill_type, note, broken, created_date } = editModal
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
        broken: broken ? 1 : 0,
        created_date: created_date || null,
      }),
    })
    setEditModal(null)
    setEditShowPass(false)
    loadAll()
  }

  async function saveInlineNote(email, newNote) {
    await fetch(`/emails/${email.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.email,
        password: email.password,
        link_sms: email.link_sms || null,
        credits: Number(email.credits) || 0,
        cost: Number(email.cost) || 0,
        fill_type: email.fill_type || null,
        note: newNote.trim() || null,
        broken: email.broken ? 1 : 0,
        created_date: email.created_date || null,
      }),
    })
    loadAll()
  }

  async function toggleBroken(email) {
    await fetch(`/emails/${email.id}/broken`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broken: !email.broken }),
    })
    loadAll()
  }

  async function deleteEmail(id) {
    if (!confirm('ลบ Email นี้?')) return
    await fetch(`/emails/${id}`, { method: 'DELETE' })
    loadAll()
  }

  async function createType() {
    setNewTypeError('')
    if (!newTypeLabel.trim()) { setNewTypeError('กรุณากรอกชื่อประเภท'); return }
    const colorIdx = customTypes.length % CUSTOM_COLORS.length
    const res = await fetch('/email-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: newTypeLabel.trim(),
        label: newTypeLabel.trim(),
        color: CUSTOM_COLORS[colorIdx],
        behavior: newTypeBehavior,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setNewTypeError(data.error); return }
    setNewTypeLabel('')
    setNewTypeBehavior('EMAIL')
    setShowNewType(false)
    loadAll()
  }

  async function deleteType(id, key) {
    if (!confirm(`ลบประเภท "${key}"? Email ที่ใช้ประเภทนี้อยู่จะไม่ถูกกระทบ`)) return
    await fetch(`/email-types/${id}`, { method: 'DELETE' })
    loadAll()
  }

  const inputCls = 'border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500'

  function TypeSelect({ value, onChange, className }) {
    return (
      <div className="relative flex gap-1.5">
        <select
          className={`flex-1 ${inputCls} text-slate-600 ${className ?? ''}`}
          value={value}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">— เลือกประเภท Email —</option>
          {Object.entries(allTypes).map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => { setShowNewType(true); setNewTypeLabel(''); setNewTypeError('') }}
          className="px-3 py-2.5 border border-dashed border-slate-300 rounded-lg text-slate-400 hover:border-blue-400 hover:text-blue-500 text-sm cursor-pointer whitespace-nowrap transition-colors"
          title="สร้างประเภทใหม่"
        >
          + ประเภท
        </button>
      </div>
    )
  }

  const isCreditsForm = hasCreditsBehavior(form.fill_type)
  const isCreditsEdit = editModal ? hasCreditsBehavior(editModal.fill_type) : false

  return (
    <div className="space-y-5">
      {/* Add Email */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="font-semibold text-slate-800 mb-4">เพิ่ม Email ใหม่</h2>
        <div className="grid grid-cols-2 gap-2.5 mb-2">
          {/* ประเภทก่อน เพื่อจะได้ detect CREDITS */}
          <div className="col-span-2">
            <TypeSelect value={form.fill_type} onChange={v => setForm(f => ({ ...f, fill_type: v }))} />
          </div>
          {isCreditsForm ? (
            <input
              className={`col-span-2 ${inputCls}`}
              placeholder="ชื่อ Supplier"
              type="text"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          ) : (
            <>
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
            </>
          )}
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
          {!isCreditsForm && (
            <input
              className={inputCls}
              placeholder="Link SMS (ไม่บังคับ)"
              value={form.link_sms}
              onChange={e => setForm(f => ({ ...f, link_sms: e.target.value }))}
            />
          )}
          <div className={isCreditsForm ? 'col-span-2' : ''}>
            <input
              className={`w-full ${inputCls}`}
              type="date"
              title="วันที่บันทึก"
              value={form.created_date}
              onChange={e => setForm(f => ({ ...f, created_date: e.target.value }))}
            />
          </div>
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

      {/* Custom type tags */}
      {customTypes.length > 0 && (
        <div className="bg-white rounded-xl px-6 py-4 shadow-sm">
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wide mb-3">ประเภทที่สร้างเอง</p>
          <div className="flex flex-wrap gap-2">
            {customTypes.map((t, idx) => (
              <span key={t.id} className={`inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-xs font-medium ${t.color || CUSTOM_COLORS[idx % CUSTOM_COLORS.length]}`}>
                {t.label}
                {t.behavior === 'CREDITS' && <span className="opacity-60 text-[10px]">(Credits)</span>}
                <button
                  onClick={() => deleteType(t.id, t.label)}
                  className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-black/10 cursor-pointer transition-colors text-[10px] leading-none"
                  title="ลบประเภทนี้"
                >×</button>
              </span>
            ))}
          </div>
        </div>
      )}

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
          <input
            type="text"
            placeholder="ค้นหา Email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 min-w-[180px]"
          />

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

          <div className="flex rounded-lg border border-slate-300 overflow-hidden">
            {presentFilterTypes.map((t, i) => (
              <button
                key={t.key}
                onClick={() => setFilterType(t.key)}
                className={`px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                  filterType === t.key
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                } ${i < presentFilterTypes.length - 1 ? 'border-r border-slate-300' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>

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
                    <th className="pb-2 px-2 font-medium">Email / Supplier</th>
                    <th className="pb-2 px-2 font-medium">Password</th>
                    <th className="pb-2 px-2 font-medium">หมายเหตุ</th>
                    <th className="pb-2 px-2 font-medium text-center">OTP</th>
                    <th className="pb-2 px-2 font-medium text-right">เครดิตเริ่มต้น</th>
                    <th className="pb-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => (
                    <tr
                      key={e.id}
                      className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${
                        e.broken ? 'bg-red-50 hover:bg-red-100' : (Number(e.credits) === 0 ? 'opacity-50' : '')
                      }`}
                    >
                      <td className="py-2.5 px-2">
                        {e.fill_type ? <FillTypeBadge fill_type={e.fill_type} allTypes={allTypes} /> : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="py-2.5 px-2 text-right font-semibold text-slate-600 whitespace-nowrap">
                        ฿{Number(e.cost).toFixed(2)}
                      </td>
                      <td className={`py-2.5 px-2 text-right font-semibold whitespace-nowrap ${Number(e.credits) === 0 ? 'text-slate-300' : 'text-blue-700'}`}>
                        {Number(e.credits).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-slate-700 relative">
                        <CopyCell value={e.email} />
                      </td>
                      <td className="py-2.5 px-2">
                        {e.password ? (
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
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-xs text-slate-500 max-w-[160px]">
                        {inlineNote?.id === e.id ? (
                          <textarea
                            autoFocus
                            className="w-full border border-blue-300 rounded px-1.5 py-1 text-xs resize-none focus:outline-none focus:border-blue-500 bg-blue-50"
                            rows={2}
                            value={inlineNote.value}
                            onChange={ev => setInlineNote(n => ({ ...n, value: ev.target.value }))}
                            onBlur={() => { saveInlineNote(e, inlineNote.value); setInlineNote(null) }}
                            onKeyDown={ev => {
                              if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); saveInlineNote(e, inlineNote.value); setInlineNote(null) }
                              if (ev.key === 'Escape') setInlineNote(null)
                            }}
                          />
                        ) : (
                          <span
                            onClick={() => setInlineNote({ id: e.id, value: e.note || '' })}
                            className="cursor-pointer hover:bg-slate-100 rounded px-1 -mx-1 block truncate"
                            title={e.note ? e.note : 'คลิกเพื่อแก้ไขหมายเหตุ'}
                          >
                            {e.note || <span className="text-slate-300">—</span>}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {e.link_sms ? (
                          <a
                            href={e.link_sms}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-block px-2.5 py-1 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-md text-xs font-medium cursor-pointer transition-colors"
                          >
                            {e.fill_type === 'RAZER' ? 'Backup' : 'SMS'}
                          </a>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <span className={`font-semibold text-sm ${Number(e.initial_credits) === 0 ? 'text-slate-300' : 'text-slate-600'}`}>
                          {Number(e.initial_credits).toFixed(2)}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right whitespace-nowrap">
                        <button
                          onClick={() => toggleBroken(e)}
                          className={`px-2.5 py-1.5 rounded-md mr-1 cursor-pointer text-xs font-medium transition-colors ${
                            e.broken
                              ? 'bg-red-500 hover:bg-red-600 text-white'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-500'
                          }`}
                          title={e.broken ? 'คลิกเพื่อยกเลิกเสีย' : 'คลิกเพื่อระบุว่าเสีย'}
                        >
                          เสีย
                        </button>
                        <button
                          onClick={() => { setEditModal({ ...e }); setEditShowPass(false) }}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md mr-1 cursor-pointer text-xs"
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

      {/* New Type Modal */}
      {showNewType && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-end sm:items-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 w-full sm:max-w-[360px]">
            <h3 className="font-bold text-slate-800 mb-4">สร้างประเภท Email ใหม่</h3>
            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1.5">ชื่อประเภท</label>
              <input
                autoFocus
                className={`w-full ${inputCls}`}
                placeholder="เช่น Google, Microsoft, 1+"
                value={newTypeLabel}
                onChange={e => { setNewTypeLabel(e.target.value); setNewTypeError('') }}
                onKeyDown={e => e.key === 'Enter' && createType()}
              />
            </div>
            <div className="mb-4">
              <label className="block text-xs text-slate-500 mb-2">ทำงานเหมือน</label>
              <div className="flex gap-2 flex-col">
                {[
                  { v: 'EMAIL', label: 'Apple ID', desc: 'ตัดเครดิตตามชื่อ ($) หรือราคา' },
                  { v: 'RAZER', label: 'Razer', desc: 'กรอกจำนวนเครดิตเองตอนชำระ' },
                  { v: 'CREDITS', label: 'Credits', desc: 'Supplier — กรอกเครดิตเอง ต้นทุน = เครดิต × ราคา/หน่วย' },
                ].map(({ v, label, desc }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setNewTypeBehavior(v)}
                    className={`p-3 rounded-xl border-2 text-left cursor-pointer transition-colors ${
                      newTypeBehavior === v
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${newTypeBehavior === v ? 'text-blue-700' : 'text-slate-700'}`}>{label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            </div>
            {newTypeError && <p className="text-red-500 text-xs mb-2">{newTypeError}</p>}
            <div className="flex gap-2">
              <button
                onClick={createType}
                disabled={!newTypeLabel.trim()}
                className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white py-2.5 rounded-lg text-sm cursor-pointer"
              >
                สร้าง
              </button>
              <button
                onClick={() => { setShowNewType(false); setNewTypeLabel(''); setNewTypeBehavior('EMAIL'); setNewTypeError('') }}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-lg text-sm cursor-pointer"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-end sm:items-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl p-6 sm:p-8 w-full sm:max-w-[460px] max-h-[92vh] overflow-y-auto">
            <h2 className="text-blue-900 font-bold mb-5">แก้ไข Email</h2>
            <div className="space-y-3.5">
              <div>
                <label className="block text-sm text-slate-500 mb-1.5">ประเภท Email</label>
                <TypeSelect
                  value={editModal.fill_type ?? ''}
                  onChange={v => setEditModal(m => ({ ...m, fill_type: v || null }))}
                />
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
                <label className="block text-sm text-slate-500 mb-1.5">
                  {isCreditsEdit ? 'ชื่อ Supplier' : 'Email'}
                </label>
                <input
                  type={isCreditsEdit ? 'text' : 'email'} className={`w-full ${inputCls}`}
                  value={editModal.email}
                  onChange={e => setEditModal(m => ({ ...m, email: e.target.value }))}
                />
              </div>
              {!isCreditsEdit && (
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
              )}
              {!isCreditsEdit && (
                <div>
                  <label className="block text-sm text-slate-500 mb-1.5">Link SMS (ไม่บังคับ)</label>
                  <input
                    className={`w-full ${inputCls}`}
                    value={editModal.link_sms || ''}
                    onChange={e => setEditModal(m => ({ ...m, link_sms: e.target.value }))}
                  />
                </div>
              )}
              <div>
                <label className="block text-sm text-slate-500 mb-1.5">วันที่บันทึก</label>
                <input
                  type="date" className={`w-full ${inputCls}`}
                  value={editModal.created_date || ''}
                  onChange={e => setEditModal(m => ({ ...m, created_date: e.target.value }))}
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
              <div className="flex items-center gap-3 pt-1">
                <label className="text-sm text-slate-500">สถานะ</label>
                <button
                  type="button"
                  onClick={() => setEditModal(m => ({ ...m, broken: !m.broken }))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer border transition-colors ${
                    editModal.broken
                      ? 'bg-red-500 text-white border-red-500'
                      : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  {editModal.broken ? '🔴 เสีย' : 'ปกติ'}
                </button>
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
