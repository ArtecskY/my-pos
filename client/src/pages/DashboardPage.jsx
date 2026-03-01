import { useState, useEffect, useMemo } from 'react'

function getDateKey(dateStr) {
  if (!dateStr) return 'unknown'
  return dateStr.slice(0, 10)
}

function formatThaiDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr.replace(' ', 'T'))
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatThaiMonthYear(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })
}

function StatCard({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 border-blue-100 text-blue-600',
    green: 'bg-emerald-50 border-emerald-100 text-emerald-600',
    purple: 'bg-purple-50 border-purple-100 text-purple-600',
    amber: 'bg-amber-50 border-amber-100 text-amber-600',
  }
  return (
    <div className={`rounded-xl border px-5 py-4 ${colors[color]}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const [orderItems, setOrderItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/order-items')
      .then(r => r.json())
      .then(data => { setOrderItems(data); setLoading(false) })
  }, [])

  const todayKey = new Date().toISOString().slice(0, 10)
  const thisMonthKey = new Date().toISOString().slice(0, 7) // YYYY-MM

  // สรุปยอดจากข้อมูล order-items
  const stats = useMemo(() => {
    // ใช้ order_id เพื่อไม่นับซ้ำ (หลายรายการต่อ order)
    const orderMap = new Map()
    for (const item of orderItems) {
      if (!orderMap.has(item.order_id)) {
        const dateKey = getDateKey(item.transfer_time || item.created_at)
        orderMap.set(item.order_id, {
          order_id: item.order_id,
          dateKey,
          monthKey: dateKey.slice(0, 7),
          transfer_amount: Number(item.transfer_amount) || 0,
          category_name: item.category_name,
          items: [],
        })
      }
      orderMap.get(item.order_id).items.push(item)
    }
    const orders = Array.from(orderMap.values())

    const todayOrders = orders.filter(o => o.dateKey === todayKey)
    const monthOrders = orders.filter(o => o.monthKey === thisMonthKey)

    const todayRevenue = todayOrders.reduce((s, o) => s + o.transfer_amount, 0)
    const monthRevenue = monthOrders.reduce((s, o) => s + o.transfer_amount, 0)
    const totalRevenue = orders.reduce((s, o) => s + o.transfer_amount, 0)

    // ยอดขายแยกตามเกม (category)
    const gameMap = new Map()
    for (const item of orderItems) {
      const cat = item.category_name || 'ไม่ระบุเกม'
      if (!gameMap.has(cat)) gameMap.set(cat, { name: cat, revenue: 0, orders: new Set() })
      const g = gameMap.get(cat)
      g.orders.add(item.order_id)
    }
    // เพิ่มยอดโอนต่อ order ให้แต่ละเกม (อิงจาก category ของ order)
    for (const order of orders) {
      const key = order.items[0]?.category_name || 'ไม่ระบุเกม'
      if (gameMap.has(key)) {
        gameMap.get(key).revenue += order.transfer_amount
      }
    }
    const gameStats = Array.from(gameMap.values())
      .map(g => ({ ...g, orders: g.orders.size }))
      .sort((a, b) => b.revenue - a.revenue)

    // ยอดขายรายวัน 30 วันล่าสุด
    const dateRevMap = new Map()
    for (const order of orders) {
      const dk = order.dateKey
      if (!dateRevMap.has(dk)) dateRevMap.set(dk, { dateKey: dk, revenue: 0, count: 0 })
      const dr = dateRevMap.get(dk)
      dr.revenue += order.transfer_amount
      dr.count++
    }
    const dailyStats = Array.from(dateRevMap.values())
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .slice(-30)

    return {
      todayOrders: todayOrders.length,
      todayRevenue,
      monthOrders: monthOrders.length,
      monthRevenue,
      totalOrders: orders.length,
      totalRevenue,
      gameStats,
      dailyStats,
    }
  }, [orderItems, todayKey, thisMonthKey])

  const maxDailyRevenue = Math.max(...stats.dailyStats.map(d => d.revenue), 1)

  if (loading) {
    return <div className="flex justify-center py-20 text-slate-400">กำลังโหลด...</div>
  }

  return (
    <div className="space-y-6">
      <h2 className="font-semibold text-slate-800 text-lg">สรุปยอดขาย</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard
          label="ยอดโอนวันนี้"
          value={`฿${stats.todayRevenue.toLocaleString()}`}
          sub={`${stats.todayOrders} รายการ`}
          color="green"
        />
        <StatCard
          label={`ยอดโอนเดือนนี้ (${formatThaiMonthYear(thisMonthKey + '-01')})`}
          value={`฿${stats.monthRevenue.toLocaleString()}`}
          sub={`${stats.monthOrders} รายการ`}
          color="blue"
        />
        <StatCard
          label="ยอดโอนทั้งหมด"
          value={`฿${stats.totalRevenue.toLocaleString()}`}
          sub={`${stats.totalOrders} รายการรวม`}
          color="purple"
        />
      </div>

      {/* Daily bar chart */}
      {stats.dailyStats.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">ยอดโอนรายวัน (30 วันล่าสุด)</p>
          <div className="flex items-end gap-1 h-32 overflow-x-auto pb-2">
            {stats.dailyStats.map(d => {
              const heightPct = Math.round((d.revenue / maxDailyRevenue) * 100)
              const isToday = d.dateKey === todayKey
              return (
                <div key={d.dateKey} className="flex flex-col items-center gap-1 min-w-[24px] group relative">
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 pointer-events-none opacity-0 group-hover:opacity-100 whitespace-nowrap z-10 transition-opacity">
                    {formatThaiDate(d.dateKey + ' 00:00:00')}
                    <br />฿{d.revenue.toLocaleString()} ({d.count} รายการ)
                  </div>
                  <div
                    className={`w-full rounded-t-sm transition-all ${isToday ? 'bg-emerald-500' : 'bg-blue-400'}`}
                    style={{ height: `${Math.max(heightPct, 2)}%` }}
                  />
                  <span className="text-[9px] text-slate-400 truncate w-full text-center leading-tight">
                    {d.dateKey.slice(8)}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-3 mt-2 text-xs text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-400 inline-block" />วันอื่น</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500 inline-block" />วันนี้</span>
          </div>
        </div>
      )}

      {/* Game breakdown */}
      {stats.gameStats.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-sm font-semibold text-slate-700 mb-4">ยอดขายแยกตามเกม</p>
          <div className="space-y-2.5">
            {stats.gameStats.map((g, i) => {
              const pct = Math.round((g.revenue / (stats.totalRevenue || 1)) * 100)
              return (
                <div key={g.name} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-5 text-right font-mono">{i + 1}</span>
                  <span className="text-sm text-slate-700 w-32 truncate">{g.name}</span>
                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-400 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 w-28 text-right">
                    ฿{g.revenue.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-400 w-12 text-right">{g.orders} ออเดอร์</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {stats.totalOrders === 0 && (
        <div className="bg-white rounded-xl p-12 shadow-sm text-center text-slate-400">
          ยังไม่มีข้อมูลการขาย
        </div>
      )}
    </div>
  )
}
