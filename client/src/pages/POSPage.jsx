import { useState, useEffect } from 'react'

function nowLocalTime() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function POSPage() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCat, setSelectedCat] = useState('')
  const [cart, setCart] = useState([])
  const [receipt, setReceipt] = useState(null)
  const [showPayModal, setShowPayModal] = useState(false)
  const [transferAmount, setTransferAmount] = useState('')
  const [transferTime, setTransferTime] = useState('')
  const [razerAmounts, setRazerAmounts] = useState({})     // { [productId]: creditAmount }
  const [selectedEmails, setSelectedEmails] = useState({}) // { [productId]: emailId (string) }
  const [availableEmails, setAvailableEmails] = useState({}) // { [productId]: [{id,email,credits}] }

  useEffect(() => {
    Promise.all([
      fetch('/products').then(r => r.json()),
      fetch('/categories').then(r => r.json()),
    ]).then(([p, c]) => { setProducts(p); setCategories(c) })
  }, [])

  const filtered = selectedCat
    ? products.filter(p => String(p.category_id) === selectedCat)
    : products

  function addToCart(p) {
    setCart(prev => {
      const existing = prev.find(i => i.id === p.id)
      if (existing) return prev.map(i => i.id === p.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...p, quantity: 1 }]
    })
  }

  function changeQty(id, delta) {
    setCart(prev =>
      prev
        .map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i)
        .filter(i => i.quantity > 0)
    )
  }

  function removeFromCart(id) {
    setCart(prev => prev.filter(i => i.id !== id))
  }

  function usesEmailCredits(fill_type) {
    return ['EMAIL', 'RAZER', 'OTHER_EMAIL'].includes(fill_type)
  }

  async function openPayModal() {
    if (cart.length === 0) return alert('กรุณาเลือกสินค้าก่อนครับ')
    setTransferAmount(String(total))
    setTransferTime(nowLocalTime())
    setRazerAmounts({})
    setSelectedEmails({})
    setAvailableEmails({})
    setShowPayModal(true)
    // pre-fetch สำหรับ EMAIL/OTHER_EMAIL (RAZER รอให้กรอก credit amount ก่อน)
    for (const item of cart) {
      if (['EMAIL', 'OTHER_EMAIL'].includes(item.fill_type)) {
        const needed = item.price * item.quantity
        const data = await fetch(`/emails/available?category_id=${item.category_id}&needed=${needed}`).then(r => r.json())
        setAvailableEmails(prev => ({ ...prev, [item.id]: data }))
        if (data.length === 1) setSelectedEmails(prev => ({ ...prev, [item.id]: String(data[0].id) }))
      }
    }
  }

  async function confirmCheckout() {
    for (const item of cart) {
      if (item.fill_type === 'RAZER' && (!razerAmounts[item.id] || Number(razerAmounts[item.id]) <= 0)) {
        alert(`กรุณากรอกจำนวนเครดิตที่จะตัดสำหรับ "${item.name}"`); return
      }
      if (usesEmailCredits(item.fill_type) && !selectedEmails[item.id]) {
        alert(`กรุณาเลือก Email สำหรับ "${item.name}"`); return
      }
    }
    const res = await fetch('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(i => ({
          product_id: i.id,
          quantity: i.quantity,
          ...(i.fill_type === 'RAZER' ? { credit_amount: Number(razerAmounts[i.id]) } : {}),
          ...(usesEmailCredits(i.fill_type) ? { email_id: Number(selectedEmails[i.id]) } : {}),
        })),
        transfer_amount: transferAmount ? Number(transferAmount) : null,
        transfer_time: transferTime || null,
      }),
    })
    const order = await res.json()
    if (!res.ok) { alert(order.error); return }
    setShowPayModal(false)
    setReceipt(order)
    setCart([])
    fetch('/products').then(r => r.json()).then(setProducts)
  }

  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0)

  return (
    <div className="flex gap-6">
      <div className="flex-[2]">
        {/* Category filter dropdown */}
        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-slate-500 whitespace-nowrap">หมวดหมู่:</label>
          <select
            value={selectedCat}
            onChange={e => setSelectedCat(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white min-w-[180px]"
          >
            <option value="">ทั้งหมด ({products.length} รายการ)</option>
            {categories.map(c => (
              <option key={c.id} value={String(c.id)}>
                {c.name} ({products.filter(p => p.category_id === c.id).length} รายการ)
              </option>
            ))}
          </select>
          {selectedCat && (
            <button
              onClick={() => setSelectedCat('')}
              className="text-sm text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ล้างตัวกรอง ×
            </button>
          )}
        </div>

        {/* Product grid */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {filtered.length === 0
            ? <p className="text-slate-400 text-sm col-span-full py-6 text-center">ไม่มีสินค้าในหมวดหมู่นี้</p>
            : filtered.map(p => (
              <div
                key={p.id}
                onClick={() => addToCart(p)}
                className="bg-white rounded-xl overflow-hidden cursor-pointer shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all"
              >
                {p.image
                  ? <img src={p.image} alt={p.name} className="w-full h-28 object-cover" />
                  : <div className="w-full h-28 bg-slate-100 flex items-center justify-center text-4xl">🛍️</div>
                }
                <div className="p-3">
                  {p.category_name && (
                    <div className="text-xs text-slate-400 mb-0.5">{p.category_name}</div>
                  )}
                  <div className="font-semibold text-sm mb-1">{p.name}</div>
                  <div className="text-blue-500 font-medium">฿{p.price}</div>
                </div>
              </div>
            ))
          }
        </div>
      </div>

      {/* Cart */}
      <div className="flex-1 bg-white rounded-xl p-4 h-fit">
        <h2 className="font-semibold text-slate-800 mb-3">ตะกร้า</h2>
        {cart.length === 0
          ? <p className="text-slate-400 text-sm">ยังไม่มีสินค้า</p>
          : cart.map(i => (
            <div key={i.id} className="py-2.5 border-b border-slate-100">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-sm font-medium flex-1 mr-2">{i.name}</span>
                <button
                  onClick={() => removeFromCart(i.id)}
                  className="text-slate-300 hover:text-red-400 text-xl leading-none cursor-pointer"
                >
                  ×
                </button>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => changeQty(i.id, -1)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold cursor-pointer"
                  >
                    −
                  </button>
                  <span className="w-7 text-center text-sm font-medium">{i.quantity}</span>
                  <button
                    onClick={() => changeQty(i.id, 1)}
                    className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
                <span className="text-sm font-semibold text-slate-700">฿{i.price * i.quantity}</span>
              </div>
            </div>
          ))
        }
        {cart.length > 0 && (
          <div className="text-right font-bold text-blue-900 mt-3 text-lg">รวม ฿{total}</div>
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
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[360px]">
            <h2 className="text-blue-900 font-bold text-lg mb-5">รายละเอียดการชำระเงิน</h2>
            <div className="text-center text-2xl font-bold text-blue-900 mb-5">รวม ฿{total}</div>
            <div className="mb-4">
              <label className="block text-sm text-slate-500 mb-1.5">จำนวนเงินโอน (฿)</label>
              <input
                type="number"
                value={transferAmount}
                onChange={e => setTransferAmount(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
                placeholder="0.00"
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm text-slate-500 mb-1.5">เวลาโอน</label>
              <input
                type="datetime-local"
                value={transferTime}
                onChange={e => setTransferTime(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            {/* Email selection + RAZER credit inputs */}
            {cart.some(i => usesEmailCredits(i.fill_type)) && (
              <div className="mb-6 space-y-3">
                {cart.filter(i => usesEmailCredits(i.fill_type)).map(item => (
                  <div key={item.id} className="border border-blue-200 rounded-xl p-4 bg-blue-50">
                    <p className="text-sm font-semibold text-blue-800 mb-3">
                      {item.name} × {item.quantity}
                    </p>

                    {/* RAZER: กรอก credit amount ก่อน */}
                    {item.fill_type === 'RAZER' && (
                      <div className="mb-3">
                        <label className="block text-xs text-slate-500 mb-1">จำนวนเครดิตที่จะตัด</label>
                        <input
                          type="number" step="0.01" min="0"
                          value={razerAmounts[item.id] || ''}
                          onChange={e => {
                            const val = e.target.value
                            setRazerAmounts(prev => ({ ...prev, [item.id]: val }))
                            setSelectedEmails(prev => ({ ...prev, [item.id]: '' }))
                            const needed = Number(val)
                            if (needed > 0 && item.category_id) {
                              fetch(`/emails/available?category_id=${item.category_id}&needed=${needed}`)
                                .then(r => r.json())
                                .then(data => {
                                  setAvailableEmails(prev => ({ ...prev, [item.id]: data }))
                                  if (data.length === 1) setSelectedEmails(prev => ({ ...prev, [item.id]: String(data[0].id) }))
                                })
                            } else {
                              setAvailableEmails(prev => ({ ...prev, [item.id]: [] }))
                            }
                          }}
                          className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white"
                          placeholder="กรอกจำนวนเครดิต"
                        />
                      </div>
                    )}

                    {/* Email selector */}
                    {(item.fill_type !== 'RAZER' || Number(razerAmounts[item.id]) > 0) && (
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">
                          Email ที่ใช้ตัดเครดิต
                          {item.fill_type !== 'RAZER' && (
                            <span className="text-blue-600 ml-1">(ต้องการ {(item.price * item.quantity).toFixed(2)} เครดิต)</span>
                          )}
                        </label>
                        {availableEmails[item.id] === undefined ? (
                          <p className="text-xs text-slate-400 py-1">กำลังโหลด...</p>
                        ) : availableEmails[item.id].length === 0 ? (
                          <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            ไม่มี Email ที่มีเครดิตเพียงพอ
                          </p>
                        ) : (
                          <select
                            value={selectedEmails[item.id] || ''}
                            onChange={e => setSelectedEmails(prev => ({ ...prev, [item.id]: e.target.value }))}
                            className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 bg-white"
                          >
                            <option value="">— เลือก Email —</option>
                            {availableEmails[item.id].map(e => (
                              <option key={e.id} value={e.id}>
                                {e.email} (คงเหลือ {Number(e.credits).toFixed(2)})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2.5">
              <button
                onClick={confirmCheckout}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg cursor-pointer font-medium"
              >
                ยืนยันชำระเงิน
              </button>
              <button
                onClick={() => setShowPayModal(false)}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-3 rounded-lg cursor-pointer"
              >
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
            <button
              onClick={() => setReceipt(null)}
              className="w-full bg-green-500 hover:bg-green-600 text-white py-3 rounded-lg mt-2 cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
