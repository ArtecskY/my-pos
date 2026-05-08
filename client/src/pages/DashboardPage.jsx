import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts'
import {
  TrendingUp, ShoppingBag, Banknote, Gamepad2, BarChart2
} from 'lucide-react'
import StatCard from '../components/ui/StatCard'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card'
import { StatCardSkeleton, ChartSkeleton, Skeleton } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'

function getDateKey(s) { return s ? s.slice(0, 10) : 'unknown' }

function formatShortDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function formatThaiDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr.replace(' ', 'T')).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric'
  })
}

function formatTime(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('T') || dateStr.includes('Z') ? '' : 'Z'))
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

const FILL_BADGE = {
  'RAZER_AUTO': { label: 'Razer Auto', cls: 'bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400' },
  'RAZER':      { label: 'Razer',      cls: 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400' },
  'EMAIL':      { label: 'Apple ID',   cls: 'bg-brand/10 text-brand' },
  'UID':        { label: 'UID',        cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
}

function FillBadge({ fill_type }) {
  const cfg = FILL_BADGE[fill_type]
  if (!cfg) return <span className="text-xs text-[var(--text-muted)]">{fill_type || '—'}</span>
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2 shadow-lg text-xs">
      <p className="text-[var(--text-muted)] mb-1">{label}</p>
      <p className="font-bold text-[var(--text)]">฿{Number(payload[0]?.value || 0).toLocaleString()}</p>
      {payload[1] && <p className="text-[var(--text-muted)]">{payload[1]?.value} ออเดอร์</p>}
    </div>
  )
}

export default function DashboardPage() {
  const [orderItems, setOrderItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [chartPeriod, setChartPeriod] = useState('7')

  useEffect(() => {
    fetch('/order-items')
      .then(r => r.json())
      .then(data => { setOrderItems(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const todayKey = new Date().toISOString().slice(0, 10)
  const thisMonthKey = new Date().toISOString().slice(0, 7)

  const stats = useMemo(() => {
    const orderMap = new Map()
    for (const item of orderItems) {
      if (!orderMap.has(item.order_id)) {
        const dateKey = getDateKey(item.transfer_time || item.created_at)
        orderMap.set(item.order_id, {
          order_id: item.order_id, dateKey,
          monthKey: dateKey.slice(0, 7),
          transfer_amount: Number(item.transfer_amount) || 0,
          channel: item.channel || null,
          fill_type: item.fill_type || null,
          transfer_time: item.transfer_time || item.created_at,
          items: [],
        })
      }
      orderMap.get(item.order_id).items.push(item)
    }
    const orders = Array.from(orderMap.values())
    const todayOrders  = orders.filter(o => o.dateKey === todayKey)
    const monthOrders  = orders.filter(o => o.monthKey === thisMonthKey)

    const todayRevenue = todayOrders.reduce((s, o) => s + o.transfer_amount, 0)
    const monthRevenue = monthOrders.reduce((s, o) => s + o.transfer_amount, 0)

    // game stats
    const gameMap = new Map()
    for (const order of orders) {
      const cat = order.items[0]?.category_name || 'ไม่ระบุเกม'
      if (!gameMap.has(cat)) gameMap.set(cat, { name: cat, revenue: 0, count: 0 })
      const g = gameMap.get(cat)
      g.revenue += order.transfer_amount
      g.count++
    }
    const gameStats = Array.from(gameMap.values()).sort((a, b) => b.revenue - a.revenue)
    const topGame = gameStats[0]?.name || '—'

    // daily stats
    const dateRevMap = new Map()
    for (const order of orders) {
      if (!dateRevMap.has(order.dateKey)) dateRevMap.set(order.dateKey, { date: order.dateKey, revenue: 0, count: 0 })
      const d = dateRevMap.get(order.dateKey)
      d.revenue += order.transfer_amount
      d.count++
    }
    const allDaily = Array.from(dateRevMap.values()).sort((a, b) => a.date.localeCompare(b.date))
    const daily7  = allDaily.slice(-7)
    const daily30 = allDaily.slice(-30)

    // recent orders (latest 8)
    const recent = orders
      .sort((a, b) => (b.transfer_time || '').localeCompare(a.transfer_time || ''))
      .slice(0, 8)

    return {
      todayOrders: todayOrders.length, todayRevenue,
      monthOrders: monthOrders.length, monthRevenue,
      totalOrders: orders.length,
      topGame, gameStats,
      daily7, daily30, recent,
    }
  }, [orderItems, todayKey, thisMonthKey])

  const chartData = chartPeriod === '7' ? stats.daily7 : stats.daily30
  const chartDataFormatted = chartData.map(d => ({
    ...d, label: formatShortDate(d.date)
  }))

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-6 w-48 mb-1" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
        <ChartSkeleton />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-[var(--text)]">Business Performance</h2>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">ติดตามยอดขาย, ออเดอร์, และข้อมูลสำคัญในมุมมองเดียว</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="ยอดโอนวันนี้"
          value={`฿${stats.todayRevenue.toLocaleString()}`}
          sub={`${stats.todayOrders} รายการวันนี้`}
          icon={Banknote}
          color="green"
        />
        <StatCard
          label="ยอดโอนเดือนนี้"
          value={`฿${stats.monthRevenue.toLocaleString()}`}
          sub={`${stats.monthOrders} รายการ`}
          icon={TrendingUp}
          color="brand"
        />
        <StatCard
          label="ออเดอร์ทั้งหมด"
          value={stats.totalOrders.toLocaleString()}
          sub="รายการสะสม"
          icon={ShoppingBag}
          color="purple"
        />
        <StatCard
          label="เกมยอดนิยม"
          value={stats.topGame}
          sub={`${stats.gameStats[0]?.count || 0} ออเดอร์`}
          icon={Gamepad2}
          color="amber"
        />
      </div>

      {/* Chart + Game breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Area Chart */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>ยอดโอนรายวัน</CardTitle>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  ยอดโอนรวมแต่ละวัน
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 bg-[var(--surface2)] rounded-xl border border-[var(--border)]">
                {['7', '30'].map(p => (
                  <button
                    key={p}
                    onClick={() => setChartPeriod(p)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      chartPeriod === p
                        ? 'bg-brand text-white shadow-sm'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {p} วัน
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {chartDataFormatted.length === 0 ? (
              <EmptyState title="ยังไม่มีข้อมูล" description="ข้อมูลยอดขายจะแสดงเมื่อมีออเดอร์" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartDataFormatted} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="brandGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#02abff" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#02abff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false}
                    tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone" dataKey="revenue"
                    stroke="#02abff" strokeWidth={2.5}
                    fill="url(#brandGrad)" dot={false}
                    activeDot={{ r: 5, fill: '#02abff', strokeWidth: 2, stroke: '#fff' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Game breakdown */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-brand/10 flex items-center justify-center">
                <BarChart2 size={14} className="text-brand" />
              </div>
              <CardTitle>ยอดขายตามเกม</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {stats.gameStats.length === 0 ? (
              <EmptyState title="ยังไม่มีข้อมูล" />
            ) : (
              <div className="space-y-3">
                {stats.gameStats.slice(0, 6).map((g, i) => {
                  const total = stats.gameStats.reduce((s, x) => s + x.revenue, 0)
                  const pct = total ? Math.round((g.revenue / total) * 100) : 0
                  return (
                    <div key={g.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--text-muted)] w-4">{i + 1}</span>
                          <span className="text-xs font-medium text-[var(--text)] truncate max-w-[110px]">{g.name}</span>
                        </div>
                        <span className="text-xs font-semibold text-[var(--text)]">฿{g.revenue.toLocaleString()}</span>
                      </div>
                      <div className="h-1.5 bg-[var(--surface2)] rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: `hsl(${200 - i * 20}, 80%, 55%)` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">ออเดอร์ล่าสุด</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0 px-0">
          {stats.recent.length === 0 ? (
            <EmptyState title="ยังไม่มีออเดอร์" description="ออเดอร์ที่บันทึกจะแสดงที่นี่" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">เกม</th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">ช่องทาง</th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">ยอดโอน</th>
                    <th className="px-5 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">ประเภท</th>
                    <th className="px-5 py-2.5 text-right text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide">เวลา</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {stats.recent.map(order => (
                    <tr key={order.order_id} className="hover:bg-[var(--surface2)] transition-colors">
                      <td className="px-5 py-3">
                        <span className="text-sm font-medium text-[var(--text)]">
                          {order.items[0]?.category_name || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-xs text-[var(--text-muted)]">{order.channel || '—'}</span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-sm font-semibold text-emerald-500">
                          {order.transfer_amount ? `฿${order.transfer_amount.toLocaleString()}` : '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <FillBadge fill_type={order.items[0]?.fill_type} />
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-xs text-[var(--text-muted)]">{formatTime(order.transfer_time)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
