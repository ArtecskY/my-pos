import { useState, useEffect, useRef } from 'react'

export default function ManagePage() {
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({ name: '', price: '', stock: '' })
  const [formError, setFormError] = useState('')
  const [editModal, setEditModal] = useState(null)
  const addImageRef = useRef(null)
  const editImageRef = useRef(null)

  async function load() {
    const res = await fetch('/products')
    setProducts(await res.json())
  }

  useEffect(() => { load() }, [])

  async function addProduct() {
    setFormError('')
    const { name, price, stock } = form
    if (!name || price === '' || stock === '') { setFormError('กรุณากรอกข้อมูลให้ครบถ้วน'); return }
    if (Number(price) < 0 || Number(stock) < 0) { setFormError('ราคาและสต็อกต้องไม่ติดลบ'); return }

    const res = await fetch('/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price: Number(price), stock: Number(stock) }),
    })
    const data = await res.json()

    const imageFile = addImageRef.current?.files[0]
    if (imageFile && data.id) {
      const formData = new FormData()
      formData.append('image', imageFile)
      await fetch(`/products/${data.id}/image`, { method: 'POST', body: formData })
      addImageRef.current.value = ''
    }

    setForm({ name: '', price: '', stock: '' })
    load()
  }

  async function deleteProduct(id) {
    if (!confirm('ต้องการลบสินค้านี้?')) return
    await fetch(`/products/${id}`, { method: 'DELETE' })
    load()
  }

  async function saveEdit() {
    const { id, name, price, stock } = editModal
    if (!name || price === '' || stock === '') return

    await fetch(`/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, price: Number(price), stock: Number(stock) }),
    })

    const imageFile = editImageRef.current?.files[0]
    if (imageFile) {
      const formData = new FormData()
      formData.append('image', imageFile)
      await fetch(`/products/${id}/image`, { method: 'POST', body: formData })
    }

    setEditModal(null)
    load()
  }

  const textFields = [
    ['name', 'ชื่อสินค้า', 'text'],
    ['price', 'ราคา (฿)', 'number'],
    ['stock', 'สต็อก', 'number'],
  ]

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <h2 className="font-semibold text-slate-800 mb-4">เพิ่มสินค้าใหม่</h2>
      <div className="flex gap-2.5 flex-wrap mb-2">
        {textFields.map(([key, placeholder, type]) => (
          <input
            key={key}
            type={type}
            placeholder={placeholder}
            value={form[key]}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
            className="flex-1 min-w-[120px] border border-slate-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500"
          />
        ))}
        <label className="flex items-center gap-1.5 px-3 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-500 cursor-pointer hover:border-blue-400 whitespace-nowrap">
          📷 รูปภาพ
          <input ref={addImageRef} type="file" accept="image/*" className="hidden" />
        </label>
        <button
          onClick={addProduct}
          className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm whitespace-nowrap cursor-pointer"
        >
          + เพิ่มสินค้า
        </button>
      </div>
      {formError && <p className="text-red-500 text-sm mb-2">{formError}</p>}

      <h2 className="font-semibold text-slate-800 mt-6 mb-3">รายการสินค้า</h2>
      {products.length === 0
        ? <p className="text-slate-400 text-center py-6">ยังไม่มีสินค้า</p>
        : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="w-14 py-2.5 px-3"></th>
                <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">ชื่อสินค้า</th>
                <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">ราคา</th>
                <th className="text-left py-2.5 px-3 text-slate-500 font-semibold">สต็อก</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2 px-3">
                    {p.image
                      ? <img src={p.image} alt={p.name} className="w-10 h-10 object-cover rounded-lg" />
                      : <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center text-xl">🛍️</div>
                    }
                  </td>
                  <td className="py-2.5 px-3 font-medium">{p.name}</td>
                  <td className="py-2.5 px-3">฿{p.price}</td>
                  <td className="py-2.5 px-3">{p.stock}</td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => setEditModal({ ...p })}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-md mr-1.5 cursor-pointer"
                    >
                      แก้ไข
                    </button>
                    <button
                      onClick={() => deleteProduct(p.id)}
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-md cursor-pointer"
                    >
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      {editModal && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
          <div className="bg-white rounded-2xl p-8 w-[400px]">
            <h2 className="text-blue-900 font-bold mb-5">แก้ไขสินค้า</h2>
            {editModal.image && (
              <img src={editModal.image} alt={editModal.name} className="w-full h-40 object-cover rounded-xl mb-4" />
            )}
            {textFields.map(([key, label, type]) => (
              <div key={key} className="mb-3.5">
                <label className="block text-sm text-slate-500 mb-1.5">{label}</label>
                <input
                  type={type}
                  value={editModal[key]}
                  onChange={e => setEditModal(m => ({ ...m, [key]: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2.5 focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
            <div className="mb-4">
              <label className="block text-sm text-slate-500 mb-1.5">
                รูปภาพ {editModal.image ? '(เลือกใหม่เพื่อเปลี่ยน)' : '(ไม่บังคับ)'}
              </label>
              <input
                ref={editImageRef}
                type="file"
                accept="image/*"
                className="w-full text-sm text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 file:text-slate-600 hover:file:bg-slate-200 cursor-pointer"
              />
            </div>
            <div className="flex gap-2.5 mt-5">
              <button
                onClick={saveEdit}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-lg cursor-pointer"
              >
                บันทึก
              </button>
              <button
                onClick={() => setEditModal(null)}
                className="flex-1 bg-slate-200 hover:bg-slate-300 text-slate-600 py-2.5 rounded-lg cursor-pointer"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
