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
app.use(express.static(path.join(__dirname, 'client/dist')))
app.use(express.static('public'))
app.use(session({
  secret: 'pos-secret-key',
  resave: false,
  saveUninitialized: false
}))

if (!fs.existsSync('public/uploads')) fs.mkdirSync('public/uploads', { recursive: true })

const storage = multer.diskStorage({
  destination: 'public/uploads/',
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
      SELECT p.id, p.name, p.price, p.stock, p.image, p.category_id, c.name, c.fill_type,
        COALESCE((SELECT SUM(e.credits) FROM emails e WHERE e.category_id = p.category_id), 0)
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
    `)
    const products = result[0] ? result[0].values.map(row => {
      const fill_type = row[7] || 'UID'
      return {
        id: row[0], name: row[1], price: row[2],
        stock: usesEmailCredits(fill_type) ? row[8] : row[3],
        image: row[4] || null, category_id: row[5] || null,
        category_name: row[6] || null, fill_type
      }
    }) : []
    res.json(products)
  })

  app.post('/products', requireLogin, (req, res) => {
    const { name, price, stock, category_id } = req.body
    db.run('INSERT INTO products (name, price, stock, category_id) VALUES (?, ?, ?, ?)',
      [name, price, stock, category_id || null])
    const result = db.exec('SELECT last_insert_rowid()')
    const id = result[0].values[0][0]
    save()
    res.json({ id, message: 'เพิ่มสินค้าสำเร็จ' })
  })

  app.put('/products/:id', requireLogin, (req, res) => {
    const { name, price, stock, category_id } = req.body
    db.run('UPDATE products SET name=?, price=?, stock=?, category_id=? WHERE id=?',
      [name, price, stock, category_id || null, req.params.id])
    save()
    res.json({ message: 'แก้ไขสินค้าสำเร็จ' })
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

  app.delete('/products/:id', requireLogin, (req, res) => {
    // Delete image file if exists
    const result = db.exec('SELECT image FROM products WHERE id=?', [req.params.id])
    if (result[0]?.values[0][0]) {
      const imgPath = path.join('public', result[0].values[0][0])
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath)
    }
    db.run('DELETE FROM products WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบสินค้าสำเร็จ' })
  })

  function usesEmailCredits(fill_type) {
    return ['EMAIL', 'RAZER', 'OTHER_EMAIL'].includes(fill_type)
  }

  function deductEmailCredits(category_id, amount) {
    const emailRes = db.exec(
      'SELECT id, credits FROM emails WHERE category_id=? AND credits > 0 ORDER BY credits DESC',
      [category_id]
    )
    if (!emailRes[0]) return
    let remaining = amount
    for (const [id, credits] of emailRes[0].values) {
      if (remaining <= 0) break
      const deduct = Math.min(credits, remaining)
      db.run('UPDATE emails SET credits = credits - ? WHERE id=?', [deduct, id])
      remaining -= deduct
    }
  }

  function restoreEmailCredits(category_id, amount) {
    // คืนเครดิตให้ email แรกในหมวด (เรียง id ASC)
    const emailRes = db.exec('SELECT id FROM emails WHERE category_id=? ORDER BY id ASC LIMIT 1', [category_id])
    if (!emailRes[0]) return
    db.run('UPDATE emails SET credits = credits + ? WHERE id=?', [amount, emailRes[0].values[0][0]])
  }

  app.post('/orders', requireLogin, (req, res) => {
    const { items, transfer_amount, transfer_time } = req.body

    // Validate stock before proceeding
    for (const item of items) {
      const pRes = db.exec('SELECT stock, name, category_id, price FROM products WHERE id=?', [item.product_id])
      if (!pRes[0]) return res.status(400).json({ error: 'ไม่พบสินค้า' })
      const [stock, name, category_id, price] = pRes[0].values[0]

      const catRes = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])
      const fill_type = catRes[0]?.values[0][0] || 'UID'

      if (usesEmailCredits(fill_type)) {
        const needed = fill_type === 'RAZER'
          ? (item.credit_amount || 0)
          : price * item.quantity
        if (fill_type === 'RAZER' && !item.credit_amount) {
          return res.status(400).json({ error: `กรุณากรอกจำนวนเครดิตสำหรับ "${name}"` })
        }
        const credRes = db.exec('SELECT COALESCE(SUM(credits),0) FROM emails WHERE category_id=?', [category_id])
        const totalCredits = credRes[0].values[0][0]
        if (totalCredits < needed) {
          return res.status(400).json({ error: `สินค้า "${name}" มีเครดิตใน Email ไม่พอ (เหลือ ${totalCredits.toFixed(2)} ต้องการ ${needed})` })
        }
      } else {
        if (stock < item.quantity) {
          return res.status(400).json({ error: `สินค้า "${name}" มีสต็อกไม่พอ (เหลือ ${stock} ชิ้น)` })
        }
      }
    }

    let total = 0
    for (const item of items) {
      const result = db.exec('SELECT price FROM products WHERE id=?', [item.product_id])
      total += result[0].values[0][0] * item.quantity
    }

    db.run('INSERT INTO orders (total, transfer_amount, transfer_time) VALUES (?, ?, ?)',
      [total, transfer_amount || null, transfer_time || null])
    const orderResult = db.exec('SELECT last_insert_rowid()')
    const orderId = orderResult[0].values[0][0]

    for (const item of items) {
      const pRes = db.exec('SELECT price, category_id FROM products WHERE id=?', [item.product_id])
      const [price, category_id] = pRes[0].values[0]
      const catRes = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])
      const fill_type = catRes[0]?.values[0][0] || 'UID'

      db.run('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?,?,?,?)',
        [orderId, item.product_id, item.quantity, price])

      let creditDeducted = null
      if (usesEmailCredits(fill_type)) {
        creditDeducted = fill_type === 'RAZER' ? item.credit_amount : price * item.quantity
        deductEmailCredits(category_id, creditDeducted)
      } else {
        db.run('UPDATE products SET stock = stock - ? WHERE id=?', [item.quantity, item.product_id])
      }
      db.run('UPDATE order_items SET credit_deducted=? WHERE order_id=? AND product_id=?',
        [creditDeducted, orderId, item.product_id])
    }

    save()
    res.json({ order_id: orderId, total })
  })

  app.get('/orders', requireLogin, (req, res) => {
    const result = db.exec('SELECT id, total, created_at, transfer_amount, transfer_time FROM orders ORDER BY transfer_time DESC NULLS LAST, id DESC')
    const orders = result[0] ? result[0].values.map(row => ({
      id: row[0], total: row[1], created_at: row[2],
      transfer_amount: row[3], transfer_time: row[4]
    })) : []
    res.json(orders)
  })

  app.delete('/orders/:id', requireLogin, (req, res) => {
    const id = req.params.id
    const items = db.exec('SELECT product_id, quantity, price, credit_deducted FROM order_items WHERE order_id=?', [id])
    if (items[0]) {
      for (const [product_id, quantity, price, credit_deducted] of items[0].values) {
        if (credit_deducted != null) {
          const pRes = db.exec('SELECT category_id FROM products WHERE id=?', [product_id])
          const category_id = pRes[0]?.values[0][0]
          restoreEmailCredits(category_id, credit_deducted)
        } else {
          db.run('UPDATE products SET stock = stock + ? WHERE id=?', [quantity, product_id])
        }
      }
    }
    db.run('DELETE FROM order_items WHERE order_id=?', [id])
    db.run('DELETE FROM orders WHERE id=?', [id])
    save()
    res.json({ message: 'ลบรายการสำเร็จ' })
  })

  // --- Email routes ---
  app.get('/emails', requireLogin, (req, res) => {
    const result = db.exec(`
      SELECT e.id, e.email, e.password, e.link_sms, e.credits, e.category_id, c.name, e.note, e.cost, c.fill_type
      FROM emails e
      LEFT JOIN categories c ON c.id = e.category_id
      ORDER BY e.id DESC
    `)
    const emails = result[0] ? result[0].values.map(row => ({
      id: row[0], email: row[1], password: row[2], link_sms: row[3] || '',
      credits: row[4], category_id: row[5] || null, category_name: row[6] || null,
      note: row[7] || '', cost: row[8] || 0, fill_type: row[9] || null
    })) : []
    res.json(emails)
  })

  app.post('/emails', requireLogin, (req, res) => {
    const { email, password, link_sms, credits, category_id, note, cost } = req.body
    if (!email || !password) return res.status(400).json({ error: 'กรุณากรอก Email และ Password' })
    db.run('INSERT INTO emails (email, password, link_sms, credits, category_id, note, cost) VALUES (?,?,?,?,?,?,?)',
      [email, password, link_sms || null, credits || 0, category_id || null, note || null, cost || 0])
    const r = db.exec('SELECT last_insert_rowid()')
    save()
    res.json({ id: r[0].values[0][0], message: 'เพิ่ม Email สำเร็จ' })
  })

  app.put('/emails/:id', requireLogin, (req, res) => {
    const { email, password, link_sms, credits, category_id, note, cost } = req.body
    db.run('UPDATE emails SET email=?, password=?, link_sms=?, credits=?, category_id=?, note=?, cost=? WHERE id=?',
      [email, password, link_sms || null, credits || 0, category_id || null, note || null, cost || 0, req.params.id])
    save()
    res.json({ message: 'แก้ไข Email สำเร็จ' })
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

    const ordersRes = db.exec(`
      SELECT o.id, o.transfer_amount, o.transfer_time,
             GROUP_CONCAT(p.name || ' x' || oi.quantity, ', ') AS products
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      GROUP BY o.id
      ORDER BY o.id
    `)

    if (!ordersRes[0] || ordersRes[0].values.length === 0) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้ export' })
    }

    const orders = ordersRes[0].values.map(row => ({
      order_id: row[0],
      transfer_amount: row[1],
      transfer_time: row[2],
      products: row[3] || '',
    }))

    try {
      const dayCount = await exportDailyOrders(sheetId, orders)
      res.json({ message: `Export สำเร็จ ${orders.length} รายการ (${dayCount} วัน)` })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
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

  app.post('/register', (req, res) => {
    const { username, password } = req.body
    const hash = bcrypt.hashSync(password, 10)
    try {
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hash])
      save()
      res.json({ message: 'สมัครสมาชิกสำเร็จ' })
    } catch {
      res.status(400).json({ error: 'Username นี้มีแล้วครับ' })
    }
  })

  app.post('/login', (req, res) => {
    const { username, password } = req.body
    const result = db.exec('SELECT * FROM users WHERE username=?', [username])
    if (!result[0]) return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' })
    const user = result[0].values[0]
    if (!bcrypt.compareSync(password, user[2])) return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' })
    req.session.user = { id: user[0], username: user[1] }
    res.json({ message: 'Login สำเร็จ', username: user[1] })
  })

  app.post('/logout', (req, res) => {
    req.session.destroy()
    res.json({ message: 'Logout สำเร็จ' })
  })

  app.get('/me', (req, res) => {
    if (req.session.user) return res.json(req.session.user)
    res.status(401).json({ error: 'ยังไม่ได้ Login' })
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
