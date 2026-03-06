const express = require('express')
const session = require('express-session')
const bcrypt = require('bcryptjs')
const { initDB, save, getDB } = require('./database')
const cors = require('cors')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { exportDailyOrders } = require('./sheets')

const app = express()
app.use(express.json())
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}))
const UPLOADS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, 'public'), 'uploads')

app.use(express.static(path.join(__dirname, 'client/dist')))
app.use('/uploads', express.static(UPLOADS_DIR))
app.use(express.static('public'))
app.use(session({
  secret: 'pos-secret-key',
  resave: false,
  saveUninitialized: false
}))

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น'))
  }
})

app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`)
  next()
})

function requireLogin(req, res, next) {
  if (req.session.user) return next()
  res.status(401).json({ error: 'กรุณา Login ก่อนครับ' })
}

initDB().then(() => {
  const db = getDB()

  app.get('/categories', (req, res) => {
    const result = db.exec('SELECT id, name, fill_type FROM categories ORDER BY name')
    const categories = result[0] ? result[0].values.map(row => ({
      id: row[0], name: row[1], fill_type: row[2] || 'UID'
    })) : []
    res.json(categories)
  })

  app.post('/categories', requireLogin, (req, res) => {
    const { name, fill_type } = req.body
    try {
      db.run('INSERT INTO categories (name, fill_type) VALUES (?, ?)', [name, fill_type || 'UID'])
      const result = db.exec('SELECT last_insert_rowid()')
      const id = result[0].values[0][0]
      save()
      res.json({ id, name, fill_type: fill_type || 'UID', message: 'เพิ่มหมวดหมู่สำเร็จ' })
    } catch {
      res.status(400).json({ error: 'ชื่อหมวดหมู่นี้มีอยู่แล้ว' })
    }
  })

  app.put('/categories/:id', requireLogin, (req, res) => {
    const { name, fill_type } = req.body
    if (name !== undefined) {
      db.run('UPDATE categories SET name=?, fill_type=? WHERE id=?', [name, fill_type, req.params.id])
    } else {
      db.run('UPDATE categories SET fill_type=? WHERE id=?', [fill_type, req.params.id])
    }
    save()
    res.json({ message: 'อัปเดตหมวดหมู่สำเร็จ' })
  })

  app.delete('/categories/:id', requireLogin, (req, res) => {
    db.run('UPDATE products SET category_id=NULL WHERE category_id=?', [req.params.id])
    db.run('DELETE FROM categories WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบหมวดหมู่สำเร็จ' })
  })

  app.get('/products', (req, res) => {
    const result = db.exec(`
      SELECT p.id, p.name, p.price, p.stock, p.image, p.category_id, c.name, c.fill_type, p.is_bundle,
        COALESCE((SELECT SUM(e.credits) FROM emails e WHERE e.fill_type = c.fill_type), 0),
        p.price_usd, p.cost
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ORDER BY p.sort_order ASC, p.id ASC
    `)
    const products = result[0] ? result[0].values.map(row => {
      const fill_type = row[7] || 'UID'
      const is_bundle = row[8] === 1
      return {
        id: row[0], name: row[1], price: row[2],
        stock: usesEmailCredits(fill_type) ? row[9] : row[3],
        image: row[4] || null, category_id: row[5] || null,
        category_name: row[6] || null, fill_type, is_bundle,
        price_usd: row[10] ?? null,
        cost: row[11] ?? 0,
      }
    }) : []
    // คำนวณ stock ของ bundle และ ID_PASS จาก sub-tables
    for (const p of products) {
      if (p.is_bundle) {
        const comps = db.exec('SELECT component_id, quantity FROM product_bundles WHERE product_id=?', [p.id])
        if (comps[0] && comps[0].values.length > 0) {
          let minStock = Infinity
          for (const [compId, qty] of comps[0].values) {
            // ตรวจ fill_type ของ component เพื่อเลือก stock source ที่ถูกต้อง
            const compCatRes = db.exec(
              'SELECT c.fill_type FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id=?', [compId]
            )
            const compFillType = compCatRes[0]?.values[0][0] || 'UID'
            let compStock
            if (compFillType === 'ID_PASS') {
              const lr = db.exec('SELECT COALESCE(SUM(stock),0) FROM product_lots WHERE product_id=?', [compId])
              compStock = lr[0]?.values[0][0] || 0
            } else {
              const cr = db.exec('SELECT stock FROM products WHERE id=?', [compId])
              compStock = cr[0] ? cr[0].values[0][0] : 0
            }
            const s = Math.floor(compStock / qty)
            if (s < minStock) minStock = s
          }
          p.stock = minStock === Infinity ? 0 : minStock
        } else {
          p.stock = 0
        }
      } else if (p.fill_type === 'ID_PASS') {
        const lotsRes = db.exec('SELECT COALESCE(SUM(stock), 0) FROM product_lots WHERE product_id=?', [p.id])
        p.stock = lotsRes[0]?.values[0][0] || 0
      }
    }
    res.json(products)
  })

  app.post('/products', requireLogin, (req, res) => {
    const { name, price, stock, category_id, is_bundle, price_usd, cost } = req.body
    db.run('INSERT INTO products (name, price, stock, category_id, is_bundle, price_usd, cost) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, price, stock, category_id || null, is_bundle ? 1 : 0, price_usd ?? null, cost ?? 0])
    const result = db.exec('SELECT last_insert_rowid()')
    const id = result[0].values[0][0]
    save()
    res.json({ id, message: 'เพิ่มสินค้าสำเร็จ' })
  })

  // Feature 1: เรียงลำดับสินค้า (ต้องอยู่ก่อน /products/:id เสมอ)
  app.put('/products/reorder', requireLogin, (req, res) => {
    const items = req.body // [{ id, sort_order }, ...]
    for (const { id, sort_order } of items) {
      db.run('UPDATE products SET sort_order=? WHERE id=?', [sort_order, id])
    }
    save()
    res.json({ message: 'บันทึกลำดับสำเร็จ' })
  })

  app.put('/products/:id', requireLogin, (req, res) => {
    const { name, price, stock, category_id, price_usd, cost } = req.body
    db.run('UPDATE products SET name=?, price=?, stock=?, category_id=?, price_usd=?, cost=? WHERE id=?',
      [name, price, stock, category_id || null, price_usd ?? null, cost ?? 0, req.params.id])
    save()
    res.json({ message: 'แก้ไขสินค้าสำเร็จ' })
  })

  app.patch('/products/:id', requireLogin, (req, res) => {
    const { price_usd } = req.body
    if (price_usd !== undefined) {
      db.run('UPDATE products SET price_usd=? WHERE id=?', [price_usd === '' ? null : Number(price_usd), req.params.id])
    }
    save()
    res.json({ message: 'อัปเดตสำเร็จ' })
  })

  // Feature 2: Copy สินค้าจากเกมอื่น
  app.post('/categories/:id/copy-products', requireLogin, (req, res) => {
    const { source_category_id } = req.body
    const targetId = req.params.id
    if (!source_category_id) return res.status(400).json({ error: 'กรุณาระบุเกมต้นทาง' })
    const srcProds = db.exec(
      'SELECT name, price, price_usd FROM products WHERE category_id=? AND (is_bundle IS NULL OR is_bundle=0) ORDER BY sort_order ASC, id ASC',
      [source_category_id]
    )
    if (!srcProds[0] || srcProds[0].values.length === 0) return res.status(400).json({ error: 'ไม่มีสินค้าในเกมต้นทาง' })
    let count = 0
    // หาลำดับสูงสุดของ target
    const maxOrd = db.exec('SELECT COALESCE(MAX(sort_order), 0) FROM products WHERE category_id=?', [targetId])
    let nextOrder = (maxOrd[0]?.values[0][0] || 0) + 1
    for (const [name, price, price_usd] of srcProds[0].values) {
      db.run('INSERT INTO products (name, price, stock, category_id, price_usd, sort_order) VALUES (?,?,0,?,?,?)',
        [name, price, targetId, price_usd ?? null, nextOrder++])
      count++
    }
    save()
    res.json({ message: `Copy สินค้าสำเร็จ ${count} รายการ`, count })
  })

  // Feature 3: เปลี่ยนชื่อต้นทุน lot ทั้ง category
  app.put('/product-lots/rename-cost', requireLogin, (req, res) => {
    const { category_id, old_cost, new_cost } = req.body
    db.run(
      'UPDATE product_lots SET cost=? WHERE cost=? AND product_id IN (SELECT id FROM products WHERE category_id=?)',
      [new_cost, old_cost, category_id]
    )
    save()
    res.json({ message: 'อัปเดตต้นทุนสำเร็จ' })
  })

  app.post('/products/:id/image', requireLogin, upload.single('image'), (req, res) => {
    console.log('📸 image upload hit, file:', req.file, 'session:', req.session.user)
    if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์รูปภาพ' })
    const imageUrl = `/uploads/${req.file.filename}`
    // Delete old image file if exists
    const old = db.exec('SELECT image FROM products WHERE id=?', [req.params.id])
    if (old[0]?.values[0][0]) {
      const oldPath = path.join('public', old[0].values[0][0])
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
    }
    db.run('UPDATE products SET image=? WHERE id=?', [imageUrl, req.params.id])
    save()
    res.json({ image: imageUrl })
  })

  // --- Product Lots (ID_PASS) ---
  app.get('/product-lots', requireLogin, (req, res) => {
    const { product_id } = req.query
    if (!product_id) return res.json([])
    const result = db.exec('SELECT id, cost, stock FROM product_lots WHERE product_id=? ORDER BY cost ASC', [product_id])
    const lots = result[0] ? result[0].values.map(row => ({ id: row[0], cost: row[1], stock: row[2] })) : []
    res.json(lots)
  })

  app.post('/product-lots', requireLogin, (req, res) => {
    const { product_id, cost, stock } = req.body
    if (!product_id) return res.status(400).json({ error: 'กรุณาระบุ product_id' })
    db.run('INSERT INTO product_lots (product_id, cost, stock) VALUES (?,?,?)', [product_id, cost || 0, stock || 0])
    const r = db.exec('SELECT last_insert_rowid()')
    save()
    res.json({ id: r[0].values[0][0], message: 'เพิ่ม Lot สำเร็จ' })
  })

  app.put('/product-lots/:id', requireLogin, (req, res) => {
    const { cost, stock } = req.body
    db.run('UPDATE product_lots SET cost=?, stock=? WHERE id=?', [cost, stock, req.params.id])
    save()
    res.json({ message: 'แก้ไข Lot สำเร็จ' })
  })

  app.delete('/product-lots/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM product_lots WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบ Lot สำเร็จ' })
  })

  app.get('/id-pass-dashboard/:category_id', requireLogin, (req, res) => {
    const productsRes = db.exec(
      'SELECT id, name, price, price_usd FROM products WHERE category_id=? AND (is_bundle IS NULL OR is_bundle=0) ORDER BY name',
      [req.params.category_id]
    )
    const products = productsRes[0] ? productsRes[0].values.map(row => ({
      id: row[0], name: row[1], price: row[2], price_usd: row[3] ?? null, lots: []
    })) : []
    const costSet = new Set()
    for (const p of products) {
      const lotsRes = db.exec('SELECT id, cost, stock FROM product_lots WHERE product_id=? ORDER BY cost ASC', [p.id])
      p.lots = lotsRes[0] ? lotsRes[0].values.map(row => ({ id: row[0], cost: row[1], stock: row[2] })) : []
      for (const lot of p.lots) costSet.add(lot.cost)
    }
    const uniqueCosts = Array.from(costSet).sort((a, b) => a - b)
    res.json({ products, uniqueCosts })
  })

  app.get('/products/:id/bundle-components', requireLogin, (req, res) => {
    const result = db.exec(
      `SELECT pb.component_id, pb.quantity, p.name FROM product_bundles pb
       JOIN products p ON p.id = pb.component_id
       WHERE pb.product_id=?`, [req.params.id]
    )
    const components = result[0] ? result[0].values.map(row => ({
      product_id: row[0], quantity: row[1], name: row[2]
    })) : []
    res.json(components)
  })

  app.post('/products/:id/bundle-components', requireLogin, (req, res) => {
    const { components } = req.body // [{product_id, quantity}]
    db.run('DELETE FROM product_bundles WHERE product_id=?', [req.params.id])
    for (const comp of (components || [])) {
      db.run('INSERT INTO product_bundles (product_id, component_id, quantity) VALUES (?,?,?)',
        [req.params.id, comp.product_id, comp.quantity])
    }
    save()
    res.json({ message: 'บันทึก components สำเร็จ' })
  })

  app.delete('/products/:id', requireLogin, (req, res) => {
    // Delete image file if exists
    const result = db.exec('SELECT image FROM products WHERE id=?', [req.params.id])
    if (result[0]?.values[0][0]) {
      const imgPath = path.join('public', result[0].values[0][0])
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath)
    }
    db.run('DELETE FROM product_lots WHERE product_id=?', [req.params.id])
    db.run('DELETE FROM product_bundles WHERE product_id=?', [req.params.id])
    db.run('DELETE FROM products WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบสินค้าสำเร็จ' })
  })

  function usesEmailCredits(fill_type) {
    if (['EMAIL', 'RAZER', 'OTHER_EMAIL'].includes(fill_type)) return true
    const r = db.exec('SELECT COUNT(*) FROM email_types WHERE key=?', [fill_type])
    return (r[0]?.values[0][0] || 0) > 0
  }

  function getCustomEmailBehavior(fill_type) {
    const r = db.exec('SELECT behavior FROM email_types WHERE key=?', [fill_type])
    return r[0]?.values[0][0] || 'EMAIL'
  }

  // --- Email Types (custom) ---
  app.get('/email-types', requireLogin, (req, res) => {
    const result = db.exec('SELECT id, key, label, color, behavior FROM email_types ORDER BY id ASC')
    const types = result[0] ? result[0].values.map(row => ({
      id: row[0], key: row[1], label: row[2], color: row[3], behavior: row[4] || 'EMAIL',
    })) : []
    res.json(types)
  })

  app.post('/email-types', requireLogin, (req, res) => {
    const { key, label, color, behavior } = req.body
    if (!label?.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อประเภท' })
    const k = key?.trim() || label.trim()
    const beh = ['RAZER', 'CREDITS'].includes(behavior) ? behavior : 'EMAIL'
    try {
      db.run('INSERT INTO email_types (key, label, color, behavior) VALUES (?,?,?,?)',
        [k, label.trim(), color || 'bg-slate-100 text-slate-700', beh])
      const r = db.exec('SELECT last_insert_rowid()')
      save()
      res.json({ id: r[0].values[0][0], key: k, label: label.trim(), color: color || 'bg-slate-100 text-slate-700', behavior: beh })
    } catch {
      res.status(400).json({ error: 'ชื่อประเภทนี้มีอยู่แล้ว' })
    }
  })

  app.delete('/email-types/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM email_types WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบประเภทสำเร็จ' })
  })

  // คำนวณเครดิตต่อชิ้น: ถ้ามี price_usd ใช้เลย, ไม่งั้น parse $ จากชื่อ, ไม่งั้นใช้ราคา ฿
  function parseCreditPerUnit(name, price, price_usd) {
    if (price_usd != null) return Number(price_usd)
    const m = /(\d+(?:\.\d+)?)\$/.exec(name)
    return m ? Number(m[1]) : price
  }

  function deductFromEmail(email_id, amount) {
    db.run('UPDATE emails SET credits = credits - ? WHERE id=?', [amount, email_id])
  }

  function restoreToEmail(email_id, amount) {
    db.run('UPDATE emails SET credits = credits + ? WHERE id=?', [amount, email_id])
  }

  function restoreEmailCredits(category_id, amount) {
    // legacy fallback: คืนให้ email แรกในหมวด
    const r = db.exec('SELECT id FROM emails WHERE category_id=? ORDER BY id ASC LIMIT 1', [category_id])
    if (r[0]) db.run('UPDATE emails SET credits = credits + ? WHERE id=?', [amount, r[0].values[0][0]])
  }

  app.post('/orders', requireLogin, (req, res) => {
    const { items, manualItems = [], transfer_amount, transfer_time, channel, tw, reservation_id } = req.body

    // Validate stock before proceeding
    const emailPendingDeductions = {} // track total deductions per email_id in this order
    for (const item of items) {
      const pRes = db.exec('SELECT stock, name, category_id, price, is_bundle, price_usd FROM products WHERE id=?', [item.product_id])
      if (!pRes[0]) return res.status(400).json({ error: 'ไม่พบสินค้า' })
      const [stock, name, category_id, price, is_bundle, price_usd_val] = pRes[0].values[0]

      if (is_bundle) {
        // ตรวจสอบ stock ของ components
        const comps = db.exec('SELECT component_id, quantity FROM product_bundles WHERE product_id=?', [item.product_id])
        if (!comps[0] || comps[0].values.length === 0)
          return res.status(400).json({ error: `แพ็กโปรโมชั่น "${name}" ยังไม่มีสินค้า component` })
        for (const [compId, bundleQty] of comps[0].values) {
          const compRes = db.exec(
            'SELECT p.stock, p.name, c.fill_type FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id=?',
            [compId]
          )
          if (!compRes[0]) return res.status(400).json({ error: `ไม่พบสินค้า component ของ "${name}"` })
          const [rawStock, compName, compFillType] = compRes[0].values[0]
          let compStock = rawStock
          if (compFillType === 'ID_PASS') {
            const lotsRes = db.exec('SELECT COALESCE(SUM(stock), 0) FROM product_lots WHERE product_id=?', [compId])
            compStock = lotsRes[0]?.values[0][0] || 0
          }
          if (compStock !== -1 && compStock < bundleQty * item.quantity)
            return res.status(400).json({ error: `${compName} มีสต็อกไม่พอสำหรับแพ็ก "${name}" (ต้องการ ${bundleQty * item.quantity} เหลือ ${compStock})` })
        }
      } else {
        const catRes = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])
        const fill_type = catRes[0]?.values[0][0] || 'UID'

        if (fill_type === 'ID_PASS') {
          const totalStockRes = db.exec('SELECT COALESCE(SUM(stock), 0) FROM product_lots WHERE product_id=?', [item.product_id])
          const totalStock = totalStockRes[0]?.values[0][0] || 0
          if (totalStock < item.quantity)
            return res.status(400).json({ error: `สินค้า "${name}" มีสต็อกไม่พอ (เหลือ ${totalStock} ชิ้น)` })
        } else if (usesEmailCredits(fill_type)) {
          if (!item.email_id) return res.status(400).json({ error: `กรุณาเลือก Email สำหรับ "${name}"` })
          const isCustom = !['EMAIL', 'RAZER', 'OTHER_EMAIL'].includes(fill_type)
          const customBehavior = isCustom ? getCustomEmailBehavior(fill_type) : null
          const isRazerLike = fill_type === 'RAZER' || customBehavior === 'RAZER' || customBehavior === 'CREDITS'
          if (isRazerLike && !item.credit_amount)
            return res.status(400).json({ error: `กรุณากรอกจำนวนเครดิตสำหรับ "${name}"` })
          const needed = isRazerLike ? (item.credit_amount || 0)
            : parseCreditPerUnit(name, price, price_usd_val) * item.quantity
          const emailRes = db.exec('SELECT credits FROM emails WHERE id=? AND fill_type=?', [item.email_id, fill_type])
          if (!emailRes[0]) return res.status(400).json({ error: `ไม่พบ Email ที่เลือกสำหรับ "${name}"` })
          const emailCredits = emailRes[0].values[0][0]
          const alreadyPending = emailPendingDeductions[item.email_id] || 0
          if (emailCredits - alreadyPending < needed)
            return res.status(400).json({ error: `Email ที่เลือกมีเครดิตไม่พอสำหรับ "${name}" (เหลือ ${Number(emailCredits - alreadyPending).toFixed(2)} ต้องการ ${needed})` })
          emailPendingDeductions[item.email_id] = alreadyPending + needed
        } else {
          if (stock !== -1 && stock < item.quantity)
            return res.status(400).json({ error: `สินค้า "${name}" มีสต็อกไม่พอ (เหลือ ${stock} ชิ้น)` })
        }
      }
    }

    let total = 0
    for (const item of items) {
      const result = db.exec('SELECT price FROM products WHERE id=?', [item.product_id])
      total += result[0].values[0][0] * item.quantity
    }

    db.run('INSERT INTO orders (total, transfer_amount, transfer_time, channel, tw) VALUES (?, ?, ?, ?, ?)',
      [total, transfer_amount || null, transfer_time || null, channel || null, tw ? 1 : 0])
    const orderResult = db.exec('SELECT last_insert_rowid()')
    const orderId = orderResult[0].values[0][0]

    for (const item of items) {
      const pRes = db.exec('SELECT price, category_id, is_bundle, price_usd, name FROM products WHERE id=?', [item.product_id])
      const [price, category_id, is_bundle, price_usd, productName] = pRes[0].values[0]

      db.run('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?,?,?,?)',
        [orderId, item.product_id, item.quantity, price])
      const orderItemId = db.exec('SELECT last_insert_rowid()')[0].values[0][0]

      let creditDeducted = null, emailIdUsed = null, lotIdUsed = null, priceUsdUsed = null
      let costUsed = null, lotCostUsed = null, bundleLotInfo = null
      if (is_bundle) {
        let totalCompPriceUsd = 0
        let hasCompPriceUsd = false
        const bundleComponents = []
        const comps = db.exec('SELECT component_id, quantity FROM product_bundles WHERE product_id=?', [item.product_id])
        if (comps[0]) {
          for (const [compId, bundleQty] of comps[0].values) {
            const compRes = db.exec(
              'SELECT c.fill_type, p.price_usd, p.name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id=?',
              [compId]
            )
            const compFillType = compRes[0]?.values[0][0]
            const compPriceUsd = compRes[0]?.values[0][1]
            const compName = compRes[0]?.values[0][2] || ''
            if (compPriceUsd != null) {
              totalCompPriceUsd += Number(compPriceUsd) * bundleQty
              hasCompPriceUsd = true
            }
            const needed = bundleQty * item.quantity
            if (compFillType === 'ID_PASS') {
              let remaining = needed
              let firstCost = null
              const lots = db.exec('SELECT id, stock, cost FROM product_lots WHERE product_id=? AND stock > 0 ORDER BY cost ASC', [compId])
              if (lots[0]) {
                for (const [lotId, lotStock, lotCost] of lots[0].values) {
                  if (remaining <= 0) break
                  const deduct = Math.min(remaining, lotStock)
                  db.run('UPDATE product_lots SET stock = stock - ? WHERE id=?', [deduct, lotId])
                  if (firstCost === null) firstCost = lotCost
                  remaining -= deduct
                }
              }
              bundleComponents.push({ name: compName, cost: firstCost, price_usd: compPriceUsd ?? null, qty: bundleQty })
            } else {
              db.run('UPDATE products SET stock = stock - ? WHERE id=? AND stock != -1', [needed, compId])
              bundleComponents.push({ name: compName, cost: null, price_usd: compPriceUsd ?? null, qty: bundleQty })
            }
          }
        }
        if (hasCompPriceUsd) priceUsdUsed = totalCompPriceUsd * item.quantity
        if (bundleComponents.length > 0) bundleLotInfo = JSON.stringify(bundleComponents)
      } else {
        const catRes = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])
        const fill_type = catRes[0]?.values[0][0] || 'UID'
        if (fill_type === 'ID_PASS') {
          priceUsdUsed = price_usd
          let remaining = item.quantity
          const lots = db.exec('SELECT id, stock, cost FROM product_lots WHERE product_id=? AND stock > 0 ORDER BY cost ASC', [item.product_id])
          if (lots[0]) {
            for (const [lotId, lotStock, lotCost] of lots[0].values) {
              if (remaining <= 0) break
              const deduct = Math.min(remaining, lotStock)
              db.run('UPDATE product_lots SET stock = stock - ? WHERE id=?', [deduct, lotId])
              if (!lotIdUsed) { lotIdUsed = lotId; lotCostUsed = lotCost }
              remaining -= deduct
            }
          }
        } else if (usesEmailCredits(fill_type)) {
          const isCustom = !['EMAIL', 'RAZER', 'OTHER_EMAIL'].includes(fill_type)
          const customBehavior = isCustom ? getCustomEmailBehavior(fill_type) : null
          const isRazerLike = fill_type === 'RAZER' || customBehavior === 'RAZER' || customBehavior === 'CREDITS'
          creditDeducted = isRazerLike ? item.credit_amount
            : parseCreditPerUnit(productName, price, price_usd) * item.quantity
          emailIdUsed = item.email_id
          deductFromEmail(item.email_id, creditDeducted)
        } else {
          db.run('UPDATE products SET stock = stock - ? WHERE id=? AND stock != -1', [item.quantity, item.product_id])
          const costRes = db.exec('SELECT cost FROM products WHERE id=?', [item.product_id])
          const c = costRes[0]?.values[0][0]
          if (c != null && c > 0) costUsed = c
        }
      }
      db.run('UPDATE order_items SET credit_deducted=?, email_id_used=?, lot_id_used=?, price_usd_used=?, cost_used=?, lot_cost_used=?, bundle_lot_info=? WHERE id=?',
        [creditDeducted, emailIdUsed, lotIdUsed, priceUsdUsed, costUsed, lotCostUsed, bundleLotInfo, orderItemId])
    }

    for (const mi of manualItems) {
      if (!mi.product_name) continue
      const manualData = JSON.stringify({
        game_name: mi.game_name || '',
        product_name: mi.product_name || '',
        cost: mi.cost || 0,
        supplier_name: mi.supplier_name || '',
      })
      db.run('INSERT INTO order_items (order_id, product_id, quantity, price, cost_used, credit_deducted, manual_data) VALUES (?,0,1,0,?,?,?)',
        [orderId, mi.cost || null, mi.credits || null, manualData])
    }

    if (reservation_id) {
      db.run('DELETE FROM reservation_items WHERE reservation_id=?', [reservation_id])
      db.run('DELETE FROM reservations WHERE id=?', [reservation_id])
    }

    save()
    res.json({ order_id: orderId, total })
  })

  app.get('/orders', requireLogin, (req, res) => {
    const result = db.exec('SELECT id, total, created_at, transfer_amount, transfer_time, channel FROM orders ORDER BY transfer_time DESC NULLS LAST, id DESC')
    const orders = result[0] ? result[0].values.map(row => ({
      id: row[0], total: row[1], created_at: row[2],
      transfer_amount: row[3], transfer_time: row[4], channel: row[5] || null
    })) : []
    res.json(orders)
  })

  app.delete('/orders/:id', requireLogin, (req, res) => {
    const id = req.params.id
    const items = db.exec(`
      SELECT oi.product_id, oi.quantity, oi.price, oi.credit_deducted, oi.email_id_used,
             COALESCE(p.is_bundle, 0), oi.lot_id_used, c.fill_type
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE oi.order_id=?`, [id])
    if (items[0]) {
      for (const [product_id, quantity, price, credit_deducted, email_id_used, is_bundle, lot_id_used, fill_type] of items[0].values) {
        if (is_bundle) {
          // คืน stock ให้ components (เช็คก่อนสุด ไม่สนใจ fill_type ของ bundle เอง)
          const comps = db.exec('SELECT component_id, quantity FROM product_bundles WHERE product_id=?', [product_id])
          if (comps[0]) {
            for (const [compId, bundleQty] of comps[0].values) {
              const compFtRes = db.exec('SELECT c.fill_type FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id=?', [compId])
              const compFillType = compFtRes[0]?.values[0][0]
              const restoreQty = bundleQty * quantity
              if (compFillType === 'ID_PASS') {
                const firstLot = db.exec('SELECT id FROM product_lots WHERE product_id=? ORDER BY cost ASC LIMIT 1', [compId])
                if (firstLot[0]) db.run('UPDATE product_lots SET stock = stock + ? WHERE id=?', [restoreQty, firstLot[0].values[0][0]])
              } else {
                db.run('UPDATE products SET stock = stock + ? WHERE id=? AND stock != -1', [restoreQty, compId])
              }
            }
          }
        } else if (fill_type === 'ID_PASS') {
          if (lot_id_used) {
            db.run('UPDATE product_lots SET stock = stock + ? WHERE id=?', [quantity, lot_id_used])
          }
        } else if (credit_deducted != null) {
          if (email_id_used != null) {
            restoreToEmail(email_id_used, credit_deducted)
          } else {
            const pRes = db.exec('SELECT category_id FROM products WHERE id=?', [product_id])
            const category_id = pRes[0]?.values[0][0]
            if (category_id) restoreEmailCredits(category_id, credit_deducted)
          }
        } else {
          db.run('UPDATE products SET stock = stock + ? WHERE id=? AND stock != -1', [quantity, product_id])
        }
      }
    }
    db.run('DELETE FROM order_items WHERE order_id=?', [id])
    db.run('DELETE FROM orders WHERE id=?', [id])
    save()
    res.json({ message: 'ลบรายการสำเร็จ' })
  })

  app.patch('/orders/:id/transfer-time', requireLogin, (req, res) => {
    const { id } = req.params
    const { transfer_time, transfer_time2 } = req.body
    if (!transfer_time) return res.status(400).json({ error: 'transfer_time required' })
    db.run('UPDATE orders SET transfer_time=?, transfer_time2=? WHERE id=?', [transfer_time, transfer_time2 ?? null, id])
    save()
    res.json({ message: 'อัปเดตเวลาสำเร็จ' })
  })

  // --- Reservations ---
  app.get('/reservations', requireLogin, (req, res) => {
    const result = db.exec('SELECT id, customer_name, transfer_amount, reserve_time, channel, created_at FROM reservations ORDER BY id DESC')
    const reservations = result[0] ? result[0].values.map(row => ({
      id: row[0], customer_name: row[1], transfer_amount: row[2],
      reserve_time: row[3], channel: row[4], created_at: row[5],
    })) : []
    for (const r of reservations) {
      const items = db.exec(`
        SELECT ri.product_id, ri.quantity, p.name, p.price, c.name as category_name
        FROM reservation_items ri
        JOIN products p ON p.id = ri.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE ri.reservation_id=?`, [r.id])
      r.items = items[0] ? items[0].values.map(row => ({
        product_id: row[0], quantity: row[1], name: row[2], price: row[3], category_name: row[4],
      })) : []
    }
    res.json(reservations)
  })

  app.post('/reservations', requireLogin, (req, res) => {
    const { customer_name, transfer_amount, reserve_time, channel, items } = req.body
    if (!items || items.length === 0) return res.status(400).json({ error: 'กรุณาเลือกสินค้า' })
    db.run('INSERT INTO reservations (customer_name, transfer_amount, reserve_time, channel) VALUES (?,?,?,?)',
      [customer_name || null, transfer_amount || null, reserve_time || null, channel || null])
    const r = db.exec('SELECT last_insert_rowid()')
    const reservationId = r[0].values[0][0]
    for (const item of items) {
      db.run('INSERT INTO reservation_items (reservation_id, product_id, quantity) VALUES (?,?,?)',
        [reservationId, item.product_id, item.quantity])
    }
    save()
    res.json({ id: reservationId, message: 'บันทึกการจองสำเร็จ' })
  })

  app.delete('/reservations/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM reservation_items WHERE reservation_id=?', [req.params.id])
    db.run('DELETE FROM reservations WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบการจองสำเร็จ' })
  })

  app.post('/manual-orders', requireLogin, (req, res) => {
    const { transfer_amount, transfer_time, game_name, product_name, cost, supplier_name, channel, tw } = req.body
    if (!product_name) return res.status(400).json({ error: 'กรุณากรอกชื่อสินค้า' })
    const amount = transfer_amount ? Number(transfer_amount) : 0
    db.run('INSERT INTO orders (total, transfer_amount, transfer_time, channel, tw) VALUES (?, ?, ?, ?, ?)',
      [amount, amount || null, transfer_time || null, channel || null, tw ? 1 : 0])
    const orderResult = db.exec('SELECT last_insert_rowid()')
    const orderId = orderResult[0].values[0][0]
    const manualData = JSON.stringify({
      game_name: game_name || '',
      product_name: product_name || '',
      cost: cost ? Number(cost) : 0,
      supplier_name: supplier_name || '',
    })
    db.run('INSERT INTO order_items (order_id, product_id, quantity, price, cost_used, manual_data) VALUES (?,0,1,?,?,?)',
      [orderId, amount, cost ? Number(cost) : null, manualData])
    save()
    res.json({ order_id: orderId, message: 'บันทึกรายการสำเร็จ' })
  })

  app.patch('/orders/:id/transfer-amount', requireLogin, (req, res) => {
    const { id } = req.params
    const { transfer_amount } = req.body
    if (transfer_amount == null) return res.status(400).json({ error: 'transfer_amount required' })
    db.run('UPDATE orders SET transfer_amount=? WHERE id=?', [Number(transfer_amount), id])
    save()
    res.json({ message: 'อัปเดตยอดโอนสำเร็จ' })
  })

  app.get('/emails/available', requireLogin, (req, res) => {
    const { fill_type, needed } = req.query
    if (!fill_type) return res.json([])
    const result = db.exec(
      'SELECT id, email, credits FROM emails WHERE fill_type=? AND credits >= ? AND (broken IS NULL OR broken = 0) ORDER BY credits DESC',
      [fill_type, Number(needed) || 0]
    )
    const emails = result[0] ? result[0].values.map(row => ({
      id: row[0], email: row[1], credits: row[2]
    })) : []
    res.json(emails)
  })

  // --- Email routes ---
  app.get('/emails', requireLogin, (req, res) => {
    const result = db.exec(`
      SELECT e.id, e.email, e.password, e.link_sms, e.credits, e.note, e.cost, e.fill_type,
             COALESCE(e.initial_credits, e.credits) as initial_credits, e.created_date, COALESCE(e.broken, 0) as broken
      FROM emails e
      ORDER BY e.id DESC
    `)
    const emails = result[0] ? result[0].values.map(row => ({
      id: row[0], email: row[1], password: row[2], link_sms: row[3] || '',
      credits: row[4], note: row[5] || '', cost: row[6] || 0, fill_type: row[7] || null,
      initial_credits: row[8] ?? 0, created_date: row[9] || null, broken: row[10] === 1,
    })) : []
    res.json(emails)
  })

  app.post('/emails', requireLogin, (req, res) => {
    const { email, password, link_sms, credits, note, cost, fill_type, initial_credits, created_date } = req.body
    const isCredits = fill_type && getCustomEmailBehavior(fill_type) === 'CREDITS'
    if (!email) return res.status(400).json({ error: 'กรุณากรอก Email หรือชื่อ Supplier' })
    if (!password && !isCredits) return res.status(400).json({ error: 'กรุณากรอก Password' })
    const initCreds = initial_credits != null ? Number(initial_credits) : (Number(credits) || 0)
    db.run('INSERT INTO emails (email, password, link_sms, credits, note, cost, fill_type, initial_credits, created_date) VALUES (?,?,?,?,?,?,?,?,?)',
      [email, password || '', link_sms || null, credits || 0, note || null, cost || 0, fill_type || null, initCreds, created_date || null])
    const r = db.exec('SELECT last_insert_rowid()')
    save()
    res.json({ id: r[0].values[0][0], message: 'เพิ่ม Email สำเร็จ' })
  })

  app.put('/emails/:id', requireLogin, (req, res) => {
    const { email, password, link_sms, credits, note, cost, fill_type, broken, created_date } = req.body
    db.run('UPDATE emails SET email=?, password=?, link_sms=?, credits=?, note=?, cost=?, fill_type=?, broken=?, created_date=? WHERE id=?',
      [email, password || '', link_sms || null, credits || 0, note || null, cost || 0, fill_type || null, broken ? 1 : 0, created_date || null, req.params.id])
    save()
    res.json({ message: 'แก้ไข Email สำเร็จ' })
  })

  app.patch('/emails/:id/broken', requireLogin, (req, res) => {
    const { broken } = req.body
    db.run('UPDATE emails SET broken=? WHERE id=?', [broken ? 1 : 0, req.params.id])
    save()
    res.json({ message: 'อัปเดตสถานะสำเร็จ' })
  })

  app.delete('/emails/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM emails WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบ Email สำเร็จ' })
  })

  // --- Sheet Config routes ---
  app.get('/sheet-config', requireLogin, (req, res) => {
    const result = db.exec("SELECT value FROM settings WHERE key='sheet_id'")
    res.json({ sheet_id: result[0]?.values[0][0] ?? null })
  })

  app.post('/sheet-config', requireLogin, (req, res) => {
    const { sheet_id } = req.body
    if (!sheet_id?.trim()) return res.status(400).json({ error: 'กรุณาระบุ Sheet ID' })
    db.run("INSERT INTO settings (key, value) VALUES ('sheet_id', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [sheet_id.trim()])
    save()
    res.json({ sheet_id: sheet_id.trim() })
  })

  app.post('/export-to-sheets', requireLogin, async (req, res) => {
    const result = db.exec("SELECT value FROM settings WHERE key='sheet_id'")
    const sheetId = result[0]?.values[0][0]
    if (!sheetId) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า Sheet ID กรุณาตั้งค่าก่อน Export' })

    const itemsRes = db.exec(`
      SELECT o.id, o.transfer_amount, COALESCE(o.transfer_time, o.created_at) AS ts,
             p.name, oi.quantity, oi.credit_deducted, oi.price_usd_used,
             e.email, e.cost AS email_cost,
             oi.lot_cost_used, oi.bundle_lot_info,
             c.fill_type, COALESCE(p.is_bundle, 0), oi.cost_used, p.id AS product_id,
             c.name AS category_name, oi.manual_data
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id AND oi.product_id != 0
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN emails e ON e.id = oi.email_id_used
      ORDER BY ts, o.id, oi.id
    `)

    if (!itemsRes[0] || itemsRes[0].values.length === 0) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้ export' })
    }

    const orderMap = new Map()
    for (const row of itemsRes[0].values) {
      const [order_id, transfer_amount, ts,
             product_name, quantity, credit_deducted, price_usd_used,
             email_used, email_cost, lot_cost_used, bundle_lot_info,
             fill_type, is_bundle, cost_used, product_id, category_name, manual_data_str] = row

      // Handle manual orders
      let actualProductName = product_name
      let actualCategoryName = category_name || ''
      let actualEmailUsed = email_used
      let actualCostUsed = cost_used
      let actualFillType = fill_type
      let actualBundleLotInfo = bundle_lot_info
      if (manual_data_str) {
        try {
          const md = JSON.parse(manual_data_str)
          actualProductName = md.product_name || product_name || '(manual)'
          actualCategoryName = md.game_name || category_name || ''
          actualEmailUsed = md.supplier_name || email_used
          actualCostUsed = md.cost != null ? Number(md.cost) : cost_used
          actualFillType = 'UID'
          actualBundleLotInfo = null
        } catch {}
      }

      if (!orderMap.has(order_id)) {
        orderMap.set(order_id, { order_id, transfer_amount, transfer_time: ts, category_name: actualCategoryName, items: [] })
      }

      // สำหรับ bundle ที่ component ไม่มี price_usd (order เก่า) ให้ดึงจาก products table
      let enrichedBundleLotInfo = actualBundleLotInfo
      if (is_bundle === 1 && actualBundleLotInfo) {
        try {
          const components = JSON.parse(actualBundleLotInfo)
          const needsEnrich = components.some(c => c.price_usd == null)
          if (needsEnrich) {
            const compRows = db.exec(
              'SELECT p.name, p.price_usd, pb.quantity FROM product_bundles pb JOIN products p ON p.id = pb.component_id WHERE pb.product_id=?',
              [product_id]
            )
            if (compRows[0]) {
              const priceMap = {}
              for (const [cName, cPriceUsd, cQty] of compRows[0].values) {
                priceMap[cName] = { price_usd: cPriceUsd, qty: cQty }
              }
              const enriched = components.map(c => ({
                ...c,
                price_usd: c.price_usd ?? priceMap[c.name]?.price_usd ?? null,
                qty: c.qty ?? priceMap[c.name]?.qty ?? 1,
              }))
              enrichedBundleLotInfo = JSON.stringify(enriched)
            }
          }
        } catch {}
      }

      orderMap.get(order_id).items.push({
        product_name: actualProductName, quantity, credit_deducted, price_usd_used,
        email_used: actualEmailUsed, email_cost, lot_cost_used, bundle_lot_info: enrichedBundleLotInfo,
        fill_type: actualFillType, is_bundle: is_bundle === 1, cost_used: actualCostUsed,
      })
    }

    const orders = Array.from(orderMap.values())
    try {
      const dayCount = await exportDailyOrders(sheetId, orders)
      res.json({ message: `Export สำเร็จ ${orders.length} รายการ (${dayCount} วัน)` })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/order-items', requireLogin, (req, res) => {
    const result = db.exec(`
      SELECT o.id, o.transfer_time, o.created_at, o.transfer_amount, o.total,
             p.name, oi.quantity, oi.price, oi.credit_deducted, e.email, oi.price_usd_used, c.name, oi.cost_used,
             COALESCE(oi.lot_cost_used, pl.cost) as lot_cost_used, oi.bundle_lot_info, o.channel, c.fill_type,
             o.transfer_time2, o.tw, oi.manual_data
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id AND oi.product_id != 0
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN emails e ON e.id = oi.email_id_used
      LEFT JOIN product_lots pl ON pl.id = oi.lot_id_used
      ORDER BY COALESCE(o.transfer_time, o.created_at) DESC, o.id DESC, oi.id ASC
    `)
    const items = result[0] ? result[0].values.map(row => {
      const item = {
        order_id: row[0], transfer_time: row[1], created_at: row[2],
        transfer_amount: row[3], total: row[4],
        product_name: row[5], quantity: row[6], price: row[7],
        credit_deducted: row[8], email_used: row[9] || null,
        price_usd_used: row[10] ?? null, category_name: row[11] || null,
        cost_used: row[12] ?? null, lot_cost_used: row[13] ?? null,
        bundle_lot_info: row[14] ?? null, channel: row[15] || null, fill_type: row[16] || null,
        transfer_time2: row[17] || null, tw: row[18] === 1, manual_data: row[19] ?? null,
      }
      if (item.manual_data) {
        try {
          const md = JSON.parse(item.manual_data)
          item.product_name = md.product_name || item.product_name || '(manual)'
          item.category_name = md.game_name || item.category_name
          item.cost_used = md.cost != null ? Number(md.cost) : item.cost_used
        } catch {}
      }
      return item
    }) : []
    res.json(items)
  })

  app.get('/orders/:id/items', requireLogin, (req, res) => {
    const result = db.exec(`
      SELECT oi.id, oi.quantity, oi.price, p.name
      FROM order_items oi
      JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?
    `, [req.params.id])
    const items = result[0] ? result[0].values.map(row => ({
      id: row[0], quantity: row[1], price: row[2], name: row[3]
    })) : []
    res.json(items)
  })

  function requireAdmin(req, res, next) {
    if (!req.session.user?.is_admin) return res.status(403).json({ error: 'ต้องการสิทธิ์ Admin' })
    next()
  }

  // สร้างผู้ใช้ — admin เท่านั้น (หรือ bootstrap ถ้ายังไม่มีผู้ใช้)
  app.post('/register', (req, res) => {
    const { username, password, is_admin } = req.body
    const countRes = db.exec('SELECT COUNT(*) FROM users')
    const userCount = countRes[0]?.values[0][0] || 0
    if (userCount > 0 && !req.session.user?.is_admin) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์สร้างผู้ใช้' })
    }
    const adminFlag = userCount === 0 ? 1 : (is_admin ? 1 : 0)
    const hash = bcrypt.hashSync(password, 10)
    try {
      db.run('INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)', [username, hash, adminFlag])
      save()
      res.json({ message: 'สร้างผู้ใช้สำเร็จ' })
    } catch {
      res.status(400).json({ error: 'Username นี้มีแล้ว' })
    }
  })

  app.post('/login', (req, res) => {
    const { username, password } = req.body
    const result = db.exec('SELECT id, username, password, is_admin FROM users WHERE username=?', [username])
    if (!result[0]) return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' })
    const user = result[0].values[0]
    if (!bcrypt.compareSync(password, user[2])) return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' })
    req.session.user = { id: user[0], username: user[1], is_admin: user[3] === 1 }
    res.json({ message: 'Login สำเร็จ', username: user[1], is_admin: user[3] === 1 })
  })

  app.post('/logout', (req, res) => {
    req.session.destroy()
    res.json({ message: 'Logout สำเร็จ' })
  })

  app.get('/me', (req, res) => {
    if (req.session.user) return res.json(req.session.user)
    res.status(401).json({ error: 'ยังไม่ได้ Login' })
  })

  app.get('/users', requireLogin, requireAdmin, (req, res) => {
    const result = db.exec('SELECT id, username, is_admin FROM users ORDER BY id')
    const users = result[0] ? result[0].values.map(r => ({ id: r[0], username: r[1], is_admin: r[2] === 1 })) : []
    res.json(users)
  })

  app.delete('/users/:id', requireLogin, requireAdmin, (req, res) => {
    if (Number(req.params.id) === req.session.user.id) {
      return res.status(400).json({ error: 'ไม่สามารถลบบัญชีตัวเองได้' })
    }
    db.run('DELETE FROM users WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบผู้ใช้สำเร็จ' })
  })

  // SPA fallback — ส่ง React index.html สำหรับทุก route ที่ไม่ใช่ API
  app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'))
  })

  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => {
    console.log(`Server รันอยู่ที่ port ${PORT}`)
  })
})
