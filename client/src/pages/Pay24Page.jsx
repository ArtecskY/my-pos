import { useState, useEffect } from 'react'

export default function Pay24Page() {
  const [config, setConfig] = useState({ apiKey: '', apiUrl: '' })
  const [balance, setBalance] = useState(null)
  const [games, setGames] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)
  const [configMsg, setConfigMsg] = useState('')
  const [editPrices, setEditPrices] = useState({})
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [search, setSearch] = useState('')

  function loadConfig() {
    fetch('/pay24/config').then(r => r.json()).then(d => setConfig({ apiKey: d.apiKey || '', apiUrl: d.apiUrl || '' }))
  }
  function loadBalance() {
    setLoadingBalance(true)
    fetch('/pay24/balance').then(r => r.json()).then(d => { setBalance(d); setLoadingBalance(false) }).catch(() => setLoadingBalance(false))
  }
  function loadGames() {
    fetch('/pay24/games').then(r => r.json()).then(setGames)
  }

  useEffect(() => { loadConfig(); loadGames() }, [])

  async function saveConfig() {
    setSavingConfig(true); setConfigMsg('')
    const res = await fetch('/pay24/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: config.apiKey, apiUrl: config.apiUrl || undefined }),
    })
    const d = await res.json()
    setConfigMsg(d.message || d.error || '')
    setSavingConfig(false)
    if (res.ok) loadBalance()
  }

  async function syncProducts() {
    setSyncing(true); setSyncMsg('')
    const res = await fetch('/pay24/sync')
    const d = await res.json()
    setSyncMsg(d.message || d.error || (d.total_games != null ? `รับมา ${d.total_games} เกม` : ''))
    setSyncing(false)
    if (res.ok) loadGames()
  }

  async function toggleGame(catId, enabled) {
    await fetch(`/pay24/games/${catId}/toggle`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    loadGames()
  }

  async function toggleItem(productId, enabled) {
    await fetch(`/pay24/items/${productId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_enabled: enabled }),
    })
    loadGames()
  }

  async function savePrice(productId) {
    const price = editPrices[productId]
    if (price === undefined || price === '') return
    await fetch(`/pay24/items/${productId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sell_price: Number(price) }),
    })
    setEditPrices(prev => { const n = { ...prev }; delete n[productId]; return n })
    loadGames()
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-(--text)">จัดการ 24Pay API</h1>
        <p className="text-sm text-(--text-muted) mt-0.5">ตั้งค่า API Key, ซิงค์สินค้า และจัดการราคาขาย</p>
      </div>

      {/* Config */}
      <div className="bg-(--surface) border border-(--border) rounded-2xl p-5 space-y-4">
        <h2 className="font-semibold text-(--text)">ตั้งค่า API</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-(--text-muted) mb-1">API Key</label>
            <input
              type="password"
              value={config.apiKey}
              onChange={e => setConfig(p => ({ ...p, apiKey: e.target.value }))}
              placeholder="X-Api-Key ของคุณ"
              className="w-full border border-(--border) rounded-lg px-3 py-2 text-sm bg-(--bg) text-(--text) focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-(--text-muted) mb-1">API URL <span className="text-xs opacity-60">(ค่าเริ่มต้น: https://x.24payseller.com)</span></label>
            <input
              type="text"
              value={config.apiUrl}
              onChange={e => setConfig(p => ({ ...p, apiUrl: e.target.value }))}
              placeholder="https://x.24payseller.com"
              className="w-full border border-(--border) rounded-lg px-3 py-2 text-sm bg-(--bg) text-(--text) focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={saveConfig}
              disabled={savingConfig}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 cursor-pointer transition-colors"
            >
              {savingConfig ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button
              onClick={loadBalance}
              disabled={loadingBalance}
              className="px-4 py-2 border border-(--border) text-(--text) rounded-lg text-sm hover:bg-(--surface2) disabled:opacity-50 cursor-pointer transition-colors"
            >
              {loadingBalance ? 'กำลังโหลด...' : 'ตรวจสอบยอด'}
            </button>
            {configMsg && <span className="text-sm text-green-600 dark:text-green-400">{configMsg}</span>}
          </div>
        </div>

        {balance && (
          <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl">
            {balance.error ? (
              <p className="text-sm text-red-600">{balance.error}</p>
            ) : (
              <div className="flex flex-wrap gap-6 text-sm">
                <div>
                  <span className="text-blue-600 dark:text-blue-400 font-medium">ยอดคงเหลือ: </span>
                  <span className="font-bold text-(--text)">{balance.balance}</span>
                </div>
                <div>
                  <span className="text-(--text-muted)">ใช้ไปแล้ว: </span>
                  <span className="text-(--text)">{balance.balance_used}</span>
                </div>
                <div>
                  <span className="text-(--text-muted)">Username: </span>
                  <span className="text-(--text)">{balance.username}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sync */}
      <div className="bg-(--surface) border border-(--border) rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-(--text)">ซิงค์สินค้าจาก API</h2>
            <p className="text-sm text-(--text-muted) mt-0.5">ดึงรายชื่อเกมและแพ็กเกจจาก API มาอัปเดตในระบบ</p>
          </div>
          <button
            onClick={syncProducts}
            disabled={syncing}
            className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {syncing ? 'กำลังซิงค์...' : 'ซิงค์สินค้า'}
          </button>
        </div>
        {syncMsg && (
          <p className={`mt-3 text-sm ${syncMsg.includes('สำเร็จ') ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
            {syncMsg}
          </p>
        )}
      </div>

      {/* Games */}
      {games.length === 0 ? (
        <div className="bg-(--surface) border border-(--border) rounded-2xl p-8 text-center text-(--text-muted) text-sm">
          ยังไม่มีสินค้า กด "ซิงค์สินค้า" เพื่อดึงข้อมูลจาก API
        </div>
      ) : (
        <>
          {/* Search + stats */}
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted) pointer-events-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="พิมพ์ค้นหา..."
                className="w-full pl-9 pr-3 py-2 border border-(--border) rounded-xl text-sm bg-(--surface) text-(--text) focus:outline-none focus:border-blue-500"
              />
            </div>
            <select
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border border-(--border) rounded-xl px-3 py-2 text-sm bg-(--surface) text-(--text) focus:outline-none focus:border-blue-500 cursor-pointer max-w-55"
            >
              <option value="">-- ทุกเกม ({games.length}) --</option>
              {games.map(g => (
                <option key={g.id} value={g.name}>{g.name}</option>
              ))}
            </select>
            {search && (
              <button onClick={() => setSearch('')} className="text-xs text-(--text-muted) hover:text-(--text) cursor-pointer shrink-0">
                ล้าง ×
              </button>
            )}
          </div>

        <div className="space-y-4">
          {games.filter(g => !search || g.name.toLowerCase().includes(search.toLowerCase())).map(game => (
            <div key={game.id} className="bg-(--surface) border border-(--border) rounded-2xl overflow-hidden">
              {/* Game header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-(--border)">
                <div>
                  <span className="font-semibold text-(--text)">{game.name}</span>
                  <span className="ml-2 text-xs text-(--text-muted) font-mono">{game.game_key}</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-sm text-(--text-muted)">{game.game_enabled ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
                  <div
                    onClick={() => toggleGame(game.id, !game.game_enabled)}
                    className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${game.game_enabled ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${game.game_enabled ? 'left-5' : 'left-1'}`} />
                  </div>
                </label>
              </div>

              {/* Items */}
              <div className="divide-y divide-(--border)">
                {game.items.map(item => (
                  <div key={item.id} className="flex items-center gap-4 px-5 py-3">
                    {/* Item toggle */}
                    <div
                      onClick={() => toggleItem(item.id, !item.item_enabled)}
                      className={`relative shrink-0 w-8 h-5 rounded-full transition-colors cursor-pointer ${item.item_enabled ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${item.item_enabled ? 'left-3.5' : 'left-0.5'}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${item.item_enabled ? 'text-(--text)' : 'text-(--text-muted) line-through'}`}>
                        {item.name}
                      </p>
                      <p className="text-xs text-(--text-muted)">ต้นทุน API: {item.api_cost} บาท</p>
                    </div>

                    {/* Price edit */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-(--text-muted)">ราคาขาย:</span>
                      <input
                        type="number"
                        step="0.01"
                        value={editPrices[item.id] !== undefined ? editPrices[item.id] : item.sell_price}
                        onChange={e => setEditPrices(p => ({ ...p, [item.id]: e.target.value }))}
                        onBlur={() => savePrice(item.id)}
                        onKeyDown={e => e.key === 'Enter' && savePrice(item.id)}
                        className="w-24 border border-(--border) rounded-lg px-2 py-1 text-sm bg-(--bg) text-(--text) focus:outline-none focus:border-blue-500"
                        placeholder="0"
                      />
                      <span className="text-xs text-(--text-muted)">฿</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  )
}
