import { useState, useEffect } from 'react'

function formatDate(dateStr) {
  const date = new Date(dateStr.replace(' ', 'T'))
  return date.toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function OrdersPage() {
  const [orders, setOrders] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [items, setItems] = useState({})

  useEffect(() => {
    fetch('/orders').then(r => r.json()).then(setOrders)
  }, [])

  async function toggleOrder(id) {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!items[id]) {
      const res = await fetch(`/orders/${id}/items`)
      const data = await res.json()
      setItems(prev => ({ ...prev, [id]: data }))
    }
  }

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <h2 className="font-semibold text-slate-800 mb-4">ประวัติการทำรายการ</h2>
      {orders.length === 0
        ? <p className="text-slate-400 text-center py-6">ยังไม่มีรายการ</p>
        : (
          <div className="space-y-2">
            {orders.map(order => (
              <div key={order.id} className="border border-slate-200 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggleOrder(order.id)}
                  className="w-full flex justify-between items-center px-4 py-3 hover:bg-slate-50 cursor-pointer"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                      #{order.id}
                    </span>
                    <span className="text-sm text-slate-600">{formatDate(order.created_at)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-blue-900">฿{order.total}</span>
                    <span className="text-slate-300 text-xs">{expanded === order.id ? '▲' : '▼'}</span>
                  </div>
                </button>

                {expanded === order.id && (
                  <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
                    {items[order.id]
                      ? items[order.id].map(item => (
                          <div key={item.id} className="flex justify-between text-sm">
                            <span className="text-slate-600">{item.name} × {item.quantity}</span>
                            <span className="text-slate-700 font-medium">฿{item.price * item.quantity}</span>
                          </div>
                        ))
                      : <p className="text-slate-400 text-sm text-center py-1">กำลังโหลด...</p>
                    }
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      }
    </div>
  )
}
