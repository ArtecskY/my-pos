const express = require('express')
const session = require('express-session')
const bcrypt = require('bcryptjs')
const { initDB, save, getDB } = require('./database')

const app = express()
app.use(express.json())
app.use(express.static('public'))
app.use(session({
  secret: 'pos-secret-key',
  resave: false,
  saveUninitialized: false
}))

function requireLogin(req, res, next) {
  if (req.session.user) return next()
  res.status(401).json({ error: 'กรุณา Login ก่อนครับ' })
}

initDB().then(() => {
  const db = getDB()

  app.get('/products', (req, res) => {
    const result = db.exec('SELECT * FROM products')
    const products = result[0] ? result[0].values.map(row => ({
      id: row[0], name: row[1], price: row[2], stock: row[3]
    })) : []
    res.json(products)
  })

  app.post('/products', requireLogin, (req, res) => {
    const { name, price, stock } = req.body
    db.run('INSERT INTO products (name, price, stock) VALUES (?, ?, ?)', [name, price, stock])
    save()
    res.json({ message: 'เพิ่มสินค้าสำเร็จ' })
  })

  app.put('/products/:id', requireLogin, (req, res) => {
    const { name, price, stock } = req.body
    db.run('UPDATE products SET name=?, price=?, stock=? WHERE id=?', [name, price, stock, req.params.id])
    save()
    res.json({ message: 'แก้ไขสินค้าสำเร็จ' })
  })

  app.delete('/products/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM products WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบสินค้าสำเร็จ' })
  })

  app.post('/orders', requireLogin, (req, res) => {
    const { items } = req.body
    let total = 0
    for (const item of items) {
      const result = db.exec('SELECT * FROM products WHERE id=?', [item.product_id])
      const product = result[0].values[0]
      total += product[2] * item.quantity
    }
    db.run('INSERT INTO orders (total) VALUES (?)', [total])
    const orderResult = db.exec('SELECT last_insert_rowid()')
    const orderId = orderResult[0].values[0][0]
    for (const item of items) {
      const result = db.exec('SELECT * FROM products WHERE id=?', [item.product_id])
      const product = result[0].values[0]
      db.run('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?,?,?,?)',
        [orderId, item.product_id, item.quantity, product[2]])
    }
    save()
    res.json({ order_id: orderId, total })
  })

  app.get('/orders', requireLogin, (req, res) => {
    const result = db.exec('SELECT * FROM orders')
    const orders = result[0] ? result[0].values.map(row => ({
      id: row[0], total: row[1], created_at: row[2]
    })) : []
    res.json(orders)
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

  const PORT = process.env.PORT || 3000
  app.listen(PORT, () => {
    console.log(`Server รันอยู่ที่ port ${PORT}`)
  })
})