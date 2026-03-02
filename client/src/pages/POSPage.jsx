import { useState, useEffect } from 'react'

function nowLocalTime() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function usesEmailCredits(fill_type, customTypes = []) {
  if (['EMAIL', 'RAZER', 'OTHER_EMAIL'].includes(fill_type)) return true
  return customTypes.some(t => t.key === fill_type)
}

// คำนวณเครดิตต่อชิ้นจากชื่อสินค้า เช่น "50$" หรือ "แพ็ก 50$" → 50
// ถ้าไม่พบ pattern ใช้ราคา ฿ แทน
function creditPerUnit(item) {
  const m = /(\d+(?:\.\d+)?)\$/.exec(item.name)
  return m ? Number(m[1]) : item.price
}

function isRazerBehavior(fill_type, emailTypes = []) {
  if (fill_type === 'RAZER') return true
  const et = emailTypes.find(t => t.key === fill_type)
  return et?.behavior === 'RAZER'
}

const EMAIL_BUILTINS = ['EMAIL', 'OTHER_EMAIL']
function creditsNeeded(item, emailTypes, qty) {
  const q = qty ?? item.quantity
  if (EMAIL_BUILTINS.includes(item.fill_type)) return creditPerUnit(item) * q
  // custom type ที่ behavior=EMAIL → ตัดเหมือน Apple ID
  const ct = emailTypes.find(t => t.key === item.fill_type)
  if (ct?.behavior === 'EMAIL') return creditPerUnit(item) * q
  return q
}


let splitCounter = 0
function newSplitKey(itemId) {
  return `${itemId}-s-${++splitCounter}`
}

export default function POSPage() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCat, setSelectedCat] = useState('')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [receipt, setReceipt] = useState(null)
  const [showPayModal, setShowPayModal] = useState(false)
  const [transferAmount, setTransferAmount] = useState('')
  const [transferTime, setTransferTime] = useState('')

  // keyed by item.id (non-split) หรือ splitKey (split)
  const [razerAmounts, setRazerAmounts] = useState({})
  const [selectedEmails, setSelectedEmails] = useState({})
  const [availableEmails, setAvailableEmails] = useState({})

  // { [itemId]: [{splitKey, quantity}] } — null / ไม่มี key = ยังไม่ split
  const [splitState, setSplitState] = useState({})
  const [channel, setChannel] = useState(null)
  const [emailTypes, setEmailTypes] = useState([])
  const [selectedFillType, setSelectedFillType] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/products').then(r => r.json()),
      fetch('/categories').then(r => r.json()),
      fetch('/email-types').then(r => r.json()),
    ]).then(([p, c, et]) => { setProducts(p); setCategories(c); setEmailTypes(et) })
  }, [])

  const FILL_TYPE_LABELS = {
    'UID': 'UID', 'EMAIL': 'Apple ID', 'RAZER': 'Razer',
    'ID_PASS': 'Stock77', 'OTHER_UID': 'อื่นๆ (UID)', 'OTHER_EMAIL': 'อื่นๆ (Email)',
  }
  function fillTypeLabel(ft) {
    if (FILL_TYPE_LABELS[ft]) return FILL_TYPE_LABELS[ft]
    return emailTypes.find(t => t.key === ft)?.label || ft
  }

  // fill types ที่มีสินค้า (stock > 0 หรือ -1) อยู่จริง
  const activeFillTypes = [...new Set(
    categories
      .filter(cat => products.some(p => p.category_id === cat.id && (p.stock > 0 || p.stock === -1)))
      .map(cat => cat.fill_type)
      .filter(Boolean)
  )]

  const grouped = categories
    .filter(cat => !selectedCat || String(cat.id) === selectedCat)
    .filter(cat => !selectedFillType || cat.fill_type === selectedFillType)
    .map(cat => {
      const searchLower = search.toLowerCase()
      const catMatch = !search || cat.name.toLowerCase().includes(searchLower)
      return {
        ...cat,
        products: products.filter(p =>
          p.category_id === cat.id &&
          (p.stock > 0 || p.stock === -1) &&
          (catMatch || p.name.toLowerCase().includes(searchLower))
        ),
      }
    })
    .filter(cat => cat.products.length > 0)

  // ---- Cart (พฤติกรรมเดิม) ----
  function addToCart(p) {
    setCart(prev => {
      const existing = prev.find(i => i.id === p.id)
      if (existing) return prev.map(i => i.id === p.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...p, quantity: 1 }]
    })
  }

  function changeQty(id, delta) {
    setCart(prev =>
      prev.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i)
          .filter(i => i.quantity > 0)
    )
  }

  function removeFromCart(id) {
    setCart(prev => prev.filter(i => i.id !== id))
  }

  // ---- Split helpers ----
  async function fetchEmailsFor(key, fill_type, needed) {
    const data = await fetch(`/emails/available?fill_type=${encodeURIComponent(fill_type)}&needed=${needed}`).then(r => r.json())
    setAvailableEmails(prev => ({ ...prev, [key]: data }))
    if (data.length === 1) setSelectedEmails(prev => ({ ...prev, [key]: String(data[0].id) }))
  }

  function activateSplit(item) {
    // สร้าง 2 split entries โดยแบ่ง quantity เท่าๆ กัน
    const qty1 = Math.ceil(item.quantity / 2)
    const qty2 = item.quantity - qty1
    const splits = [
      { splitKey: newSplitKey(item.id), quantity: qty1 },
      { splitKey: newSplitKey(item.id), quantity: qty2 },
    ]
    setSplitState(prev => ({ ...prev, [item.id]: splits }))
    splits.forEach(s => {
      if (!isRazerBehavior(item.fill_type, emailTypes)) {
        fetchEmailsFor(s.splitKey, item.fill_type, creditsNeeded(item, emailTypes, s.quantity))
      }
    })
  }

  function deactivateSplit(itemId) {
    setSplitState(prev => { const n = { ...prev }; delete n[itemId]; return n })
  }

  function addSplitEntry(item) {
    const splitKey = newSplitKey(item.id)
    setSplitState(prev => ({
      ...prev,
      [item.id]: [...prev[item.id], { splitKey, quantity: 1 }],
    }))
    if (!isRazerBehavior(item.fill_type, emailTypes)) {
      fetchEmailsFor(splitKey, item.fill_type, creditsNeeded(item, emailTypes, 1))
    }
    // clear selected email for new entry
    setSelectedEmails(prev => { const n = { ...prev }; delete n[splitKey]; return n })
  }

  function removeSplitEntry(itemId, splitKey) {
    setSplitState(prev => ({
      ...prev,
      [itemId]: prev[itemId].filter(s => s.splitKey !== splitKey),
    }))
    setSelectedEmails(prev => { const n = { ...prev }; delete n[splitKey]; return n })
    setAvailableEmails(prev => { const n = { ...prev }; delete n[splitKey]; return n })
  }

  function changeSplitQty(itemId, splitKey, delta) {
    const currentSplit = splitState[itemId]?.find(s => s.splitKey === splitKey)
    if (!currentSplit) return
    const newQty = Math.max(1, currentSplit.quantity + delta)
    setSplitState(prev => ({
      ...prev,
      [itemId]: prev[itemId].map(s =>
        s.splitKey === splitKey ? { ...s, quantity: newQty } : s
      ),
    }))
    // re-fetch emails ด้วย quantity ใหม่ และล้าง email ที่เลือกไว้
    const item = cart.find(i => i.id === itemId)
    if (item && !isRazerBehavior(item.fill_type, emailTypes)) {
      setSelectedEmails(prev => { const n = { ...prev }; delete n[splitKey]; return n })
      fetchEmailsFor(splitKey, item.fill_type, creditsNeeded(item, emailTypes, newQty))
    }
  }

  // ---- Payment modal ----
  async function openPayModal() {
    if (cart.length === 0) return alert('กรุณาเลือกสินค้าก่อนครับ')
    setTransferAmount(String(total))
    setTransferTime(nowLocalTime())
    setRazerAmounts({})
    setSelectedEmails({})
    setAvailableEmails({})
    setSplitState({})
    setShowPayModal(true)
    // pre-fetch สำหรับ EMAIL/OTHER_EMAIL (ก่อน split)
    for (const item of cart) {
      if (usesEmailCredits(item.fill_type, emailTypes) && !isRazerBehavior(item.fill_type, emailTypes)) {
        fetchEmailsFor(item.id, item.fill_type, creditsNeeded(item, emailTypes))
      }
    }
  }

  async function confirmCheckout() {
    const orderItems = []

    for (const item of cart) {
      if (usesEmailCredits(item.fill_type, emailTypes)) {
        const splits = splitState[item.id]
        if (splits && splits.length > 0) {
          // validate + build split entries
          for (const s of splits) {
            if (isRazerBehavior(item.fill_type, emailTypes) && (!razerAmounts[s.splitKey] || Number(razerAmounts[s.splitKey]) <= 0)) {
              alert(`กรุณากรอกจำนวนเครดิตสำหรับ "${item.name}"`); return
            }
            if (!selectedEmails[s.splitKey]) {
              alert(`กรุณาเลือก Email สำหรับ "${item.name}" (split)`); return
            }
            orderItems.push({
              product_id: item.id,
              quantity: s.quantity,
              email_id: Number(selectedEmails[s.splitKey]),
              ...(isRazerBehavior(item.fill_type, emailTypes) ? { credit_amount: Number(razerAmounts[s.splitKey]) } : {}),
            })
          }
        } else {
          // ไม่ split — ใช้ item.id เป็น key เหมือนเดิม
          if (isRazerBehavior(item.fill_type, emailTypes) && (!razerAmounts[item.id] || Number(razerAmounts[item.id]) <= 0)) {
            alert(`กรุณากรอกจำนวนเครดิตที่จะตัดสำหรับ "${item.name}"`); return
          }
          if (!selectedEmails[item.id]) {
            alert(`กรุณาเลือก Email สำหรับ "${item.name}"`); return
          }
          orderItems.push({
            product_id: item.id,
            quantity: item.quantity,
            email_id: Number(selectedEmails[item.id]),
            ...(isRazerBehavior(item.fill_type, emailTypes) ? { credit_amount: Number(razerAmounts[item.id]) } : {}),
          })
        }
      } else {
        orderItems.push({ product_id: item.id, quantity: item.quantity })
      }
    }

    const res = await fetch('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: orderItems,
        transfer_amount: transferAmount ? Number(transferAmount) : null,
        transfer_time: transferTime || null,
        channel: channel || null,
      }),
    })
    const order = await res.json()
    if (!res.ok) { alert(order.error); return }
    setShowPayModal(false)
    setReceipt(order)
    setCart([])
    setChannel(null)
    fetch('/products').then(r => r.json()).then(setProducts)
  }

  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0)

  // ---- Email selector component ----
  function EmailSelector({ stateKey, fill_type, neededLabel }) {
    const emails = availableEmails[stateKey]
    return (
      <div>
        <label className="block text-xs text-slate-500 mb-1">
          Email ที่ใช้ตัดเครดิต
          {neededLabel && <span className="text-blue-600 ml-1">({neededLabel})</span>}
        </label>
        {emails === undefined ? (
          <p className="text-xs text-slate-400 py-1">กำลังโหลด...</p>
        ) : emails.length === 0 ? (
          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ไม่มี Email ที่มีเครดิตเพียงพอ
          </p>
        ) : (
          <select
            value={selectedEmails[stateKey] || ''}
            onChange={e => setSelectedEmails(prev => ({ ...prev, [stateKey]: e.target.value }))}
            className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white"
          >
            <option value="">— เลือก Email —</option>
            {emails.map(e => (
              <option key={e.id} value={e.id}>
                {e.email} (คงเหลือ {Number(e.credits).toFixed(2)})
              </option>
            ))}
          </select>
        )}
      </div>
    )
  }

  return (
    <div className="flex gap-6">
      <div className="flex-[2] space-y-5">
        {/* Filter bar */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="ค้นหาสินค้า..."
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white flex-1"
            />
            <select
              value={selectedCat}
              onChange={e => { setSelectedCat(e.target.value); setSelectedFillType('') }}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white"
            >
              <option value="">ทุกหมวดหมู่</option>
              {categories.map(c => (
                <option key={c.id} value={String(c.id)}>{c.name}</option>
              ))}
            </select>
            {(selectedCat || selectedFillType || search) && (
              <button
                onClick={() => { setSelectedCat(''); setSelectedFillType(''); setSearch('') }}
                className="px-3 py-2 text-sm text-slate-400 hover:text-slate-600 cursor-pointer whitespace-nowrap"
              >
                ล้าง ×
              </button>
            )}
          </div>
          {/* Fill type filter */}
          {activeFillTypes.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFillTypes.map(ft => (
                <button
                  key={ft}
                  onClick={() => { setSelectedFillType(prev => prev === ft ? '' : ft); setSelectedCat('') }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${
                    selectedFillType === ft
                      ? 'bg-blue-500 text-white border-transparent'
                      : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
                  }`}
                >
                  {fillTypeLabel(ft)}
                </button>
              ))}
            </div>
          )}
        </div>

        {grouped.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">ไม่มีสินค้าในระบบ</p>
        ) : grouped.map(cat => (
          <div key={cat.id}>
            <h3 className="font-bold text-slate-700 text-base mb-3 pb-2 border-b border-slate-200">
              {cat.name}
            </h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(155px,1fr))] gap-3">
              {cat.products.map(p => (
                <div
                  key={p.id} onClick={() => addToCart(p)}
                  className="bg-white rounded-xl overflow-hidden cursor-pointer shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all"
                >
                  {p.image
                    ? <img src={p.image} alt={p.name} className="w-full h-28 object-cover" />
                    : <div className="w-full h-28 bg-slate-100 flex items-center justify-center text-4xl">🛍️</div>
                  }
                  <div className="p-3">
                    <div className="font-semibold text-sm mb-1">{p.name}</div>
                    <div className="text-blue-500 font-medium">฿{p.price}</div>
                    {p.stock === -1
                      ? <div className="text-xs text-emerald-500 mt-0.5">ไม่จำกัด</div>
                      : p.stock <= 5 && <div className="text-xs text-orange-400 mt-0.5">เหลือ {p.stock} ชิ้น</div>
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Cart */}
      <div className="flex-1 bg-white rounded-xl p-4 h-fit">
        <h2 className="font-semibold text-slate-800 mb-3">ตะกร้า</h2>
        {cart.length === 0
          ? <p className="text-slate-400 text-sm">ยังไม่มีสินค้า</p>
          : cart.map(i => (
            <div key={i.id} className="py-2.5 border-b border-slate-100">
              <div className="flex justify-between items-start mb-1.5">
                <div className="flex-1 mr-2">
                  {i.category_name && (
                    <p className="text-xs text-slate-400 mb-0.5">{i.category_name}</p>
                  )}
                  <span className="text-sm font-medium">{i.name}</span>
                </div>
                <button
                  onClick={() => removeFromCart(i.id)}
                  className="text-slate-300 hover:text-red-400 text-xl leading-none cursor-pointer"
                >×</button>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1">
                  <button onClick={() => changeQty(i.id, -1)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold cursor-pointer">−</button>
                  <span className="w-7 text-center text-sm font-medium">{i.quantity}</span>
                  <button onClick={() => changeQty(i.id, 1)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold cursor-pointer">+</button>
                </div>
                <span className="text-sm font-semibold text-slate-700">฿{i.price * i.quantity}</span>
              </div>
            </div>
          ))
        }
        {cart.length > 0 && (
          <div className="text-right font-bold text-blue-900 mt-3 text-lg">รวม ฿{total}</div>
        )}
        {cart.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-slate-400 mb-1.5">ช่องทาง</p>
            <div className="flex gap-2">
              {['หน้าบ้าน', 'หลังบ้าน'].map(ch => (
                <button
                  key={ch}
                  onClick={() => setChannel(prev => prev === ch ? null : ch)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium cursor-pointer border transition-colors ${
                    channel === ch
                      ? ch === 'หน้าบ้าน'
                        ? 'bg-emerald-500 text-white border-emerald-500'
                        : 'bg-purple-500 text-white border-purple-500'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={openPayModal}
          className="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg cursor-pointer font-medium"
        >
          ชำระเงิน
        </button>
      </div>

      {/* Payment modal */}
      {showPayModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-[400px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-blue-900 font-bold text-lg mb-5">รายละเอียดการชำระเงิน</h2>
            <div className="text-center text-2xl font-bold text-blue-900 mb-5">รวม ฿{total}</div>

            <div className="mb-4">
              <label className="block text-sm text-slate-500 mb-1.5">จำนวนเงินโอน (฿)</label>
              <input type="number" value={transferAmount}
                onChange={e => setTransferAmount(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                placeholder="0.00" />
            </div>
            <div className="mb-6">
              <label className="block text-sm text-slate-500 mb-1.5">เวลาโอน</label>
              <input type="datetime-local" value={transferTime}
                onChange={e => setTransferTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500" />
            </div>

            {/* Email-credit items */}
            {cart.some(i => usesEmailCredits(i.fill_type, emailTypes)) && (
              <div className="mb-6 space-y-3">
                {cart.filter(i => usesEmailCredits(i.fill_type, emailTypes)).map(item => {
                  const splits = splitState[item.id]
                  return (
                    <div key={item.id} className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
                      {/* Header */}
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-blue-800">
                          {item.name} × {item.quantity}
                        </p>
                        {!splits ? (
                          item.quantity > 1 && (
                            <button
                              onClick={() => activateSplit(item)}
                              className="text-xs px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg cursor-pointer"
                            >
                              Split
                            </button>
                          )
                        ) : (
                          <button
                            onClick={() => deactivateSplit(item.id)}
                            className="text-xs px-2.5 py-1 bg-slate-400 hover:bg-slate-500 text-white rounded-lg cursor-pointer"
                          >
                            รวมกลับ
                          </button>
                        )}
                      </div>

                      {splits ? (
                        /* --- Split mode --- */
                        <div className="space-y-3">
                          {splits.map((s, idx) => (
                            <div key={s.splitKey} className="bg-white rounded-lg p-3 border border-blue-100">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-slate-500 font-medium">รายการที่ {idx + 1}</span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => changeSplitQty(item.id, s.splitKey, -1)}
                                      className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs cursor-pointer"
                                    >−</button>
                                    <span className="w-6 text-center text-sm font-medium">{s.quantity}</span>
                                    <button
                                      onClick={() => changeSplitQty(item.id, s.splitKey, 1)}
                                      className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs cursor-pointer"
                                    >+</button>
                                  </div>
                                </div>
                                {splits.length > 1 && (
                                  <button
                                    onClick={() => removeSplitEntry(item.id, s.splitKey)}
                                    className="text-slate-300 hover:text-red-400 text-lg leading-none cursor-pointer"
                                  >×</button>
                                )}
                              </div>

                              {/* Razer credit input per split */}
                              {isRazerBehavior(item.fill_type, emailTypes) && (
                                <div className="mb-2">
                                  <input type="number" step="0.01" min="0"
                                    value={razerAmounts[s.splitKey] || ''}
                                    onChange={e => {
                                      const val = e.target.value
                                      setRazerAmounts(prev => ({ ...prev, [s.splitKey]: val }))
                                      setSelectedEmails(prev => ({ ...prev, [s.splitKey]: '' }))
                                      const needed = Number(val)
                                      if (needed > 0) fetchEmailsFor(s.splitKey, item.fill_type, needed)
                                      else setAvailableEmails(prev => ({ ...prev, [s.splitKey]: [] }))
                                    }}
                                    className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white"
                                    placeholder="จำนวนเครดิต"
                                  />
                                </div>
                              )}

                              {(!isRazerBehavior(item.fill_type, emailTypes) || Number(razerAmounts[s.splitKey]) > 0) && (
                                <EmailSelector
                                  stateKey={s.splitKey}
                                  fill_type={item.fill_type}
                                  neededLabel={!isRazerBehavior(item.fill_type, emailTypes) ? `${creditsNeeded(item, emailTypes, s.quantity).toFixed(2)} เครดิต` : null}
                                />
                              )}
                            </div>
                          ))}

                          {/* ปุ่มเพิ่ม split entry */}
                          <button
                            onClick={() => addSplitEntry(item)}
                            className="w-full py-2 border-2 border-dashed border-blue-300 text-blue-500 hover:bg-blue-100 rounded-lg text-sm cursor-pointer"
                          >
                            + เพิ่มรายการ
                          </button>
                        </div>
                      ) : (
                        /* --- Non-split mode --- */
                        <>
                          {isRazerBehavior(item.fill_type, emailTypes) && (
                            <div>
                              <label className="block text-xs text-slate-500 mb-1">จำนวนเครดิตที่จะตัด</label>
                              <input type="number" step="0.01" min="0"
                                value={razerAmounts[item.id] || ''}
                                onChange={e => {
                                  const val = e.target.value
                                  setRazerAmounts(prev => ({ ...prev, [item.id]: val }))
                                  setSelectedEmails(prev => ({ ...prev, [item.id]: '' }))
                                  const needed = Number(val)
                                  if (needed > 0) fetchEmailsFor(item.id, item.fill_type, needed)
                                  else setAvailableEmails(prev => ({ ...prev, [item.id]: [] }))
                                }}
                                className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white"
                                placeholder="กรอกจำนวนเครดิต"
                              />
                            </div>
                          )}
                          {(!isRazerBehavior(item.fill_type, emailTypes) || Number(razerAmounts[item.id]) > 0) && (
                            <EmailSelector
                              stateKey={item.id}
                              fill_type={item.fill_type}
                              neededLabel={!isRazerBehavior(item.fill_type, emailTypes) ? `${creditsNeeded(item, emailTypes, item.quantity).toFixed(2)} เครดิต` : null}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex gap-2.5">
              <button onClick={confirmCheckout}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg cursor-pointer font-medium">
                ยืนยันชำระเงิน
              </button>
              <button onClick={() => setShowPayModal(false)}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-3 rounded-lg cursor-pointer">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Receipt modal */}
      {receipt && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 min-w-[300px] text-center">
            <h2 className="text-green-500 font-bold text-xl mb-4">ชำระเงินสำเร็จ!</h2>
            <p className="text-slate-500 mb-2">ขอบคุณที่ใช้บริการ</p>
            <div className="text-3xl font-bold text-blue-900 my-3">฿{receipt.total}</div>
            <button onClick={() => setReceipt(null)}
              className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-lg mt-2 cursor-pointer">
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
