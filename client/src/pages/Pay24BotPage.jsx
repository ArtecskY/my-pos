import { useState, useEffect } from 'react'

const STATUS_LABEL = {
  pending:    { label: 'รอดำเนินการ',    cls: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  processing: { label: 'กำลังดำเนินการ', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  success:    { label: 'สำเร็จ',          cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  partial:    { label: 'บางส่วนสำเร็จ',  cls: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
  failed:     { label: 'ล้มเหลว',         cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
}

const COMP_STATUS_CLS = {
  pending:    'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  success:    'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
}

const RESULT_LABEL = {
  SUCCESS_DELIVERY_CONFIRMED: 'ส่งสำเร็จ',
  ERR_UID_NOT_FOUND: 'UID ไม่พบ',
  ERR_ORDER_QUOTA_EXCEEDED: 'เกินโควต้า',
  ERR_DELIVERY_FAILED: 'ส่งไม่สำเร็จ',
  ERR_PRODUCT_OUT_OF_AVAILABILITY: 'สินค้าหมด',
  ERR_REGION_MISMATCH: 'ภูมิภาคไม่ตรง',
  ERR_ACCOUNT_LINKED_NOT_ALLOWED: 'บัญชีไม่อนุญาต',
  TIMEOUT: 'หมดเวลา',
}

export default function Pay24BotPage() {
  const [orders, setOrders] = useState([])
  const [balance, setBalance] = useState(null)
  const [retrying, setRetrying] = useState(new Set())
  const [filter, setFilter] = useState('all')

  function loadOrders() {
    fetch('/pay24/orders').then(r => r.json()).then(setOrders).catch(() => {})
  }
  function loadBalance() {
    fetch('/pay24/balance').then(r => r.json()).then(setBalance).catch(() => {})
  }

  useEffect(() => {
    loadOrders(); loadBalance()
    const t = setInterval(() => { loadOrders(); loadBalance() }, 5000)
    return () => clearInterval(t)
  }, [])

  async function retry(id) {
    setRetrying(prev => new Set([...prev, id]))
    await fetch(`/pay24/retry/${id}`, { method: 'POST' })
    loadOrders()
    setTimeout(() => setRetrying(prev => { const n = new Set(prev); n.delete(id); return n }), 2000)
  }

  const filtered = orders.filter(o => filter === 'all' || o.status === filter)
  const counts = orders.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc }, {})

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-(--text)">24Pay Bot</h1>
        <p className="text-sm text-(--text-muted) mt-0.5">ติดตาม status การเติมเงิน 24Pay</p>
      </div>

      {/* Balance */}
      {balance && !balance.error && (
        <div className="bg-(--surface) border border-(--border) rounded-2xl px-5 py-4 flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-(--text-muted)">ยอดคงเหลือ</p>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{balance.balance}</p>
          </div>
          <div>
            <p className="text-xs text-(--text-muted)">ใช้ไปแล้ว</p>
            <p className="text-lg font-semibold text-(--text)">{balance.balance_used}</p>
          </div>
          <div>
            <p className="text-xs text-(--text-muted)">Username</p>
            <p className="text-sm font-medium text-(--text)">{balance.username}</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'all',        label: 'ทั้งหมด',        count: orders.length },
          { key: 'pending',    label: 'รอ',              count: counts.pending || 0 },
          { key: 'processing', label: 'กำลังทำ',         count: counts.processing || 0 },
          { key: 'success',    label: 'สำเร็จ',           count: counts.success || 0 },
          { key: 'partial',    label: 'บางส่วนสำเร็จ',   count: counts.partial || 0 },
          { key: 'failed',     label: 'ล้มเหลว',          count: counts.failed || 0 },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer border transition-colors ${
              filter === f.key ? 'bg-blue-500 text-white border-transparent' : 'bg-(--surface) text-(--text-muted) border-(--border) hover:border-slate-400'
            }`}
          >
            {f.label} {f.count > 0 && <span className="ml-1 opacity-80">({f.count})</span>}
          </button>
        ))}
      </div>

      {/* Orders list */}
      {filtered.length === 0 ? (
        <div className="bg-(--surface) border border-(--border) rounded-2xl p-10 text-center text-(--text-muted) text-sm">
          ไม่มีรายการ
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(order => {
            const st = STATUS_LABEL[order.status] || { label: order.status, cls: 'bg-slate-100 text-slate-700' }
            const inputKeys = Object.keys(order.input || {})
            return (
              <div key={order.id} className="bg-(--surface) border border-(--border) rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-(--text) text-sm">{order.product_name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                      {order.result_code && (
                        <span className="text-xs text-(--text-muted)">
                          {RESULT_LABEL[order.result_code] || order.result_code}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--text-muted)">
                      <span>Order #{order.order_id}</span>
                      <span>{new Date(order.created_at).toLocaleString('th-TH')}</span>
                      {order.price > 0 && <span>ราคา: {order.price.toLocaleString()} ฿</span>}
                    </div>

                    {inputKeys.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {inputKeys.map(k => (
                          <span key={k} className="text-xs bg-(--surface2) border border-(--border) px-2 py-0.5 rounded-lg text-(--text)">
                            {k}: <strong>{order.input[k]}</strong>
                          </span>
                        ))}
                      </div>
                    )}

                    {order.transaction_id && (
                      <p className="mt-1 text-xs text-(--text-muted) font-mono">TxID: {order.transaction_id}</p>
                    )}

                    {order.bundle_components?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {order.bundle_components.map((c, ci) => {
                          const cs = COMP_STATUS_CLS[c.status] || 'bg-slate-100 text-slate-700'
                          return (
                            <div key={ci} className="flex items-center gap-2 text-xs">
                              <span className={`px-1.5 py-0.5 rounded font-medium ${cs}`}>{c.status}</span>
                              <span className="text-(--text)">{c.name}</span>
                              {c.transactionId && <span className="text-(--text-muted) font-mono">TxID: {c.transactionId}</span>}
                              {c.error && <span className="text-red-500">{c.error}</span>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {(order.status === 'failed' || order.status === 'partial') && (
                    <button
                      onClick={() => retry(order.id)}
                      disabled={retrying.has(order.id)}
                      className="shrink-0 px-3 py-1.5 bg-orange-500 text-white rounded-lg text-xs font-medium hover:bg-orange-600 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      {retrying.has(order.id) ? 'กำลัง Retry...' : 'Retry'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
