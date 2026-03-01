import { useState, useEffect, useRef, useMemo } from 'react'

const TYPE_CONFIG = {
  'UID':         { label: 'UID',           cls: 'bg-slate-200 text-slate-600' },
  'EMAIL':       { label: 'Apple ID',        cls: 'bg-blue-100 text-blue-700' },
  'RAZER':       { label: 'Razer',          cls: 'bg-green-100 text-green-700' },
  'OTHER_UID':   { label: 'อื่นๆ · UID',   cls: 'bg-orange-100 text-orange-700' },
  'OTHER_EMAIL': { label: 'อื่นๆ · Email', cls: 'bg-purple-100 text-purple-700' },
  'ID_PASS':     { label: 'ID-PASS',        cls: 'bg-yellow-100 text-yellow-700' },
}

const TYPE_BUTTONS = [
  { key: 'UID',     label: 'เติมผ่าน UID',      activeCls: 'bg-slate-600 text-white border-transparent' },
  { key: 'EMAIL',   label: 'เติมผ่าน Email',     activeCls: 'bg-blue-500 text-white border-transparent' },
  { key: 'RAZER',   label: 'เติมผ่าน Razer',     activeCls: 'bg-green-500 text-white border-transparent' },
  { key: 'OTHER',   label: 'อื่นๆ',               activeCls: 'bg-orange-500 text-white border-transparent' },
  { key: 'ID_PASS', label: 'ID-PASS (Stock 77)', activeCls: 'bg-yellow-500 text-white border-transparent' },
]

function usesEmailCredits(fill_type) {
  return ['EMAIL', 'RAZER', 'OTHER_EMAIL'].includes(fill_type)
}

function isIDPass(fill_type) {
  return fill_type === 'ID_PASS'
}

function computedFillType(typeKey, otherStock) {
  if (typeKey === 'OTHER') return otherStock === 'EMAIL' ? 'OTHER_EMAIL' : 'OTHER_UID'
  return typeKey
}

function TypeButtons({ typeKey, onTypeKey, otherStock, onOtherStock }) {
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {TYPE_BUTTONS.map(({ key, label, activeCls }) => (
          <button
            key={key}
            onClick={() => onTypeKey(key)}
            className={`px-3 py-1.5 rounded-lg text-sm cursor-pointer border transition-colors ${typeKey === key ? activeCls : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {typeKey === 'OTHER' && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-slate-400">ตัด Stock แบบ:</span>
          {[{ v: 'UID', l: 'UID (stock ปกติ)' }, { v: 'EMAIL', l: 'Email credits' }].map(({ v, l }) => (
            <button
              key={v}
              onClick={() => onOtherStock(v)}
              className={`px-2.5 py-1 rounded text-xs cursor-pointer border transition-colors ${otherStock === v ? 'bg-orange-500 text-white border-transparent' : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

export default function ManagePage() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])

  // Add game modal
  const [showAddGame, setShowAddGame] = useState(false)
  const [newGameName, setNewGameName] = useState('')
  const [newGameTypeKey, setNewGameTypeKey] = useState('UID')
  const [newGameOtherStock, setNewGameOtherStock] = useState('UID')
  const [addGameError, setAddGameError] = useState('')

  // Edit game modal
  const [editGameModal, setEditGameModal] = useState(null)
  const [editGameTypeKey, setEditGameTypeKey] = useState('UID')
  const [editGameOtherStock, setEditGameOtherStock] = useState('UID')

  // Inline add product per card
  const [expandedCard, setExpandedCard] = useState(null)
  const [addForms, setAddForms] = useState({})
  const [addFormErrors, setAddFormErrors] = useState({})
  const addImageRefs = useRef({})

  // Inline add promo product per card
  const [promoExpandedCard, setPromoExpandedCard] = useState(null)
  const [promoForms, setPromoForms] = useState({}) // { [catId]: { name, price, components: [{productId, qty}], pendingId, pendingQty, error } }

  // Edit product modal
  const [editModal, setEditModal] = useState(null)
  const [editPreview, setEditPreview] = useState(null)
  const editImageRef = useRef(null)

  // ID-PASS Dashboard
  const [dashboardCat, setDashboardCat] = useState(null)
  const [dashboardData, setDashboardData] = useState({ products: [], uniqueCosts: [] })
  const [dashEditLot, setDashEditLot] = useState(null)   // { id, cost, stock }
  const [dashEditUsd, setDashEditUsd] = useState(null)   // { productId, value }
  const [dashNewLot, setDashNewLot] = useState(null)     // { productId, cost, stock }

  async function loadAll() {
    const [p, c] = await Promise.all([
      fetch('/products').then(r => r.json()),
      fetch('/categories').then(r => r.json()),
    ])
    setProducts(p)
    setCategories(c)
  }

  useEffect(() => { loadAll() }, [])

  async function addGame() {
    setAddGameError('')
    if (!newGameName.trim()) { setAddGameError('กรุณากรอกชื่อเกม'); return }
    const fill_type = computedFillType(newGameTypeKey, newGameOtherStock)
    const res = await fetch('/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newGameName.trim(), fill_type }),
    })
    const data = await res.json()
    if (!res.ok) { setAddGameError(data.error); return }
    setShowAddGame(false)
    setNewGameName('')
    setNewGameTypeKey('UID')
    setNewGameOtherStock('UID')
    loadAll()
  }

  function openEditGame(cat) {
    setEditGameModal({ ...cat })
    if (cat.fill_type === 'OTHER_UID') {
      setEditGameTypeKey('OTHER'); setEditGameOtherStock('UID')
    } else if (cat.fill_type === 'OTHER_EMAIL') {
      setEditGameTypeKey('OTHER'); setEditGameOtherStock('EMAIL')
    } else {
      setEditGameTypeKey(cat.fill_type || 'UID'); setEditGameOtherStock('UID')
    }
  }

  async function saveEditGame() {
    if (!editGameModal?.name?.trim()) return
    const fill_type = computedFillType(editGameTypeKey, editGameOtherStock)
    await fetch(`/categories/${editGameModal.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editGameModal.name.trim(), fill_type }),
    })
    setEditGameModal(null)
    loadAll()
  }

  async function deleteGame(id) {
    if (!confirm('ลบเกมนี้? สินค้าในเกมนี้จะไม่มีหมวดหมู่')) return
    await fetch(`/categories/${id}`, { method: 'DELETE' })
    loadAll()
  }

  function getAddForm(catId) {
    return addForms[catId] || { name: '', price: '', stock: '', imagePreview: null, price_usd: '', cost: '' }
  }

  function setAddForm(catId, updates) {
    setAddForms(prev => ({
      ...prev,
      [catId]: { ...getAddForm(catId), ...updates },
    }))
  }

  async function addProductToGame(cat) {
    const form = getAddForm(cat.id)
    const err = msg => setAddFormErrors(prev => ({ ...prev, [cat.id]: msg }))
    setAddFormErrors(prev => ({ ...prev, [cat.id]: '' }))

    if (!form.name.trim() || form.price === '') { err('กรุณากรอกชื่อและราคา'); return }
    if (Number(form.price) < 0) { err('ราคาต้องไม่ติดลบ'); return }

    const isIDPassCat = isIDPass(cat.fill_type)
    const needsStock = !usesEmailCredits(cat.fill_type) && !isIDPassCat
    if (needsStock && form.stock === '') { err('กรุณากรอกสต็อก'); return }
    if (needsStock && Number(form.stock) < 0) { err('สต็อกต้องไม่ติดลบ'); return }

    const res = await fetch('/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        price: Number(form.price),
        stock: needsStock ? Number(form.stock) : 0,
        category_id: cat.id,
        price_usd: isIDPassCat && form.price_usd !== '' ? Number(form.price_usd) : null,
      }),
    })
    const data = await res.json()
    if (!res.ok) { err(data.error || 'เกิดข้อผิดพลาด'); return }

    // ID_PASS: สร้าง first lot ถ้ากรอก stock และ cost
    if (isIDPassCat && data.id && form.stock !== '' && form.cost !== '') {
      await fetch('/product-lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: data.id, cost: Number(form.cost), stock: Number(form.stock) }),
      })
    }

    const imageFile = addImageRefs.current[cat.id]?.files[0]
    if (imageFile && data.id) {
      const formData = new FormData()
      formData.append('image', imageFile)
      await fetch(`/products/${data.id}/image`, { method: 'POST', body: formData })
      if (addImageRefs.current[cat.id]) addImageRefs.current[cat.id].value = ''
    }

    setAddForms(prev => ({ ...prev, [cat.id]: { name: '', price: '', stock: '', imagePreview: null, price_usd: '', cost: '' } }))
    loadAll()
  }

  async function deleteProduct(id) {
    if (!confirm('ต้องการลบสินค้านี้?')) return
    await fetch(`/products/${id}`, { method: 'DELETE' })
    loadAll()
  }

  async function saveEdit() {
    const { id, name, price, stock, category_id, fill_type, price_usd } = editModal
    if (!name || price === '') return

    const needsStock = !usesEmailCredits(fill_type) && !isIDPass(fill_type)
    await fetch(`/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        price: Number(price),
        stock: needsStock ? Number(stock) : 0,
        category_id: category_id || null,
        price_usd: isIDPass(fill_type) ? (price_usd !== '' && price_usd != null ? Number(price_usd) : null) : null,
      }),
    })

    const imageFile = editImageRef.current?.files[0]
    if (imageFile) {
      const formData = new FormData()
      formData.append('image', imageFile)
      await fetch(`/products/${id}/image`, { method: 'POST', body: formData })
    }

    setEditModal(null)
    setEditPreview(null)
    loadAll()
  }

  async function openDashboard(cat) {
    setDashboardCat(cat)
    setDashEditLot(null); setDashEditUsd(null); setDashNewLot(null)
    const data = await fetch(`/id-pass-dashboard/${cat.id}`).then(r => r.json())
    setDashboardData(data)
  }

  async function reloadDashboard(catId) {
    const data = await fetch(`/id-pass-dashboard/${catId || dashboardCat?.id}`).then(r => r.json())
    setDashboardData(data)
  }

  async function saveLotEdit() {
    await fetch(`/product-lots/${dashEditLot.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cost: Number(dashEditLot.cost), stock: Number(dashEditLot.stock) }),
    })
    setDashEditLot(null)
    await reloadDashboard(); loadAll()
  }

  async function deleteLot(lotId) {
    if (!confirm('ลบ Lot นี้?')) return
    await fetch(`/product-lots/${lotId}`, { method: 'DELETE' })
    await reloadDashboard(); loadAll()
  }

  async function saveNewLot() {
    await fetch('/product-lots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: dashNewLot.productId, cost: Number(dashNewLot.cost), stock: Number(dashNewLot.stock) }),
    })
    setDashNewLot(null)
    await reloadDashboard(); loadAll()
  }

  async function savePriceUsd() {
    await fetch(`/products/${dashEditUsd.productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_usd: dashEditUsd.value === '' ? null : Number(dashEditUsd.value) }),
    })
    setDashEditUsd(null)
    await reloadDashboard(); loadAll()
  }

  function getPromoForm(catId) {
    return promoForms[catId] || { name: '', price: '', components: [], pendingId: '', pendingQty: '1', error: '' }
  }

  function setPromoForm(catId, updates) {
    setPromoForms(prev => ({ ...prev, [catId]: { ...getPromoForm(catId), ...updates } }))
  }

  function addComponent(catId, catProducts) {
    const form = getPromoForm(catId)
    const pid = Number(form.pendingId)
    const qty = Number(form.pendingQty)
    if (!pid) { setPromoForm(catId, { error: 'กรุณาเลือกสินค้า' }); return }
    if (!qty || qty < 1) { setPromoForm(catId, { error: 'จำนวนต้องมากกว่า 0' }); return }
    if (form.components.find(c => c.productId === pid)) { setPromoForm(catId, { error: 'สินค้านี้มีอยู่แล้ว' }); return }
    const product = catProducts.find(p => p.id === pid)
    const newComponents = [...form.components, { productId: pid, qty, name: product?.name || '' }]
    setPromoForm(catId, { components: newComponents, pendingId: '', pendingQty: '1', error: '' })
  }

  function removeComponent(catId, productId) {
    setPromoForm(catId, { components: getPromoForm(catId).components.filter(c => c.productId !== productId) })
  }

  async function addBundleProduct(cat) {
    const form = getPromoForm(cat.id)
    if (!form.name.trim()) { setPromoForm(cat.id, { error: 'กรุณากรอกชื่อแพ็ก' }); return }
    if (form.price === '') { setPromoForm(cat.id, { error: 'กรุณากรอกราคา' }); return }
    if (form.components.length === 0) { setPromoForm(cat.id, { error: 'กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ' }); return }

    const res = await fetch('/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.trim(),
        price: Number(form.price),
        stock: 0,
        category_id: cat.id,
        is_bundle: 1,
      }),
    })
    const data = await res.json()
    if (!res.ok) { setPromoForm(cat.id, { error: data.error || 'เกิดข้อผิดพลาด' }); return }

    await fetch(`/products/${data.id}/bundle-components`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ components: form.components.map(c => ({ product_id: c.productId, quantity: c.qty })) }),
    })

    setPromoExpandedCard(null)
    setPromoForms(prev => ({ ...prev, [cat.id]: undefined }))
    loadAll()
  }

  const inputCls = 'border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500'

  const grouped = categories.map(c => ({
    ...c,
    items: products.filter(p => p.category_id === c.id),
  }))

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex justify-end">
        <button
          onClick={() => { setShowAddGame(true); setAddGameError(''); setNewGameName(''); setNewGameTypeKey('UID'); setNewGameOtherStock('UID') }}
          className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm cursor-pointer font-medium"
        >
          + เพิ่มเกมใหม่
        </button>
      </div>

      {/* Game cards */}
      {grouped.length === 0
        ? (
          <div className="bg-white rounded-xl p-14 text-center shadow-sm">
            <p className="text-slate-400 text-lg mb-1">ยังไม่มีเกม</p>
            <p className="text-slate-300 text-sm">กดปุ่ม "เพิ่มเกมใหม่" เพื่อเริ่มต้น</p>
          </div>
        )
        : grouped.map(cat => {
          const fillConfig = TYPE_CONFIG[cat.fill_type] || TYPE_CONFIG['UID']
          const needsStock = !usesEmailCredits(cat.fill_type)
          const form = getAddForm(cat.id)
          const isExpanded = expandedCard === cat.id

          const promoForm = getPromoForm(cat.id)
          const nonBundleItems = cat.items.filter(p => !p.is_bundle)
          const isPromoExpanded = promoExpandedCard === cat.id

          return (
            <div key={cat.id} className="bg-white rounded-xl shadow-sm overflow-hidden">
              {/* Card header */}
              <div className="flex items-center gap-3 px-6 py-4 bg-slate-50 border-b border-slate-100">
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-slate-800 text-base">{cat.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${fillConfig.cls}`}>
                    {fillConfig.label}
                  </span>
                  <span className="text-xs text-slate-400">{cat.items.length} สินค้า</span>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {isIDPass(cat.fill_type) && (
                    <button
                      onClick={() => openDashboard(cat)}
                      className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-xs cursor-pointer"
                    >
                      ดู Dashboard
                    </button>
                  )}
                  <button
                    onClick={() => openEditGame(cat)}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs cursor-pointer"
                  >
                    แก้ไขเกม
                  </button>
                  <button
                    onClick={() => deleteGame(cat.id)}
                    className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs cursor-pointer"
                  >
                    ลบเกม
                  </button>
                </div>
              </div>

              <div className="p-5">
                {/* Product list */}
                {cat.items.length > 0 && (
                  <div className="mb-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {cat.items.map(p => (
                          <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-2 px-2 w-12">
                              {p.image
                                ? <img src={p.image} alt={p.name} className="w-10 h-10 object-cover rounded-lg" />
                                : <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-lg">{p.is_bundle ? '📦' : '🛍️'}</div>
                              }
                            </td>
                            <td className="py-2.5 px-2 font-medium text-slate-800">
                              {p.name}
                              {p.is_bundle && (
                                <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 font-medium">แพ็ก</span>
                              )}
                            </td>
                            <td className="py-2.5 px-2 text-slate-500">฿{p.price}</td>
                            {p.is_bundle
                              ? <td className="py-2.5 px-2 text-slate-400">สต็อก {p.stock}</td>
                              : p.fill_type === 'ID_PASS'
                                ? <td className="py-2.5 px-2 text-slate-400">
                                    สต็อก {p.stock}
                                    {p.price_usd != null && <span className="ml-1.5 text-green-600 text-xs font-medium">${p.price_usd}</span>}
                                  </td>
                                : needsStock
                                  ? <td className="py-2.5 px-2 text-slate-400">สต็อก {p.stock}</td>
                                  : <td className="py-2.5 px-2 text-slate-400 text-xs">เครดิต {Number(p.stock).toFixed(2)}</td>
                            }
                            <td className="py-2.5 px-2 text-right whitespace-nowrap">
                              <button
                                onClick={() => { setEditModal({ ...p }); setEditPreview(null) }}
                                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md mr-1.5 cursor-pointer text-xs"
                              >
                                แก้ไข
                              </button>
                              <button
                                onClick={() => deleteProduct(p.id)}
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
                )}

                {/* Inline add product form */}
                {isExpanded ? (
                  <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 mb-2">
                    <p className="text-sm font-medium text-blue-800 mb-3">เพิ่มสินค้าในเกม: {cat.name}</p>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <input
                        type="text" placeholder="ชื่อสินค้า"
                        value={form.name}
                        onChange={e => setAddForm(cat.id, { name: e.target.value })}
                        className={`flex-1 min-w-[140px] ${inputCls}`}
                      />
                      <input
                        type="number" placeholder="ราคา (฿)"
                        value={form.price}
                        onChange={e => setAddForm(cat.id, { price: e.target.value })}
                        className={`w-28 ${inputCls}`}
                      />
                      {isIDPass(cat.fill_type) ? (
                        <>
                          <input
                            type="number" placeholder="Stock"
                            value={form.stock}
                            onChange={e => setAddForm(cat.id, { stock: e.target.value })}
                            className={`w-20 ${inputCls}`}
                          />
                          <input
                            type="number" step="0.01" placeholder="ราคา $"
                            value={form.price_usd}
                            onChange={e => setAddForm(cat.id, { price_usd: e.target.value })}
                            className={`w-24 ${inputCls}`}
                          />
                          <input
                            type="number" step="0.01" placeholder="ต้นทุน ฿"
                            value={form.cost}
                            onChange={e => setAddForm(cat.id, { cost: e.target.value })}
                            className={`w-24 ${inputCls}`}
                          />
                        </>
                      ) : needsStock && (
                        <input
                          type="number" placeholder="สต็อก"
                          value={form.stock}
                          onChange={e => setAddForm(cat.id, { stock: e.target.value })}
                          className={`w-24 ${inputCls}`}
                        />
                      )}
                      <label className="flex items-center gap-1.5 px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-500 cursor-pointer hover:border-blue-400 bg-white whitespace-nowrap">
                        📷 {form.imagePreview ? 'เปลี่ยนรูป' : 'รูปภาพ'}
                        <input
                          type="file" accept="image/*" className="hidden"
                          ref={el => { addImageRefs.current[cat.id] = el }}
                          onChange={e => {
                            const file = e.target.files[0]
                            setAddForm(cat.id, { imagePreview: file ? URL.createObjectURL(file) : null })
                          }}
                        />
                      </label>
                    </div>
                    {form.imagePreview && (
                      <div className="flex items-center gap-3 mb-2">
                        <img src={form.imagePreview} className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                        <button
                          onClick={() => {
                            setAddForm(cat.id, { imagePreview: null })
                            if (addImageRefs.current[cat.id]) addImageRefs.current[cat.id].value = ''
                          }}
                          className="text-sm text-red-400 hover:text-red-600 cursor-pointer"
                        >
                          ลบรูป
                        </button>
                      </div>
                    )}
                    {addFormErrors[cat.id] && (
                      <p className="text-red-500 text-xs mb-2">{addFormErrors[cat.id]}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => addProductToGame(cat)}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm cursor-pointer"
                      >
                        + เพิ่มสินค้า
                      </button>
                      <button
                        onClick={() => setExpandedCard(null)}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-lg text-sm cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setExpandedCard(cat.id); setPromoExpandedCard(null) }}
                    className="w-full text-sm text-blue-500 hover:text-blue-700 cursor-pointer border border-dashed border-blue-200 hover:border-blue-400 rounded-lg px-4 py-2.5 text-center transition-colors mb-2"
                  >
                    + เพิ่มสินค้าในเกมนี้
                  </button>
                )}

                {/* Inline add promo/bundle product form */}
                {isPromoExpanded ? (
                  <div className="border border-purple-200 rounded-xl p-4 bg-purple-50">
                    <p className="text-sm font-medium text-purple-800 mb-3">เพิ่มสินค้าโปรโมชั่น: {cat.name}</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <input
                        type="text" placeholder="ชื่อแพ็กโปรโมชั่น"
                        value={promoForm.name}
                        onChange={e => setPromoForm(cat.id, { name: e.target.value })}
                        className={`flex-1 min-w-[160px] ${inputCls}`}
                      />
                      <input
                        type="number" placeholder="ราคา (฿)"
                        value={promoForm.price}
                        onChange={e => setPromoForm(cat.id, { price: e.target.value })}
                        className={`w-28 ${inputCls}`}
                      />
                    </div>

                    {/* Component list */}
                    {promoForm.components.length > 0 && (
                      <div className="mb-3 space-y-1">
                        <p className="text-xs text-slate-500 mb-1">สินค้าในแพ็ก:</p>
                        {promoForm.components.map(c => (
                          <div key={c.productId} className="flex items-center gap-2 text-sm bg-white rounded-lg px-3 py-1.5 border border-purple-100">
                            <span className="flex-1 text-slate-700">{c.name}</span>
                            <span className="text-slate-400 text-xs">× {c.qty}</span>
                            <button
                              onClick={() => removeComponent(cat.id, c.productId)}
                              className="text-red-400 hover:text-red-600 cursor-pointer text-base leading-none"
                            >×</button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add component row */}
                    <div className="flex flex-wrap gap-2 mb-2">
                      <select
                        value={promoForm.pendingId}
                        onChange={e => setPromoForm(cat.id, { pendingId: e.target.value })}
                        className={`flex-1 min-w-[140px] ${inputCls} text-slate-600`}
                      >
                        <option value="">— เลือกสินค้า —</option>
                        {nonBundleItems.filter(p => !promoForm.components.find(c => c.productId === p.id)).map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <input
                        type="number" min="1" placeholder="จำนวน"
                        value={promoForm.pendingQty}
                        onChange={e => setPromoForm(cat.id, { pendingQty: e.target.value })}
                        className={`w-20 ${inputCls}`}
                      />
                      <button
                        onClick={() => addComponent(cat.id, nonBundleItems)}
                        className="px-3 py-2.5 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm cursor-pointer"
                      >
                        + เพิ่ม
                      </button>
                    </div>

                    {promoForm.error && (
                      <p className="text-red-500 text-xs mb-2">{promoForm.error}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => addBundleProduct(cat)}
                        className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm cursor-pointer"
                      >
                        สร้างสินค้าโปรโมชั่น
                      </button>
                      <button
                        onClick={() => setPromoExpandedCard(null)}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-lg text-sm cursor-pointer"
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setPromoExpandedCard(cat.id); setExpandedCard(null) }}
                    className="w-full text-sm text-purple-500 hover:text-purple-700 cursor-pointer border border-dashed border-purple-200 hover:border-purple-400 rounded-lg px-4 py-2.5 text-center transition-colors"
                  >
                    + เพิ่มสินค้าโปรโมชั่น
                  </button>
                )}
              </div>
            </div>
          )
        })
      }

      {/* Add Game Modal */}
      {showAddGame && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[440px]">
            <h2 className="text-blue-900 font-bold text-lg mb-5">เพิ่มเกมใหม่</h2>
            <div className="mb-4">
              <label className="block text-sm text-slate-500 mb-1.5">ชื่อเกม</label>
              <input
                type="text"
                value={newGameName}
                onChange={e => setNewGameName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addGame()}
                placeholder="เช่น Free Fire, ROV, PUBG..."
                className={`w-full ${inputCls}`}
                autoFocus
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm text-slate-500 mb-2">ประเภทการเติม</label>
              <TypeButtons
                typeKey={newGameTypeKey} onTypeKey={setNewGameTypeKey}
                otherStock={newGameOtherStock} onOtherStock={setNewGameOtherStock}
              />
            </div>
            {addGameError && <p className="text-red-500 text-sm mb-3">{addGameError}</p>}
            <div className="flex gap-2.5">
              <button onClick={addGame} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-lg cursor-pointer font-medium">
                สร้างเกม
              </button>
              <button onClick={() => setShowAddGame(false)} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-2.5 rounded-lg cursor-pointer">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Game Modal */}
      {editGameModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[440px]">
            <h2 className="text-blue-900 font-bold text-lg mb-5">แก้ไขเกม</h2>
            <div className="mb-4">
              <label className="block text-sm text-slate-500 mb-1.5">ชื่อเกม</label>
              <input
                type="text"
                value={editGameModal.name}
                onChange={e => setEditGameModal(m => ({ ...m, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && saveEditGame()}
                className={`w-full ${inputCls}`}
                autoFocus
              />
            </div>
            <div className="mb-6">
              <label className="block text-sm text-slate-500 mb-2">ประเภทการเติม</label>
              <TypeButtons
                typeKey={editGameTypeKey} onTypeKey={setEditGameTypeKey}
                otherStock={editGameOtherStock} onOtherStock={setEditGameOtherStock}
              />
            </div>
            <div className="flex gap-2.5">
              <button onClick={saveEditGame} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-lg cursor-pointer font-medium">
                บันทึก
              </button>
              <button onClick={() => setEditGameModal(null)} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-2.5 rounded-lg cursor-pointer">
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ID-PASS Dashboard Modal */}
      {dashboardCat && (() => {
        const { products = [], uniqueCosts = [] } = dashboardData || {}
        return (
          <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
                <div>
                  <h2 className="font-bold text-slate-800">Dashboard สต็อก — {dashboardCat.name}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">คลิกเซลล์เพื่อแก้ไข · ต้นทุนเรียงจากน้อยไปมาก</p>
                </div>
                <button
                  onClick={() => setDashboardCat(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-600 rounded-lg text-sm cursor-pointer"
                >
                  ปิด
                </button>
              </div>
              <div className="overflow-auto flex-1 p-4">
                {products.length === 0 ? (
                  <p className="text-center text-slate-400 py-8">ยังไม่มีสินค้าในหมวดหมู่นี้</p>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="text-slate-500 text-left border-b-2 border-slate-200">
                        <th className="pb-2.5 px-3 font-medium whitespace-nowrap">ชื่อสินค้า</th>
                        <th className="pb-2.5 px-3 font-medium whitespace-nowrap">ราคา ฿</th>
                        <th className="pb-2.5 px-3 font-medium whitespace-nowrap">ราคา $</th>
                        {uniqueCosts.map(cost => (
                          <th key={cost} className="pb-2.5 px-3 font-medium whitespace-nowrap text-right">฿{cost}</th>
                        ))}
                        <th className="pb-2.5 px-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map(product => (
                        <tr key={product.id} className="border-t border-slate-100 hover:bg-slate-50">
                          <td className="py-3 px-3 font-medium text-slate-800 whitespace-nowrap">{product.name}</td>
                          <td className="py-3 px-3 text-slate-600 whitespace-nowrap">฿{product.price}</td>
                          {/* ราคา $ — คลิกเพื่อแก้ไข */}
                          <td className="py-3 px-3">
                            {dashEditUsd?.productId === product.id ? (
                              <div className="flex items-center gap-1">
                                <span className="text-slate-400 text-xs">$</span>
                                <input
                                  type="number" step="0.01" min="0"
                                  value={dashEditUsd.value}
                                  onChange={e => setDashEditUsd(p => ({ ...p, value: e.target.value }))}
                                  className="w-20 border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-yellow-500"
                                  autoFocus
                                />
                                <button onClick={savePriceUsd} className="text-green-600 hover:text-green-800 cursor-pointer text-base leading-none">✓</button>
                                <button onClick={() => setDashEditUsd(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer text-base leading-none">✕</button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDashEditUsd({ productId: product.id, value: product.price_usd ?? '' })}
                                className="text-left hover:bg-yellow-50 rounded px-2 py-1 cursor-pointer w-full"
                              >
                                {product.price_usd != null
                                  ? <span className="text-green-600 font-medium">${product.price_usd}</span>
                                  : <span className="text-slate-300 text-xs">คลิกเพื่อตั้ง</span>
                                }
                              </button>
                            )}
                          </td>
                          {/* Lot columns — pivot by cost */}
                          {uniqueCosts.map(cost => {
                            const lot = product.lots.find(l => l.cost === cost)
                            if (!lot) return <td key={cost} className="py-3 px-3 text-center text-slate-300">—</td>
                            return (
                              <td key={cost} className="py-3 px-3 text-right">
                                {dashEditLot?.id === lot.id ? (
                                  <div className="space-y-1 min-w-[90px]">
                                    <div className="flex items-center gap-1 text-xs justify-end">
                                      <span className="text-slate-400">×</span>
                                      <input
                                        type="number" step="1" min="0"
                                        value={dashEditLot.stock}
                                        onChange={e => setDashEditLot(p => ({ ...p, stock: e.target.value }))}
                                        className="w-16 border border-slate-300 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-500"
                                        autoFocus
                                      />
                                    </div>
                                    <div className="flex gap-1 justify-end">
                                      <button onClick={saveLotEdit} className="px-2 py-0.5 bg-green-500 text-white rounded text-xs cursor-pointer">บันทึก</button>
                                      <button onClick={() => setDashEditLot(null)} className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded text-xs cursor-pointer">ยกเลิก</button>
                                      <button onClick={() => deleteLot(lot.id)} className="px-2 py-0.5 bg-red-100 text-red-500 rounded text-xs cursor-pointer">ลบ</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => { setDashEditLot({ id: lot.id, cost: lot.cost, stock: lot.stock }); setDashEditUsd(null) }}
                                    className="text-right hover:bg-slate-100 rounded px-2 py-1 cursor-pointer w-full"
                                  >
                                    <span className="text-slate-700 font-medium">{lot.stock} ชิ้น</span>
                                  </button>
                                )}
                              </td>
                            )
                          })}
                          {/* เพิ่ม lot ต้นทุนใหม่ */}
                          <td className="py-3 px-2">
                            {dashNewLot?.productId === product.id ? (
                              <div className="space-y-1 min-w-[120px]">
                                <input
                                  type="number" step="0.01" placeholder="ต้นทุน ฿"
                                  value={dashNewLot.cost}
                                  onChange={e => setDashNewLot(p => ({ ...p, cost: e.target.value }))}
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                                  autoFocus
                                />
                                <input
                                  type="number" step="1" placeholder="จำนวน"
                                  value={dashNewLot.stock}
                                  onChange={e => setDashNewLot(p => ({ ...p, stock: e.target.value }))}
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500"
                                />
                                <div className="flex gap-1">
                                  <button onClick={saveNewLot} className="flex-1 py-0.5 bg-blue-500 text-white rounded text-xs cursor-pointer">+ เพิ่ม</button>
                                  <button onClick={() => setDashNewLot(null)} className="flex-1 py-0.5 bg-slate-200 text-slate-600 rounded text-xs cursor-pointer">ยกเลิก</button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setDashNewLot({ productId: product.id, cost: '', stock: '' }); setDashEditLot(null) }}
                                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-blue-100 text-blue-400 hover:text-blue-600 cursor-pointer text-lg leading-none"
                                title="เพิ่ม Lot ต้นทุนใหม่"
                              >+</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Edit Product Modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[420px] max-h-[90vh] overflow-y-auto">
            <h2 className="text-blue-900 font-bold mb-5">แก้ไขสินค้า</h2>
            {(editPreview || editModal.image) && (
              <img
                src={editPreview || editModal.image}
                alt={editModal.name}
                className="w-full h-40 object-cover rounded-xl mb-4"
              />
            )}
            <div className="mb-3.5">
              <label className="block text-sm text-slate-500 mb-1.5">ชื่อสินค้า</label>
              <input
                type="text" value={editModal.name}
                onChange={e => setEditModal(m => ({ ...m, name: e.target.value }))}
                className={`w-full ${inputCls}`}
              />
            </div>
            <div className="mb-3.5">
              <label className="block text-sm text-slate-500 mb-1.5">ราคา (฿)</label>
              <input
                type="number" value={editModal.price}
                onChange={e => setEditModal(m => ({ ...m, price: e.target.value }))}
                className={`w-full ${inputCls}`}
              />
            </div>
            {!usesEmailCredits(editModal.fill_type) && !isIDPass(editModal.fill_type) && (
              <div className="mb-3.5">
                <label className="block text-sm text-slate-500 mb-1.5">สต็อก</label>
                <input
                  type="number" value={editModal.stock}
                  onChange={e => setEditModal(m => ({ ...m, stock: e.target.value }))}
                  className={`w-full ${inputCls}`}
                />
              </div>
            )}
            {isIDPass(editModal.fill_type) && (
              <div className="mb-3.5">
                <label className="block text-sm text-slate-500 mb-1.5">ราคา $ (ราคาขายในหน่วย USD)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={editModal.price_usd ?? ''}
                  onChange={e => setEditModal(m => ({ ...m, price_usd: e.target.value }))}
                  className={`w-full ${inputCls}`}
                  placeholder="0.00"
                />
              </div>
            )}
            <div className="mb-3.5">
              <label className="block text-sm text-slate-500 mb-1.5">เกม (หมวดหมู่)</label>
              <select
                value={editModal.category_id ?? ''}
                onChange={e => setEditModal(m => ({ ...m, category_id: e.target.value || null }))}
                className={`w-full ${inputCls} text-slate-600`}
              >
                <option value="">— ไม่มีหมวดหมู่ —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm text-slate-500 mb-1.5">
                รูปภาพ {editModal.image ? '(เลือกใหม่เพื่อเปลี่ยน)' : '(ไม่บังคับ)'}
              </label>
              <input
                ref={editImageRef} type="file" accept="image/*"
                className="w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-600 hover:file:bg-slate-200 cursor-pointer"
                onChange={e => {
                  const file = e.target.files[0]
                  setEditPreview(file ? URL.createObjectURL(file) : null)
                }}
              />
            </div>
            <div className="flex gap-2.5 mt-5">
              <button onClick={saveEdit} className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-lg cursor-pointer">บันทึก</button>
              <button onClick={() => { setEditModal(null); setEditPreview(null) }} className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-2.5 rounded-lg cursor-pointer">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
