const express = require('express')
const session = require('express-session')
const bcrypt = require('bcryptjs')
const db = require('./database')

const app = express()
app.use(express.json())
app.use(express.static('public'))
app.use(session({
  secret: 'pos-secret-key',
  resave: false,
  saveUninitialized: false
}))

// Middleware เช็กว่า Login แล้วไหม
function requireLogin(req, res, next) {
  if (req.session.user) return next()
  res.status(401).json({ error: 'กรุณา Login ก่อนครับ' })
}

// ดูสินค้าทั้งหมด
app.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products').all()
  res.json(products)
})

// เพิ่มสินค้าใหม่
app.post('/products', (req, res) => {
  const { name, price, stock } = req.body
  const result = db.prepare(
    'INSERT INTO products (name, price, stock) VALUES (?, ?, ?)'
  ).run(name, price, stock)
  res.json({ id: result.lastInsertRowid, name, price, stock })
})
// สร้างออเดอร์ใหม่
app.post('/orders', (req, res) => {
  const { items } = req.body
  // items = [{ product_id, quantity }, ...]

  // คำนวณราคารวม
  let total = 0
  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id)
    total += product.price * item.quantity
  }

  // บันทึกออเดอร์
  const order = db.prepare('INSERT INTO orders (total) VALUES (?)').run(total)
  const orderId = order.lastInsertRowid

  // บันทึกรายการสินค้า
  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id)
    db.prepare(
      'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)'
    ).run(orderId, item.product_id, item.quantity, product.price)
  }

  res.json({ order_id: orderId, total })
})

// ดูประวัติออเดอร์ทั้งหมด
app.get('/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders').all()
  res.json(orders)
})

// สมัครสมาชิก
app.post('/register', async (req, res) => {
  const { username, password } = req.body
  const hash = bcrypt.hashSync(password, 10)
  try {
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash)
    res.json({ message: 'สมัครสมาชิกสำเร็จ' })
  } catch {
    res.status(400).json({ error: 'Username นี้มีแล้วครับ' })
  }
})

// Login
app.post('/login', (req, res) => {
  const { username, password } = req.body
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Username หรือ Password ไม่ถูกต้อง' })
  }
  req.session.user = { id: user.id, username: user.username }
  res.json({ message: 'Login สำเร็จ', username: user.username })
})

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy()
  res.json({ message: 'Logout สำเร็จ' })
})

// เช็กสถานะ Login
app.get('/me', (req, res) => {
  if (req.session.user) return res.json(req.session.user)
  res.status(401).json({ error: 'ยังไม่ได้ Login' })
})

// แก้ไขสินค้า
app.put('/products/:id', requireLogin, (req, res) => {
  const { name, price, stock } = req.body
  db.prepare(
    'UPDATE products SET name = ?, price = ?, stock = ? WHERE id = ?'
  ).run(name, price, stock, req.params.id)
  res.json({ message: 'แก้ไขสินค้าสำเร็จ' })
})

// ลบสินค้า
app.delete('/products/:id', requireLogin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id)
  res.json({ message: 'ลบสินค้าสำเร็จ' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server รันอยู่ที่ port ${PORT}`)
})