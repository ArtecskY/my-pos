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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {products.map(p => (
            <div
              key={p.id}
              onClick={() => addToCart(p)}
              className="bg-white rounded-xl p-4 text-center cursor-pointer shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all"
            >
              <div className="font-semibold mb-1.5">{p.name}</div>
              <div className="text-blue-500 text-lg">฿{p.price}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-white rounded-xl p-4 h-fit">
        <h2 className="font-semibold text-slate-800 mb-3">ตะกร้า</h2>
        {cart.length === 0
          ? <p className="text-slate-400 text-sm">ยังไม่มีสินค้า</p>
          : cart.map(i => (
            <div key={i.id} className="flex justify-between py-2 border-b border-slate-100 text-sm">
              <span>{i.name} x{i.quantity}</span>
              <span>฿{i.price * i.quantity}</span>
            </div>
          ))
        }
        {cart.length > 0 && (
          <div className="text-right font-bold text-blue-900 mt-3">รวม ฿{total}</div>
        )}
        <button
          onClick={checkout}
          className="w-full mt-3 bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-lg cursor-pointer"
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
