import { useState, useEffect } from 'react'

export default function POSPage() {
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [receipt, setReceipt] = useState(null)

  useEffect(() => {
    fetch('/products').then(r => r.json()).then(setProducts)
  }, [])

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

  async function checkout() {
    if (cart.length === 0) return alert('กรุณาเลือกสินค้าก่อนครับ')
    const res = await fetch('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart.map(i => ({ product_id: i.id, quantity: i.quantity })) }),
    })
    const order = await res.json()
    setReceipt(order)
    setCart([])
  }

  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0)

  return (
    <div className="flex gap-6">
      <div className="flex-[2]">
        <h2 className="text-slate-500 font-medium mb-3">สินค้า</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {products.map(p => (
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
                <div className="font-semibold text-sm mb-1">{p.name}</div>
                <div className="text-blue-500 font-medium">฿{p.price}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

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
          onClick={checkout}
          className="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg cursor-pointer font-medium"
        >
          ชำระเงิน
        </button>
      </div>

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
