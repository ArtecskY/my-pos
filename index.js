const express = require('express')
const session = require('express-session')
const bcrypt = require('bcryptjs')
const { initDB, save, getDB } = require('./database')
const cors = require('cors')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { exportDailyOrders } = require('./sheets')
const cron = require('node-cron')
let razerBot = null
try { razerBot = require('./razer-bot') } catch (e) { console.warn('[razer-bot] puppeteer ไม่พร้อม:', e.message) }

const app = express()
app.set('trust proxy', 1)
app.use(express.json())
app.use(cors({
  origin: (origin, cb) => cb(null, true),
  credentials: true
}))
const UPLOADS_DIR = path.join(process.env.DATA_DIR || path.join(__dirname, 'public'), 'uploads')

app.use(express.static(path.join(__dirname, 'client/dist')))
app.use('/uploads', express.static(UPLOADS_DIR))
app.use(express.static('public'))
app.use(session({
  secret: process.env.SESSION_SECRET || 'pos-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
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

const reservationSseClients = new Set()

// Health check — Railway ใช้ตรวจสอบว่า server ทำงานอยู่
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Restart server — ใช้สำหรับ user กด Restart จากหน้า Login
app.post('/restart', (req, res) => {
  res.json({ message: 'กำลัง Restart Server...' })
  setTimeout(() => {
    const isRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID)
    if (isRailway) {
      process.exit(0)
    } else {
      const { spawn } = require('child_process')
      const child = spawn(process.execPath, [__filename], {
        detached: true,
        stdio: 'ignore',
        cwd: __dirname,
        env: process.env,
        windowsHide: true,
      })
      child.unref()
      process.exit(0)
    }
  }, 300)
})

app.get('/admin/download-db', (req, res) => {
  if (!req.session.user?.is_admin) return res.status(403).json({ error: 'Admin only' })
  const dbPath = path.join(process.env.DATA_DIR || __dirname, 'pos.db')
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'ไม่พบไฟล์ pos.db' })
  res.download(dbPath, 'pos.db')
})

initDB().then(() => {
  const db = getDB()

  app.get('/categories', (req, res) => {
    const result = db.exec('SELECT id, name, fill_type, shop_name, razer_account_type FROM categories ORDER BY name')
    const categories = result[0] ? result[0].values.map(row => ({
      id: row[0], name: row[1], fill_type: row[2] || 'UID', shop_name: row[3] || null, razer_account_type: row[4] || null
    })) : []
    res.json(categories)
  })

  app.post('/categories', requireLogin, (req, res) => {
    const { name, fill_type, shop_name, razer_account_type } = req.body
    try {
      db.run('INSERT INTO categories (name, fill_type, shop_name, razer_account_type) VALUES (?, ?, ?, ?)',
        [name, fill_type || 'UID', shop_name || null, razer_account_type || null])
      const result = db.exec('SELECT last_insert_rowid()')
      const id = result[0].values[0][0]
      save()
      res.json({ id, name, fill_type: fill_type || 'UID', message: 'เพิ่มหมวดหมู่สำเร็จ' })
    } catch {
      res.status(400).json({ error: 'ชื่อหมวดหมู่นี้มีอยู่แล้ว' })
    }
  })

  app.put('/categories/:id', requireLogin, (req, res) => {
    const { name, fill_type, shop_name, razer_account_type } = req.body
    if (name !== undefined) {
      db.run('UPDATE categories SET name=?, fill_type=?, shop_name=?, razer_account_type=? WHERE id=?',
        [name, fill_type, shop_name ?? null, razer_account_type || null, req.params.id])
    } else {
      db.run('UPDATE categories SET fill_type=?, shop_name=?, razer_account_type=? WHERE id=?',
        [fill_type, shop_name ?? null, razer_account_type || null, req.params.id])
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
        p.price_usd, p.cost, p.credits_min, p.credits_max
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
        credits_min: row[12] ?? null,
        credits_max: row[13] ?? null,
      }
    }) : []
    // คำนวณ stock ของ bundle และ ID_PASS จาก sub-tables
    for (const p of products) {
      if (p.is_bundle) {
        if (usesEmailCredits(p.fill_type)) {
          // EMAIL-type bundle: stock is email credits (already set from row[9]) — no override needed
        } else {
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
                const lr = db.exec('SELECT COALESCE(SUM(stock),0) FROM product_lots WHERE product_id=? AND (disabled IS NULL OR disabled=0)', [compId])
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
        }
      } else if (p.fill_type === 'ID_PASS') {
        const lotsRes = db.exec('SELECT COALESCE(SUM(stock), 0) FROM product_lots WHERE product_id=? AND (disabled IS NULL OR disabled=0)', [p.id])
        p.stock = lotsRes[0]?.values[0][0] || 0
      }
    }
    res.json(products)
  })

  app.post('/products', requireLogin, (req, res) => {
    const { name, price, stock, category_id, is_bundle, price_usd, cost, credits_min, credits_max } = req.body
    db.run('INSERT INTO products (name, price, stock, category_id, is_bundle, price_usd, cost, credits_min, credits_max) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, price, stock, category_id || null, is_bundle ? 1 : 0, price_usd ?? null, cost ?? 0, credits_min ?? null, credits_max ?? null])
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
      const check = db.exec('SELECT id, name, sort_order FROM products WHERE id=?', [id])
      console.log('[reorder] after update id=%d so=%d → db:', id, sort_order, check[0]?.values)
    }
    save()
    res.json({ message: 'บันทึกลำดับสำเร็จ' })
  })

  app.put('/products/:id', requireLogin, (req, res) => {
    const { name, price, stock, category_id, price_usd, cost, credits_min, credits_max } = req.body
    db.run('UPDATE products SET name=?, price=?, stock=?, category_id=?, price_usd=?, cost=?, credits_min=?, credits_max=? WHERE id=?',
      [name, price, stock, category_id || null, price_usd ?? null, cost ?? 0, credits_min ?? null, credits_max ?? null, req.params.id])
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
    const result = db.exec('SELECT id, cost, stock, disabled FROM product_lots WHERE product_id=? ORDER BY cost ASC', [product_id])
    const lots = result[0] ? result[0].values.map(row => ({ id: row[0], cost: row[1], stock: row[2], disabled: row[3] === 1 })) : []
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

  // toggle ปิด/เปิด lot
  app.patch('/product-lots/:id/disabled', requireLogin, (req, res) => {
    const { disabled } = req.body
    db.run('UPDATE product_lots SET disabled=? WHERE id=?', [disabled ? 1 : 0, req.params.id])
    save()
    res.json({ message: 'อัปเดตสถานะสำเร็จ' })
  })

  // ลบต้นทุนทั้งคอลัมน์ (ต้องอยู่ก่อน /:id เพื่อป้องกัน Express จับ 'by-cost' เป็น id)
  app.delete('/product-lots/by-cost', requireLogin, (req, res) => {
    const { category_id, cost } = req.body
    if (!category_id || cost == null) return res.status(400).json({ error: 'กรุณาระบุ category_id และ cost' })
    db.run(
      'DELETE FROM product_lots WHERE cost=? AND product_id IN (SELECT id FROM products WHERE category_id=?)',
      [cost, category_id]
    )
    save()
    res.json({ message: 'ลบต้นทุนสำเร็จ' })
  })

  app.delete('/product-lots/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM product_lots WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบ Lot สำเร็จ' })
  })

  app.get('/id-pass-dashboard/:category_id', requireLogin, (req, res) => {
    const productsRes = db.exec(
      'SELECT id, name, price, price_usd FROM products WHERE category_id=? AND (is_bundle IS NULL OR is_bundle=0) ORDER BY sort_order ASC, name ASC',
      [req.params.category_id]
    )
    const products = productsRes[0] ? productsRes[0].values.map(row => ({
      id: row[0], name: row[1], price: row[2], price_usd: row[3] ?? null, lots: []
    })) : []
    const costSet = new Set()
    for (const p of products) {
      const lotsRes = db.exec('SELECT id, cost, stock, disabled FROM product_lots WHERE product_id=? ORDER BY cost ASC', [p.id])
      p.lots = lotsRes[0] ? lotsRes[0].values.map(row => ({ id: row[0], cost: row[1], stock: row[2], disabled: row[3] === 1 })) : []
      for (const lot of p.lots) costSet.add(lot.cost)
    }
    const uniqueCosts = Array.from(costSet).sort((a, b) => a - b)
    res.json({ products, uniqueCosts })
  })

  app.get('/products/:id/bundle-components', requireLogin, (req, res) => {
    const result = db.exec(
      `SELECT pb.component_id, pb.quantity, p.name, p.price, p.price_usd FROM product_bundles pb
       JOIN products p ON p.id = pb.component_id
       WHERE pb.product_id=?`, [req.params.id]
    )
    const components = result[0] ? result[0].values.map(row => ({
      product_id: row[0], quantity: row[1], name: row[2], price: row[3], price_usd: row[4]
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

  // ── Razer Order Queue (ทำทีละ 1 รายการ) ─────────────────────
  const razerQueue = []
  let razerQueueRunning = false

  function enqueueRazerOrder(orderId, order, jobIndex = 1, totalJobs = 1, botType = 'RAZER_AUTO') {
    razerQueue.push({ orderId, order, jobIndex, totalJobs, botType })
    console.log(`[razer-queue] เพิ่ม order#${orderId} job${jobIndex}/${totalJobs} [${botType}] เข้าคิว (คิวรวม: ${razerQueue.length})`)
    processRazerQueue()
  }

  function processRazerQueue() {
    if (razerQueueRunning || razerQueue.length === 0) return
    const { orderId, order, jobIndex, totalJobs, botType } = razerQueue.shift()
    razerQueueRunning = true
    console.log(`[razer-queue] เริ่ม order#${orderId} job${jobIndex}/${totalJobs} [${botType}] (คิวรอ: ${razerQueue.length})`)
    const botFn = (botType === 'RAZER_KUROKO_UID' && razerBot?.runKurokoOrder)
      ? razerBot.runKurokoOrder
      : razerBot.runRazerOrder
    botFn(orderId, order, { loadRazerAccounts, saveRazerAccounts, db, save }, jobIndex, totalJobs)
      .catch(e => {
        console.error(`[razer-queue] order#${orderId} job${jobIndex}/${totalJobs} failed:`, e.message)
        db.run('UPDATE orders SET razer_status=?, razer_note=?, razer_finished_at=? WHERE id=?',
          ['failed', `ชิ้นที่ ${jobIndex}/${totalJobs} ล้มเหลว: ${e.message}`, new Date().toISOString(), orderId])
        save()
      })
      .finally(() => {
        razerQueueRunning = false
        console.log(`[razer-queue] order#${orderId} job${jobIndex}/${totalJobs} เสร็จ — คิวรอ: ${razerQueue.length}`)
        processRazerQueue()
      })
  }
  // ────────────────────────────────────────────────────────────

  // Re-queue pending Razer orders on startup
  setTimeout(() => {
    try {
      const pending = db.exec(
        `SELECT o.id, oi.uid, oi.quantity, c.fill_type, p.id AS product_id, p.category_id
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN products p ON p.id = oi.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE o.razer_status = 'pending'
           AND c.fill_type IN ('RAZER_AUTO','RAZER_KUROKO_UID')`
      )
      if (!pending[0]) return
      // group by orderId to calculate totalJobs
      const byOrder = {}
      for (const [orderId, uid, qty, fillType, productId, categoryId] of pending[0].values) {
        if (!byOrder[orderId]) byOrder[orderId] = []
        for (let q = 0; q < (qty || 1); q++) byOrder[orderId].push({ uid, fillType, productId, categoryId })
      }
      for (const [orderId, jobs] of Object.entries(byOrder)) {
        jobs.forEach((job, i) => {
          const botType = job.fillType === 'RAZER_KUROKO_UID' ? 'RAZER_KUROKO_UID' : 'RAZER_AUTO'
          const order = { gameId: job.categoryId, packageId: job.productId, userFields: { uid: job.uid || '' } }
          console.log(`[startup] re-queue pending order#${orderId} job${i+1}/${jobs.length} [${botType}]`)
          enqueueRazerOrder(Number(orderId), order, i + 1, jobs.length, botType)
        })
      }
    } catch (e) {
      console.error('[startup] re-queue error:', e.message)
    }
  }, 2000)

  function loadRazerAccounts() {
    const r = db.exec(
      'SELECT id, email, password, credits, broken, is_locked, backup_codes, razer_account_type FROM emails WHERE fill_type=\'RAZER\''
    )
    if (!r[0]) return []
    return r[0].values.map(row => ({
      id: row[0],
      email: row[1],
      password: row[2],
      credits: row[3] || 0,
      broken: row[4] || 0,
      is_locked: row[5] || 0,
      backup_codes: (() => { try { return JSON.parse(row[6] || '[]') } catch { return [] } })(),
      razer_account_type: row[7] || null,
    }))
  }

  function saveRazerAccounts(accounts) {
    for (const acc of accounts) {
      db.run(
        'UPDATE emails SET credits=?, is_locked=?, backup_codes=? WHERE id=?',
        [acc.credits, acc.is_locked ? 1 : 0, JSON.stringify(acc.backup_codes || []), acc.id]
      )
    }
    save()
  }

  // --- Email Types (custom) ---
  app.get('/email-summary', requireLogin, (req, res) => {
    try {
      const { email_id, from, to } = req.query
      if (!email_id) return res.status(400).json({ error: 'email_id required' })
      const emailRes = db.exec('SELECT id, email, fill_type, credits, initial_credits, note FROM emails WHERE id=?', [email_id])
      if (!emailRes[0]) return res.status(404).json({ error: 'ไม่พบ email' })
      const [eid, emailAddr, fillType, credits, initialCredits, emailNote] = emailRes[0].values[0]

      let dateFilter = ''
      const params = [email_id]
      if (from) { dateFilter += ' AND COALESCE(o.transfer_time, o.created_at) >= ?'; params.push(from) }
      if (to)   { dateFilter += ' AND COALESCE(o.transfer_time, o.created_at) <= ?'; params.push(to + 'T23:59:59') }

      const rows = db.exec(`
        SELECT oi.id, o.id AS order_id, COALESCE(o.transfer_time, o.created_at) AS order_date,
               p.name AS product_name, c.name AS category_name,
               oi.credit_deducted, oi.price, oi.quantity
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        LEFT JOIN products p ON p.id = oi.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE oi.email_id_used = ?${dateFilter}
        ORDER BY o.id DESC
      `, params)

      const items = rows[0] ? rows[0].values.map(r => ({
        item_id: r[0], order_id: r[1],
        created_at: r[2],
        product_name: r[3] || '-', category_name: r[4] || '-',
        credit_deducted: r[5], price: r[6], quantity: r[7],
      })) : []

      const totalUsed = items.reduce((s, i) => s + (i.credit_deducted || 0), 0)
      res.json({
        email: { id: eid, email: emailAddr, fill_type: fillType, credits, initial_credits: initialCredits, note: emailNote || '' },
        items,
        summary: { initial_credits: initialCredits || 0, total_used: totalUsed, remaining: credits || 0 },
      })
    } catch (e) {
      console.error('email-summary error:', e)
      res.status(500).json({ error: e.message })
    }
  })

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

  // สำหรับ bundle email component: parse จากชื่อก่อน ("4$" → 4) ถ้าไม่มี $ จึงใช้ price_usd
  function parseBundleCompCredit(name, price, price_usd) {
    const m = /(\d+(?:\.\d+)?)\$/.exec(name)
    if (m) return Number(m[1])
    if (price_usd != null) return Number(price_usd)
    return price
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

  function deductRazerFIFO(email_id, amount) {
    const topups = db.exec(
      'SELECT id, remaining, cost FROM email_topups WHERE email_id=? AND remaining > 0 ORDER BY created_at ASC, id ASC',
      [email_id]
    )
    let remaining = amount
    const breakdown = []
    if (topups[0]) {
      for (const [topupId, topupRemaining, topupCost] of topups[0].values) {
        if (remaining <= 0) break
        const use = Math.min(remaining, topupRemaining)
        db.run('UPDATE email_topups SET remaining = remaining - ? WHERE id=?', [use, topupId])
        breakdown.push({ topup_id: topupId, amount_used: use, cost: topupCost })
        remaining -= use
      }
    }
    if (remaining > 0) {
      const ec = db.exec('SELECT cost FROM emails WHERE id=?', [email_id])
      breakdown.push({ topup_id: null, amount_used: remaining, cost: ec[0]?.values[0][0] || 0 })
    }
    db.run('UPDATE emails SET credits = credits - ? WHERE id=?', [amount, email_id])
    return breakdown
  }

  function restoreRazerFIFO(email_id, amount, topupBreakdownJson) {
    db.run('UPDATE emails SET credits = credits + ? WHERE id=?', [amount, email_id])
    if (!topupBreakdownJson) return
    try {
      const breakdown = JSON.parse(topupBreakdownJson)
      for (const item of breakdown) {
        if (item.topup_id != null) {
          db.run('UPDATE email_topups SET remaining = remaining + ? WHERE id=?', [item.amount_used, item.topup_id])
        }
      }
    } catch {}
  }

  app.post('/orders', requireLogin, (req, res) => {
    const { items, manualItems = [], transfer_amount, transfer_time, transfer_time2, channel, tw, reservation_id, razer_urls } = req.body
    // Validate stock before proceeding
    const emailPendingDeductions = {} // track total deductions per email_id in this order
    for (const item of items) {
      const pRes = db.exec('SELECT stock, name, category_id, price, is_bundle, price_usd FROM products WHERE id=?', [item.product_id])
      if (!pRes[0]) return res.status(400).json({ error: 'ไม่พบสินค้า' })
      const [stock, name, category_id, price, is_bundle, price_usd_val] = pRes[0].values[0]

      // RAZER_AUTO / RAZER_KUROKO_UID: ข้าม validation (บอทจัดการเอง)
      if (!is_bundle) {
        const catCheck = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])
        const autoType = catCheck[0]?.values[0][0]
        if (autoType === 'RAZER_AUTO' || autoType === 'RAZER_KUROKO_UID') continue
      }

      if (is_bundle) {
        const catRes0 = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])
        const bundleFillType0 = catRes0[0]?.values[0][0] || 'UID'
        if (bundleFillType0 === 'RAZER_AUTO') continue
        if (usesEmailCredits(bundleFillType0)) {
          // EMAIL-type bundle: validate email credits
          if (item.bundle_email_ids && item.bundle_email_ids.length > 0) {
            // Per-component email validation — server คำนวณ credits เอง
            for (const be of item.bundle_email_ids) {
              if (!be.email_id) return res.status(400).json({ error: `กรุณาเลือก Email สำหรับ "${name}"` })
              // คำนวณ credits จาก component product (parse จากชื่อก่อน × quantity)
              const compRes = db.exec('SELECT name, price, price_usd FROM products WHERE id=?', [be.component_product_id])
              const compCredits = compRes[0] ? parseBundleCompCredit(...compRes[0].values[0]) * (be.quantity || 1) : 0
              const emailRes = db.exec('SELECT credits FROM emails WHERE id=? AND fill_type=?', [be.email_id, bundleFillType0])
              if (!emailRes[0]) return res.status(400).json({ error: `ไม่พบ Email ที่เลือกสำหรับ "${name}"` })
              const emailCredits = emailRes[0].values[0][0]
              const alreadyPending = emailPendingDeductions[be.email_id] || 0
              if (emailCredits - alreadyPending < compCredits)
                return res.status(400).json({ error: `Email มีเครดิตไม่พอสำหรับ "${name}" (เหลือ ${Number(emailCredits - alreadyPending).toFixed(2)} ต้องการ ${compCredits})` })
              emailPendingDeductions[be.email_id] = alreadyPending + compCredits
            }
          } else {
            if (!item.email_id) return res.status(400).json({ error: `กรุณาเลือก Email สำหรับ "${name}"` })
            const needed = parseCreditPerUnit(name, price, price_usd_val) * item.quantity
            const emailRes = db.exec('SELECT credits FROM emails WHERE id=? AND fill_type=?', [item.email_id, bundleFillType0])
            if (!emailRes[0]) return res.status(400).json({ error: `ไม่พบ Email ที่เลือกสำหรับ "${name}"` })
            const emailCredits = emailRes[0].values[0][0]
            const alreadyPending = emailPendingDeductions[item.email_id] || 0
            if (emailCredits - alreadyPending < needed)
              return res.status(400).json({ error: `Email ที่เลือกมีเครดิตไม่พอสำหรับ "${name}" (เหลือ ${Number(emailCredits - alreadyPending).toFixed(2)} ต้องการ ${needed})` })
            emailPendingDeductions[item.email_id] = alreadyPending + needed
          }
        } else {
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
              const lotsRes = db.exec('SELECT COALESCE(SUM(stock), 0) FROM product_lots WHERE product_id=? AND (disabled IS NULL OR disabled=0)', [compId])
              compStock = lotsRes[0]?.values[0][0] || 0
            }
            if (compStock !== -1 && compStock < bundleQty * item.quantity)
              return res.status(400).json({ error: `${compName} มีสต็อกไม่พอสำหรับแพ็ก "${name}" (ต้องการ ${bundleQty * item.quantity} เหลือ ${compStock})` })
          }
        }
      } else {
        const catRes = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])
        const fill_type = catRes[0]?.values[0][0] || 'UID'

        if (fill_type === 'ID_PASS') {
          const totalStockRes = db.exec('SELECT COALESCE(SUM(stock), 0) FROM product_lots WHERE product_id=? AND (disabled IS NULL OR disabled=0)', [item.product_id])
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

    db.run('INSERT INTO orders (total, transfer_amount, transfer_time, transfer_time2, channel, tw) VALUES (?, ?, ?, ?, ?, ?)',
      [total, transfer_amount || null, transfer_time || null, transfer_time2 || null, channel || null, tw ? 1 : 0])
    const orderResult = db.exec('SELECT last_insert_rowid()')
    const orderId = orderResult[0].values[0][0]

    for (const item of items) {
      const pRes = db.exec('SELECT price, category_id, is_bundle, price_usd, name FROM products WHERE id=?', [item.product_id])
      const [price, category_id, is_bundle, price_usd, productName] = pRes[0].values[0]

      // RAZER_AUTO bundle: insert 1 row per component unit, bot handles the rest
      if (is_bundle) {
        const _bFt = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])[0]?.values[0][0]
        if (_bFt === 'RAZER_AUTO') {
          const _bComps = db.exec('SELECT component_id, quantity FROM product_bundles WHERE product_id=?', [item.product_id])
          if (_bComps[0]) {
            for (let _bq = 0; _bq < item.quantity; _bq++) {
              for (const [_cId, _cQty] of _bComps[0].values) {
                const _cPrice = db.exec('SELECT price FROM products WHERE id=?', [_cId])[0]?.values[0][0] || 0
                for (let _cq = 0; _cq < _cQty; _cq++) {
                  db.run('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?,?,?,?)', [orderId, _cId, 1, _cPrice])
                }
              }
            }
          }
          continue
        }
        // RAZER/EMAIL bundle with per-component email split: insert component rows instead of bundle row
        if (usesEmailCredits(_bFt) && item.bundle_email_ids && item.bundle_email_ids.length > 0) {
          for (const be of item.bundle_email_ids) {
            const _beComp = db.exec('SELECT name, price, price_usd FROM products WHERE id=?', [be.component_product_id])
            const [_beName, _bePrice, _bePriceUsd] = _beComp[0]?.values[0] || ['', 0, null]
            const _beCredits = parseBundleCompCredit(_beName, _bePrice, _bePriceUsd) * (be.quantity || 1)
            const _beCost = db.exec('SELECT cost FROM emails WHERE id=?', [be.email_id])[0]?.values[0][0]
            deductFromEmail(be.email_id, _beCredits)
            db.run('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?,?,?,?)',
              [orderId, be.component_product_id, be.quantity || 1, _bePrice])
            const _beOiId = db.exec('SELECT last_insert_rowid()')[0].values[0][0]
            db.run('UPDATE order_items SET credit_deducted=?, email_id_used=?, price_usd_used=?, cost_used=? WHERE id=?',
              [_beCredits, be.email_id, _bePriceUsd ?? null, (_beCost != null && _beCost > 0) ? _beCost : null, _beOiId])
          }
          continue
        }
      }

      db.run('INSERT INTO order_items (order_id, product_id, quantity, price, uid) VALUES (?,?,?,?,?)',
        [orderId, item.product_id, item.quantity, price, item.uid || null])
      const orderItemId = db.exec('SELECT last_insert_rowid()')[0].values[0][0]

      let creditDeducted = null, emailIdUsed = null, lotIdUsed = null, priceUsdUsed = null
      let costUsed = null, lotCostUsed = null, bundleLotInfo = null, topupBreakdown = null, shopNameToStore = null
      if (is_bundle) {
        const catRes1 = db.exec('SELECT fill_type FROM categories WHERE id=?', [category_id])
        const bundleFillType1 = catRes1[0]?.values[0][0] || 'UID'
        if (usesEmailCredits(bundleFillType1)) {
          // EMAIL-type bundle: deduct email credits
          if (item.bundle_email_ids && item.bundle_email_ids.length > 0) {
            // Per-component deduction — server คำนวณ credits เอง
            let totalCredits = 0
            const bundleEmailLog = []
            for (const be of item.bundle_email_ids) {
              const compRes2 = db.exec('SELECT name, price, price_usd FROM products WHERE id=?', [be.component_product_id])
              const compCredits = compRes2[0] ? parseBundleCompCredit(...compRes2[0].values[0]) * (be.quantity || 1) : 0
              const emailAddr = db.exec('SELECT email FROM emails WHERE id=?', [be.email_id])[0]?.values[0][0] || ''
              deductFromEmail(be.email_id, compCredits)
              totalCredits += compCredits
              bundleEmailLog.push({ component_product_id: be.component_product_id, email_id: be.email_id, credits: compCredits, email: emailAddr, quantity: be.quantity || 1 })
            }
            creditDeducted = totalCredits
            emailIdUsed = null
            bundleLotInfo = JSON.stringify({ bundle_email_ids: bundleEmailLog })
            priceUsdUsed = price_usd != null ? price_usd * item.quantity : null
            const ec = db.exec('SELECT cost FROM emails WHERE id=?', [item.bundle_email_ids[0].email_id])
            const ecCost = ec[0]?.values[0][0]
            if (ecCost != null && ecCost > 0) costUsed = ecCost
          } else {
            creditDeducted = parseCreditPerUnit(productName, price, price_usd) * item.quantity
            emailIdUsed = item.email_id
            deductFromEmail(item.email_id, creditDeducted)
            priceUsdUsed = price_usd != null ? price_usd * item.quantity : null
            const ec = db.exec('SELECT cost FROM emails WHERE id=?', [item.email_id])
            const ecCost = ec[0]?.values[0][0]
            if (ecCost != null && ecCost > 0) costUsed = ecCost
          }
        } else {
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
                const lots = db.exec('SELECT id, stock, cost FROM product_lots WHERE product_id=? AND stock > 0 AND (disabled IS NULL OR disabled=0) ORDER BY cost DESC', [compId])
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
        }
      } else {
        const catRes = db.exec('SELECT fill_type, shop_name FROM categories WHERE id=?', [category_id])
        const fill_type = catRes[0]?.values[0][0] || 'UID'
        shopNameToStore = catRes[0]?.values[0][1] || null
        if (fill_type === 'RAZER_AUTO' || fill_type === 'RAZER_KUROKO_UID') {
          // บอทจะจัดการ deduct credits + บันทึก email_id_used หลัง checkout สำเร็จ
        } else if (fill_type === 'ID_PASS') {
          priceUsdUsed = price_usd
          let remaining = item.quantity
          const lots = db.exec('SELECT id, stock, cost FROM product_lots WHERE product_id=? AND stock > 0 AND (disabled IS NULL OR disabled=0) ORDER BY cost DESC', [item.product_id])
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
          if (isRazerLike) {
            const breakdown = deductRazerFIFO(item.email_id, creditDeducted)
            topupBreakdown = JSON.stringify(breakdown)
          } else {
            deductFromEmail(item.email_id, creditDeducted)
          }
        } else {
          db.run('UPDATE products SET stock = stock - ? WHERE id=? AND stock != -1', [item.quantity, item.product_id])
          const costRes = db.exec('SELECT cost FROM products WHERE id=?', [item.product_id])
          const c = costRes[0]?.values[0][0]
          if (c != null && c > 0) costUsed = c
        }
      }
      db.run('UPDATE order_items SET credit_deducted=?, email_id_used=?, lot_id_used=?, price_usd_used=?, cost_used=?, lot_cost_used=?, bundle_lot_info=?, topup_breakdown=?, shop_name=? WHERE id=?',
        [creditDeducted, emailIdUsed, lotIdUsed, priceUsdUsed, costUsed, lotCostUsed, bundleLotInfo, topupBreakdown || null, shopNameToStore, orderItemId])
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

    // รวบ RAZER_AUTO items ตามลำดับ
    const razerAutoItems = items.filter(item => {
      const p = db.exec('SELECT category_id FROM products WHERE id=?', [item.product_id])
      const catId = p[0]?.values[0][0]
      if (!catId) return false
      const c = db.exec('SELECT fill_type FROM categories WHERE id=?', [catId])
      return c[0]?.values[0][0] === 'RAZER_AUTO'
    })

    // รวบ RAZER_KUROKO_UID items
    const kurokoItems = items.filter(item => {
      const p = db.exec('SELECT category_id FROM products WHERE id=?', [item.product_id])
      const catId = p[0]?.values[0][0]
      if (!catId) return false
      const c = db.exec('SELECT fill_type FROM categories WHERE id=?', [catId])
      return c[0]?.values[0][0] === 'RAZER_KUROKO_UID'
    })

    const urlList = Array.isArray(razer_urls) ? razer_urls.filter(Boolean) : []
    if ((razerAutoItems.length > 0 && urlList.length > 0) || kurokoItems.length > 0) {
      db.run('UPDATE orders SET razer_url=?, razer_status=? WHERE id=?',
        [urlList[0] || null, 'pending', orderId])
    }

    save()
    broadcastReservations()
    res.json({ order_id: orderId, total })

    // ยิง Razer Auto bot
    if (razerAutoItems.length > 0 && urlList.length > 0 && razerBot) {
      const jobs = []
      let urlIdx = 0
      for (const razerItem of razerAutoItems) {
        const _isBundleRes = db.exec('SELECT is_bundle FROM products WHERE id=?', [razerItem.product_id])
        const _isBundle = _isBundleRes[0]?.values[0][0] === 1
        if (_isBundle) {
          const _comps = db.exec('SELECT component_id, quantity FROM product_bundles WHERE product_id=?', [razerItem.product_id])
          if (_comps[0]) {
            for (let _bq = 0; _bq < razerItem.quantity; _bq++) {
              for (const [_cId, _cQty] of _comps[0].values) {
                const _cCatId = db.exec('SELECT category_id FROM products WHERE id=?', [_cId])[0]?.values[0][0]
                const _oiRows = db.exec('SELECT id FROM order_items WHERE order_id=? AND product_id=? ORDER BY id ASC', [orderId, _cId])
                for (let _cq = 0; _cq < _cQty && urlIdx < urlList.length; _cq++, urlIdx++) {
                  const _oiId = _oiRows[0]?.values[_bq * _cQty + _cq]?.[0]
                  if (_oiId) jobs.push({ gameId: _cCatId, packageId: _cId, url: urlList[urlIdx], orderItemId: _oiId })
                }
              }
            }
          }
        } else {
          const p = db.exec('SELECT category_id FROM products WHERE id=?', [razerItem.product_id])
          const gameId = p[0]?.values[0][0]
          for (let q = 0; q < razerItem.quantity && urlIdx < urlList.length; q++, urlIdx++) {
            jobs.push({ gameId, packageId: razerItem.product_id, url: urlList[urlIdx] })
          }
        }
      }
      const totalJobs = jobs.length
      jobs.forEach((job, i) => {
        enqueueRazerOrder(
          orderId,
          { gameId: job.gameId, packageId: job.packageId, userFields: { urlLink: job.url }, orderItemId: job.orderItemId || null },
          i + 1,
          totalJobs
        )
      })
    }

    // ยิง Kuroko bot — uid มาจาก item.uid
    if (kurokoItems.length > 0 && razerBot?.runKurokoOrder) {
      const totalKurokoJobs = kurokoItems.reduce((s, ki) => s + (ki.quantity || 1), 0)
      let jobIdx = 0
      for (const ki of kurokoItems) {
        const p = db.exec('SELECT category_id FROM products WHERE id=?', [ki.product_id])
        const gameId = p[0]?.values[0][0]
        for (let q = 0; q < (ki.quantity || 1); q++, jobIdx++) {
          enqueueRazerOrder(
            orderId,
            { gameId, packageId: ki.product_id, userFields: { uid: ki.uid || '' } },
            jobIdx + 1,
            totalKurokoJobs,
            'RAZER_KUROKO_UID'
          )
        }
      }
    }
  })

  app.get('/orders', requireLogin, (req, res) => {
    const result = db.exec('SELECT id, total, created_at, transfer_amount, transfer_time, channel, razer_status, razer_note FROM orders ORDER BY transfer_time DESC NULLS LAST, id DESC')
    const orders = result[0] ? result[0].values.map(row => ({
      id: row[0], total: row[1], created_at: row[2],
      transfer_amount: row[3], transfer_time: row[4], channel: row[5] || null,
      razer_status: row[6] || null, razer_note: row[7] || null,
    })) : []
    res.json(orders)
  })

  app.delete('/orders/:id', requireLogin, (req, res) => {
    const id = req.params.id
    const items = db.exec(`
      SELECT oi.product_id, oi.quantity, oi.price, oi.credit_deducted, oi.email_id_used,
             COALESCE(p.is_bundle, 0), oi.lot_id_used, c.fill_type, oi.topup_breakdown, oi.bundle_lot_info,
             oi.razer_jobs
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE oi.order_id=?`, [id])
    if (items[0]) {
      for (const [product_id, quantity, price, credit_deducted, email_id_used, is_bundle, lot_id_used, fill_type, topup_breakdown, bundle_lot_info, razer_jobs_str] of items[0].values) {
        if (is_bundle) {
          if (credit_deducted != null && email_id_used != null) {
            // EMAIL-type bundle (single email): คืน email credits
            restoreRazerFIFO(email_id_used, credit_deducted, topup_breakdown)
          } else if (credit_deducted != null && bundle_lot_info) {
            // EMAIL-type bundle (multi-email component split): คืน credits แต่ละ email
            let parsed = null
            try { parsed = JSON.parse(bundle_lot_info) } catch (e) {}
            if (parsed?.bundle_email_ids) {
              for (const be of parsed.bundle_email_ids) {
                db.run('UPDATE emails SET credits = credits + ? WHERE id=?', [be.credits, be.email_id])
              }
            }
          } else {
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
          }
        } else if (fill_type === 'ID_PASS') {
          if (lot_id_used) {
            db.run('UPDATE product_lots SET stock = stock + ? WHERE id=?', [quantity, lot_id_used])
          }
        } else if (credit_deducted != null) {
          if (razer_jobs_str) {
            try {
              const razerJobs = JSON.parse(razer_jobs_str)
              for (const job of razerJobs) restoreRazerFIFO(job.email_id, job.amount, null)
            } catch { if (email_id_used != null) restoreRazerFIFO(email_id_used, credit_deducted, topup_breakdown) }
          } else if (email_id_used != null) {
            restoreRazerFIFO(email_id_used, credit_deducted, topup_breakdown)
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
  function getReservationsData() {
    const result = db.exec('SELECT id, customer_name, transfer_amount, reserve_time, channel, created_at, note FROM reservations ORDER BY id ASC')
    const reservations = result[0] ? result[0].values.map(row => ({
      id: row[0], customer_name: row[1], transfer_amount: row[2],
      reserve_time: row[3], channel: row[4], created_at: row[5], note: row[6],
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
    return reservations
  }

  function broadcastReservations() {
    const data = JSON.stringify(getReservationsData())
    for (const client of reservationSseClients) {
      try { client.write(`data: ${data}\n\n`) } catch (e) { reservationSseClients.delete(client) }
    }
  }

  app.get('/reservations', requireLogin, (req, res) => {
    res.json(getReservationsData())
  })

  app.get('/reservations/events', requireLogin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    // ส่งข้อมูลปัจจุบันทันที
    try { res.write(`data: ${JSON.stringify(getReservationsData())}\n\n`) } catch (e) {}
    reservationSseClients.add(res)
    req.on('close', () => reservationSseClients.delete(res))
  })

  app.post('/reservations', requireLogin, (req, res) => {
    const { customer_name, transfer_amount, reserve_time, channel, note, items = [] } = req.body
    db.run('INSERT INTO reservations (customer_name, transfer_amount, reserve_time, channel, note) VALUES (?,?,?,?,?)',
      [customer_name || null, transfer_amount || null, reserve_time || null, channel || null, note || null])
    const r = db.exec('SELECT last_insert_rowid()')
    const reservationId = r[0].values[0][0]
    for (const item of items) {
      db.run('INSERT INTO reservation_items (reservation_id, product_id, quantity) VALUES (?,?,?)',
        [reservationId, item.product_id, item.quantity])
    }
    save()
    broadcastReservations()
    res.json({ id: reservationId, message: 'บันทึกการจองสำเร็จ' })
  })

  app.put('/reservations/:id', requireLogin, (req, res) => {
    try {
      const { customer_name, note, transfer_amount, channel, reserve_time, items } = req.body
      db.run('UPDATE reservations SET customer_name=?, note=?, transfer_amount=?, channel=?, reserve_time=? WHERE id=?',
        [customer_name ?? null, note ?? null, transfer_amount ?? null, channel ?? null, reserve_time ?? null, req.params.id])
      if (Array.isArray(items)) {
        db.run('DELETE FROM reservation_items WHERE reservation_id=?', [req.params.id])
        for (const item of items) {
          db.run('INSERT INTO reservation_items (reservation_id, product_id, quantity) VALUES (?,?,?)',
            [req.params.id, item.product_id, item.quantity])
        }
      }
      save()
      broadcastReservations()
      res.json({ message: 'อัปเดตการจองสำเร็จ' })
    } catch (e) {
      console.error('PUT /reservations error:', e.message)
      res.status(500).json({ error: e.message })
    }
  })

  app.delete('/reservations/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM reservation_items WHERE reservation_id=?', [req.params.id])
    db.run('DELETE FROM reservations WHERE id=?', [req.params.id])
    save()
    broadcastReservations()
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

  app.patch('/orders/:id/channel', requireLogin, (req, res) => {
    const { channel } = req.body
    db.run('UPDATE orders SET channel=? WHERE id=?', [channel || null, req.params.id])
    save()
    res.json({ message: 'อัปเดตช่องทางสำเร็จ' })
  })

  app.patch('/orders/:id/tw', requireLogin, (req, res) => {
    const { tw } = req.body
    db.run('UPDATE orders SET tw=? WHERE id=?', [tw ? 1 : 0, req.params.id])
    save()
    res.json({ message: 'อัปเดต TW สำเร็จ' })
  })

  app.patch('/orders/:id/note', requireLogin, (req, res) => {
    const { note } = req.body
    db.run('UPDATE orders SET order_note=? WHERE id=?', [note || null, req.params.id])
    save()
    res.json({ message: 'อัปเดตบันทึกสำเร็จ' })
  })

  app.patch('/order-items/:id', requireLogin, (req, res) => {
    const itemRes = db.exec(
      `SELECT oi.quantity, oi.credit_deducted, oi.email_id_used, oi.product_id, c.fill_type, oi.lot_id_used
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.product_id AND oi.product_id != 0
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE oi.id=?`,
      [req.params.id]
    )
    if (!itemRes[0]) return res.status(404).json({ error: 'ไม่พบรายการ' })
    const [oldQty, oldCredit, emailIdUsed, productId, fillType, lotIdUsed] = itemRes[0].values[0]

    if (req.body.credit_deducted !== undefined) {
      const newCredit = Number(req.body.credit_deducted)
      if (isNaN(newCredit) || newCredit < 0) return res.status(400).json({ error: 'จำนวนเครดิตไม่ถูกต้อง' })
      if (emailIdUsed != null) {
        const delta = newCredit - (oldCredit || 0)
        if (delta > 0) {
          const emailRes = db.exec('SELECT credits FROM emails WHERE id=?', [emailIdUsed])
          const currentCredits = emailRes[0]?.values[0][0] || 0
          if (currentCredits < delta) return res.status(400).json({ error: `Email มีเครดิตไม่พอ (เหลือ ${Number(currentCredits).toFixed(2)})` })
          db.run('UPDATE emails SET credits = credits - ? WHERE id=?', [delta, emailIdUsed])
        } else if (delta < 0) {
          db.run('UPDATE emails SET credits = credits + ? WHERE id=?', [-delta, emailIdUsed])
        }
      }
      db.run('UPDATE order_items SET credit_deducted=? WHERE id=?', [newCredit, req.params.id])
    } else if (req.body.quantity !== undefined) {
      const newQty = Number(req.body.quantity)
      if (isNaN(newQty) || newQty < 1) return res.status(400).json({ error: 'จำนวนไม่ถูกต้อง' })
      // อัปเดตเฉพาะตัวเลขในประวัติ ไม่กระทบสต็อกจริง
      db.run('UPDATE order_items SET quantity=? WHERE id=?', [newQty, req.params.id])
    } else if (req.body.cost_used !== undefined) {
      const newCost = Number(req.body.cost_used)
      if (isNaN(newCost) || newCost < 0) return res.status(400).json({ error: 'ต้นทุนไม่ถูกต้อง' })
      db.run('UPDATE order_items SET cost_used=? WHERE id=?', [newCost, req.params.id])
    } else if (req.body.shop_name !== undefined) {
      db.run('UPDATE order_items SET shop_name=? WHERE id=?', [req.body.shop_name || null, req.params.id])
    } else {
      return res.status(400).json({ error: 'ไม่มีข้อมูลที่ต้องการแก้ไข' })
    }
    save()
    res.json({ message: 'แก้ไขสำเร็จ' })
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
             COALESCE(e.initial_credits, e.credits) as initial_credits, e.created_date, COALESCE(e.broken, 0) as broken,
             COALESCE(e.backup_codes, '[]') as backup_codes, COALESCE(e.is_locked, 0) as is_locked,
             e.razer_account_type
      FROM emails e
      ORDER BY e.id DESC
    `)
    const emails = result[0] ? result[0].values.map(row => ({
      id: row[0], email: row[1], password: row[2], link_sms: row[3] || '',
      credits: row[4], note: row[5] || '', cost: row[6] || 0, fill_type: row[7] || null,
      initial_credits: row[8] ?? 0, created_date: row[9] || null, broken: row[10] === 1,
      backup_codes: (() => { try { return JSON.parse(row[11] || '[]') } catch { return [] } })(),
      is_locked: row[12] === 1,
      razer_account_type: row[13] || null,
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
    const newEmailId = r[0].values[0][0]
    const isRazerFill = fill_type === 'RAZER' || (fill_type && !['EMAIL', 'OTHER_EMAIL'].includes(fill_type) && getCustomEmailBehavior(fill_type) === 'RAZER')
    if (isRazerFill && (Number(credits) || 0) > 0 && (Number(cost) || 0) > 0) {
      db.run('INSERT INTO email_topups (email_id, amount, remaining, cost) VALUES (?,?,?,?)',
        [newEmailId, Number(credits), Number(credits), Number(cost)])
    }
    save()
    res.json({ id: newEmailId, message: 'เพิ่ม Email สำเร็จ' })
  })

  app.put('/emails/:id', requireLogin, (req, res) => {
    const { email, password, link_sms, credits, note, cost, fill_type, broken, created_date, backup_codes, razer_account_type } = req.body
    // backup_codes ไม่ถูกส่งมา → คง value เดิมใน DB ไว้ ป้องกันการลบโดยไม่ตั้งใจ
    if (backup_codes === undefined) {
      db.run(
        'UPDATE emails SET email=?, password=?, link_sms=?, credits=?, note=?, cost=?, fill_type=?, broken=?, created_date=?, razer_account_type=? WHERE id=?',
        [email, password || '', link_sms || null, credits || 0, note || null, cost || 0, fill_type || null, broken ? 1 : 0, created_date || null, razer_account_type || null, req.params.id]
      )
    } else {
      const backupCodesStr = Array.isArray(backup_codes) ? JSON.stringify(backup_codes) : backup_codes
      db.run(
        'UPDATE emails SET email=?, password=?, link_sms=?, credits=?, note=?, cost=?, fill_type=?, broken=?, created_date=?, backup_codes=?, razer_account_type=? WHERE id=?',
        [email, password || '', link_sms || null, credits || 0, note || null, cost || 0, fill_type || null, broken ? 1 : 0, created_date || null, backupCodesStr, razer_account_type || null, req.params.id]
      )
    }
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

  // ── Razer Account Types ──────────────────────────────────────
  app.get('/razer-account-types', requireLogin, (req, res) => {
    const r = db.exec('SELECT id, name FROM razer_account_types ORDER BY name')
    res.json(r[0] ? r[0].values.map(row => ({ id: row[0], name: row[1] })) : [])
  })

  app.post('/razer-account-types', requireLogin, (req, res) => {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อประเภท' })
    try {
      db.run('INSERT INTO razer_account_types (name) VALUES (?)', [name.trim()])
      const r = db.exec('SELECT last_insert_rowid()')
      save()
      res.json({ id: r[0].values[0][0], name: name.trim() })
    } catch {
      res.status(400).json({ error: 'ชื่อนี้มีอยู่แล้ว' })
    }
  })

  app.delete('/razer-account-types/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM razer_account_types WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบสำเร็จ' })
  })

  // ── Razer Bot routes ─────────────────────────────────────────
  app.get('/razer-bot/screenshots', requireLogin, (req, res) => {
    const dir = require('path').join(__dirname, 'public', 'bot-screenshots')
    const files = require('fs').existsSync(dir)
      ? require('fs').readdirSync(dir).filter(f => f.endsWith('.png')).sort()
      : []
    res.json(files.map(f => `/bot-screenshots/${f}`))
  })

  app.post('/razer-bot/kill', requireLogin, (req, res) => {
    const { orderId } = req.body
    // kill active browser
    razerBot?.killCurrentBot?.()
    // clear pending queue
    razerQueue.splice(0)
    razerQueueRunning = false
    // mark all pending/processing orders as failed
    db.run(
      "UPDATE orders SET razer_status='failed', razer_note='ยกเลิกโดย admin', razer_finished_at=? WHERE razer_status IN ('pending','processing')",
      [new Date().toISOString()]
    )
    // unlock accounts
    db.run("UPDATE emails SET is_locked=0 WHERE fill_type='RAZER' AND is_locked=1")
    save()
    res.json({ killed: true })
  })

  const regenningSet = new Set()  // email IDs ที่กำลัง regen อยู่

  app.get('/razer-regen-status', requireLogin, (req, res) => {
    res.json([...regenningSet])
  })

  app.post('/razer-accounts/:id/regen', requireLogin, (req, res) => {
    if (!razerBot) return res.status(503).json({ error: 'Razer bot ไม่พร้อม (puppeteer ไม่ติดตั้ง)' })
    const emailId = Number(req.params.id)
    if (regenningSet.has(emailId)) return res.json({ message: 'กำลัง regen อยู่แล้ว' })
    const emailRes = db.exec('SELECT id, email, password, backup_codes FROM emails WHERE id=? AND fill_type=\'RAZER\'', [emailId])
    if (!emailRes[0]) return res.status(404).json({ error: 'ไม่พบ Razer account' })
    const row = emailRes[0].values[0]
    const account = {
      id: row[0], email: row[1], password: row[2],
      backup_codes: (() => { try { return JSON.parse(row[3] || '[]') } catch { return [] } })(),
    }
    regenningSet.add(emailId)
    res.json({ message: 'เริ่ม regen backup codes แล้ว' })
    razerBot.regenAccountBackupCodes(account, loadRazerAccounts, saveRazerAccounts)
      .then(count => console.log(`[razer-bot] regen สำเร็จ: ${count} codes สำหรับ email ${account.id}`))
      .catch(e => console.error(`[razer-bot] regen failed email ${account.id}:`, e.message))
      .finally(() => regenningSet.delete(emailId))
  })

  app.get('/razer-status/:orderId', requireLogin, (req, res) => {
    const r = db.exec('SELECT razer_status, razer_note FROM orders WHERE id=?', [req.params.orderId])
    if (!r[0]) return res.status(404).json({ error: 'ไม่พบ order' })
    const [status, note] = r[0].values[0]
    res.json({ status: status || null, note: note || null })
  })

  app.get('/razer-orders', requireLogin, (req, res) => {
    const r = db.exec(`
      SELECT o.id, o.created_at, o.total, o.razer_status, o.razer_note, o.razer_url,
             p.name AS product_name, o.razer_started_at, o.razer_finished_at
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.razer_url IS NOT NULL OR o.razer_status IS NOT NULL
      ORDER BY o.id DESC
      LIMIT 30
    `)
    if (!r[0]) return res.json([])
    const rows = r[0].values.map(v => ({
      id: v[0], created_at: v[1], total: v[2],
      razer_status: v[3], razer_note: v[4], razer_url: v[5],
      product_name: v[6], razer_started_at: v[7], razer_finished_at: v[8],
    }))
    res.json(rows)
  })

  app.post('/emails/:id/topup', requireLogin, (req, res) => {
    const { amount, cost } = req.body
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'กรุณากรอกจำนวนเครดิต' })
    if (cost == null || Number(cost) < 0) return res.status(400).json({ error: 'กรุณากรอกต้นทุนต่อเครดิต' })
    const emailId = Number(req.params.id)
    const emailCheck = db.exec('SELECT id FROM emails WHERE id=?', [emailId])
    if (!emailCheck[0]) return res.status(404).json({ error: 'ไม่พบ Email' })
    db.run('INSERT INTO email_topups (email_id, amount, remaining, cost) VALUES (?,?,?,?)',
      [emailId, Number(amount), Number(amount), Number(cost)])
    db.run('UPDATE emails SET credits = credits + ? WHERE id=?', [Number(amount), emailId])
    save()
    res.json({ message: 'เติมเครดิตสำเร็จ' })
  })

  app.get('/emails/:id/topups', requireLogin, (req, res) => {
    const result = db.exec(
      'SELECT id, amount, remaining, cost, created_at FROM email_topups WHERE email_id=? ORDER BY created_at ASC, id ASC',
      [req.params.id]
    )
    const topups = result[0] ? result[0].values.map(row => ({
      id: row[0], amount: row[1], remaining: row[2], cost: row[3], created_at: row[4],
    })) : []
    res.json(topups)
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

    const { dateFrom, dateTo } = req.body || {}
    const dateFilter = (dateFrom && dateTo)
      ? `AND DATE(COALESCE(o.transfer_time, o.created_at)) BETWEEN '${dateFrom}' AND '${dateTo}'`
      : (dateFrom ? `AND DATE(COALESCE(o.transfer_time, o.created_at)) >= '${dateFrom}'` : '')

    const itemsRes = db.exec(`
      SELECT o.id, o.transfer_amount, COALESCE(o.transfer_time, o.created_at) AS ts,
             p.name, oi.quantity, oi.price, oi.credit_deducted, oi.price_usd_used,
             COALESCE(e.email, oi.shop_name), e.cost AS email_cost,
             oi.lot_cost_used, oi.bundle_lot_info,
             c.fill_type, COALESCE(p.is_bundle, 0), oi.cost_used, p.id AS product_id,
             c.name AS category_name, oi.manual_data, o.channel, oi.topup_breakdown,
             o.transfer_time2, o.order_note, o.tw
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id AND oi.product_id != 0
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN emails e ON e.id = oi.email_id_used
      WHERE (o.razer_status IS NULL OR o.razer_status != 'failed')
      ${dateFilter}
      ORDER BY ts, o.id, oi.id
    `)

    if (!itemsRes[0] || itemsRes[0].values.length === 0) {
      return res.status(400).json({ error: 'ไม่มีข้อมูลให้ export' })
    }

    const orderMap = new Map()
    let exportEmailIdMap = null
    for (const row of itemsRes[0].values) {
      const [order_id, transfer_amount, ts,
             product_name, quantity, item_price, credit_deducted, price_usd_used,
             email_used, email_cost, lot_cost_used, bundle_lot_info,
             fill_type, is_bundle, cost_used, product_id, category_name, manual_data_str, order_channel, topup_breakdown_raw,
             transfer_time2, order_note, tw] = row

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
        orderMap.set(order_id, { order_id, transfer_amount, transfer_time: ts, transfer_time2: transfer_time2 || null, category_name: actualCategoryName, channel: order_channel || null, order_note: order_note || null, tw: tw === 1, items: [] })
      }

      // สำหรับ bundle ที่ component ไม่มี price_usd (order เก่า) ให้ดึงจาก products table
      let enrichedBundleLotInfo = actualBundleLotInfo
      if (is_bundle === 1 && actualBundleLotInfo) {
        try {
          const components = JSON.parse(actualBundleLotInfo)
          // กรณี bundle_email_ids: enrich email + cost จาก emails table
          if (components.bundle_email_ids) {
            const needsEnrich = components.bundle_email_ids.some(be => (!be.email && be.email_id) || be.cost == null)
            if (needsEnrich) {
              if (!exportEmailIdMap) {
                const emailMapRes = db.exec('SELECT id, email, cost FROM emails')
                exportEmailIdMap = {}
                if (emailMapRes[0]) {
                  for (const [id, email, cost] of emailMapRes[0].values) exportEmailIdMap[id] = { email, cost: cost ?? 0 }
                }
              }
              enrichedBundleLotInfo = JSON.stringify({
                ...components,
                bundle_email_ids: components.bundle_email_ids.map(be => ({
                  ...be,
                  email: be.email || exportEmailIdMap[be.email_id]?.email || null,
                  cost: be.cost ?? exportEmailIdMap[be.email_id]?.cost ?? 0,
                }))
              })
            }
          } else {
            // กรณี array components: enrich price_usd จาก products table
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
          }
        } catch {}
      }

      orderMap.get(order_id).items.push({
        product_name: actualProductName, quantity, price: item_price ?? 0, credit_deducted, price_usd_used,
        email_used: actualEmailUsed, email_cost, lot_cost_used, bundle_lot_info: enrichedBundleLotInfo,
        fill_type: actualFillType, is_bundle: is_bundle === 1, cost_used: actualCostUsed,
        topup_breakdown: manual_data_str ? null : (topup_breakdown_raw ?? null),
        category_name: actualCategoryName,
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
    // Pre-load bundle components map for bundle display
    const bundleCompsRes = db.exec(
      'SELECT pb.product_id, p.name, pb.quantity, p.price_usd FROM product_bundles pb JOIN products p ON p.id = pb.component_id ORDER BY pb.product_id, pb.rowid'
    )
    const bundleCompsMap = {}
    if (bundleCompsRes[0]) {
      for (const [pid, name, qty, price_usd] of bundleCompsRes[0].values) {
        if (!bundleCompsMap[pid]) bundleCompsMap[pid] = []
        bundleCompsMap[pid].push({ name, qty, price_usd })
      }
    }

    // Pre-load email map for enriching old bundle records that lack email field
    const emailMapRes = db.exec('SELECT id, email FROM emails')
    const emailIdMap = {}
    if (emailMapRes[0]) {
      for (const [id, email] of emailMapRes[0].values) emailIdMap[id] = email
    }
    // Pre-load product name map for component_name enrichment
    const productNameMapRes = db.exec('SELECT id, name FROM products')
    const productNameMap = {}
    if (productNameMapRes[0]) {
      for (const [id, name] of productNameMapRes[0].values) productNameMap[id] = name
    }

    const result = db.exec(`
      SELECT o.id, o.transfer_time, o.created_at, o.transfer_amount, o.total,
             p.name, oi.quantity, oi.price, oi.credit_deducted, COALESCE(e.email, oi.shop_name), oi.price_usd_used, c.name, oi.cost_used,
             COALESCE(oi.lot_cost_used, pl.cost) as lot_cost_used, oi.bundle_lot_info, o.channel, c.fill_type,
             o.transfer_time2, o.tw, oi.manual_data, oi.id AS item_id, oi.topup_breakdown, COALESCE(p.is_bundle, 0) as is_bundle, oi.product_id,
             o.order_note, oi.razer_jobs
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id AND oi.product_id != 0
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN emails e ON e.id = oi.email_id_used
      LEFT JOIN product_lots pl ON pl.id = oi.lot_id_used
      WHERE (o.razer_status IS NULL OR o.razer_status != 'failed')
      ORDER BY COALESCE(o.transfer_time, o.created_at) DESC, o.id DESC, oi.id ASC
    `)
    const items = result[0] ? result[0].values.map(row => {
      const item = {
        order_id: row[0], transfer_time: row[1], created_at: row[2],
        transfer_amount: row[3], total: row[4],
        product_name: row[5] || '(สินค้าถูกลบแล้ว)', quantity: row[6], price: row[7],
        credit_deducted: row[8], email_used: row[9] || null,
        price_usd_used: row[10] ?? null, category_name: row[11] || null,
        cost_used: row[12] ?? null, lot_cost_used: row[13] ?? null,
        bundle_lot_info: row[14] ?? null, channel: row[15] || null, fill_type: row[16] || null,
        transfer_time2: row[17] || null, tw: row[18] === 1, manual_data: row[19] ?? null,
        item_id: row[20] ?? null, topup_breakdown: row[21] ?? null, is_bundle: row[22] === 1, product_id: row[23] ?? null,
        order_note: row[24] ?? null,
        razer_jobs: row[25] ? (() => { try { return JSON.parse(row[25]) } catch { return null } })() : null,
      }
      if (item.manual_data) {
        try {
          const md = JSON.parse(item.manual_data)
          item.product_name = md.product_name || item.product_name || '(manual)'
          item.category_name = md.game_name || item.category_name
          item.cost_used = md.cost != null ? Number(md.cost) : item.cost_used
        } catch {}
      }
      // Enrich bundle_lot_info: fill missing email + component_name fields
      if (item.bundle_lot_info) {
        try {
          const parsed = JSON.parse(item.bundle_lot_info)
          if (parsed.bundle_email_ids) {
            const needsEnrich = parsed.bundle_email_ids.some(be =>
              (!be.email && be.email_id) || (!be.component_name && be.component_product_id)
            )
            if (needsEnrich) {
              item.bundle_lot_info = JSON.stringify({
                ...parsed,
                bundle_email_ids: parsed.bundle_email_ids.map(be => ({
                  ...be,
                  email: be.email || emailIdMap[be.email_id] || null,
                  component_name: be.component_name || (be.component_product_id ? productNameMap[be.component_product_id] || null : null),
                }))
              })
            }
          }
        } catch {}
      }
      // Enrich bundle without bundle_lot_info with components from product_bundles
      if (item.is_bundle && !item.bundle_lot_info && item.product_id) {
        const comps = bundleCompsMap[item.product_id]
        if (comps?.length) item.bundle_components = comps
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

  // TEMP: Download DB endpoint (ลบออกหลังใช้งาน)
  app.get('/admin/download-db', (req, res) => {
    if (req.query.token !== 'pos-download-2026') return res.status(403).json({ error: 'Forbidden' })
    const dbPath = path.join(process.env.DATA_DIR || __dirname, 'pos.db')
    res.download(dbPath, 'pos.db')
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


  // Helper: ดึงข้อมูล orders สำหรับ export (ใช้ร่วมกันระหว่าง endpoint และ cron)
  async function runSheetExport(dateFrom, dateTo) {
    const settingsRes = db.exec("SELECT value FROM settings WHERE key='sheet_id'")
    const sheetId = settingsRes[0]?.values[0][0]
    if (!sheetId) throw new Error('ยังไม่ได้ตั้งค่า Sheet ID')

    const dateFilter = (dateFrom && dateTo)
      ? `AND DATE(COALESCE(o.transfer_time, o.created_at)) BETWEEN '${dateFrom}' AND '${dateTo}'`
      : (dateFrom ? `AND DATE(COALESCE(o.transfer_time, o.created_at)) >= '${dateFrom}'` : '')

    const itemsRes = db.exec(`
      SELECT o.id, o.transfer_amount, COALESCE(o.transfer_time, o.created_at) AS ts,
             p.name, oi.quantity, oi.price, oi.credit_deducted, oi.price_usd_used,
             COALESCE(e.email, oi.shop_name), e.cost AS email_cost,
             oi.lot_cost_used, oi.bundle_lot_info,
             c.fill_type, COALESCE(p.is_bundle, 0), oi.cost_used, p.id AS product_id,
             c.name AS category_name, oi.manual_data, o.channel, oi.topup_breakdown,
             o.transfer_time2, o.order_note, o.tw
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id AND oi.product_id != 0
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN emails e ON e.id = oi.email_id_used
      WHERE (o.razer_status IS NULL OR o.razer_status != 'failed')
      ${dateFilter}
      ORDER BY ts, o.id, oi.id
    `)

    if (!itemsRes[0] || itemsRes[0].values.length === 0) {
      throw new Error('ไม่มีข้อมูลให้ export')
    }

    const orderMap = new Map()
    for (const row of itemsRes[0].values) {
      const [order_id, transfer_amount, ts,
             product_name, quantity, item_price, credit_deducted, price_usd_used,
             email_used, email_cost, lot_cost_used, bundle_lot_info,
             fill_type, is_bundle, cost_used, product_id, category_name, manual_data_str, order_channel, topup_breakdown_raw,
             transfer_time2, order_note, tw] = row

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
        orderMap.set(order_id, { order_id, transfer_amount, transfer_time: ts, transfer_time2: transfer_time2 || null, category_name: actualCategoryName, channel: order_channel || null, order_note: order_note || null, tw: tw === 1, items: [] })
      }

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
        product_name: actualProductName, quantity, price: item_price ?? 0, credit_deducted, price_usd_used,
        email_used: actualEmailUsed, email_cost, lot_cost_used, bundle_lot_info: enrichedBundleLotInfo,
        fill_type: actualFillType, is_bundle: is_bundle === 1, cost_used: actualCostUsed,
        topup_breakdown: manual_data_str ? null : (topup_breakdown_raw ?? null),
        category_name: actualCategoryName,
      })
    }

    const orders = Array.from(orderMap.values())
    const dayCount = await exportDailyOrders(sheetId, orders)
    return { orderCount: orders.length, dayCount }
  }

  // Cron: Export วันก่อนหน้าอัตโนมัติทุกวันเวลา 05:00 น.
  cron.schedule('0 5 * * *', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' }).format(yesterday)
    console.log(`[Auto Export] เริ่ม export วันที่ ${dateStr}`)
    try {
      const { orderCount, dayCount } = await runSheetExport(dateStr, dateStr)
      console.log(`[Auto Export] สำเร็จ ${orderCount} รายการ (${dayCount} วัน)`)
    } catch (err) {
      console.error(`[Auto Export] ล้มเหลว: ${err.message}`)
    }
  }, { timezone: 'Asia/Bangkok' })

  // ── Bank KBiz routes ────────────────────────────────────────
  let loginKBiz, snapshotKBiz, getSessionStatus, closeKBiz
  try {
    ;({ loginKBiz, snapshotKBiz, getSessionStatus, closeKBiz } = require('./bank-bot'))
  } catch (e) {
    console.warn('⚠️  bank-bot ไม่พร้อมใช้งาน (puppeteer อาจไม่ได้ติดตั้ง):', e.message)
    loginKBiz = async () => { throw new Error('Bank bot ไม่พร้อมใช้งานบน server นี้') }
    snapshotKBiz = async () => { throw new Error('Bank bot ไม่พร้อมใช้งานบน server นี้') }
    getSessionStatus = () => ({ active: false })
    closeKBiz = async () => {}
  }
  const BANK_CONFIG_FILE = path.join(__dirname, '.kbiz-config.json')
  const BANK_SCREENSHOTS_DIR = path.join(__dirname, 'public', 'bank-screenshots')
  if (!fs.existsSync(BANK_SCREENSHOTS_DIR)) fs.mkdirSync(BANK_SCREENSHOTS_DIR, { recursive: true })
  app.use('/bank-screenshots', express.static(BANK_SCREENSHOTS_DIR))

  function loadBankConfig() {
    try { return JSON.parse(fs.readFileSync(BANK_CONFIG_FILE, 'utf8')) } catch { return {} }
  }
  function saveBankConfig(data) {
    fs.writeFileSync(BANK_CONFIG_FILE, JSON.stringify(data, null, 2))
  }

  let bankBotRunning = false
  let loginCooldownUntil = 0  // timestamp ms

  // GET /bank/status — session status + cooldown + last screenshot
  app.get('/bank/status', requireLogin, (req, res) => {
    const cfg = loadBankConfig()
    const now = Date.now()
    res.json({
      sessionActive: getSessionStatus().active,
      cooldownRemaining: Math.max(0, Math.ceil((loginCooldownUntil - now) / 1000)),
      botRunning: bankBotRunning,
      username: cfg.username || '',
      hasPassword: !!cfg.password,
      screenshot: cfg.screenshot || null,
      snapshotTime: cfg.snapshotTime || null,
    })
  })

  // GET /bank/config — ตั้งค่า
  app.get('/bank/config', requireLogin, (req, res) => {
    const cfg = loadBankConfig()
    res.json({ username: cfg.username || '', hasPassword: !!cfg.password })
  })

  // POST /bank/config — บันทึก username/password
  app.post('/bank/config', requireLogin, (req, res) => {
    const { username, password } = req.body || {}
    if (!username) return res.status(400).json({ error: 'กรุณากรอก username' })
    const cfg = loadBankConfig()
    cfg.username = username
    if (password) cfg.password = password
    saveBankConfig(cfg)
    res.json({ ok: true })
  })

  // POST /bank/login — เปิด browser + login (cooldown 5 นาที)
  app.post('/bank/login', requireLogin, async (req, res) => {
    const now = Date.now()
    if (bankBotRunning) return res.status(409).json({ error: 'Bot กำลังทำงานอยู่' })
    if (loginCooldownUntil > now) {
      const secs = Math.ceil((loginCooldownUntil - now) / 1000)
      return res.status(429).json({ error: `รอ ${secs} วินาทีก่อนกด Login ใหม่` })
    }
    const cfg = loadBankConfig()
    if (!cfg.username || !cfg.password) return res.status(400).json({ error: 'กรุณาตั้งค่า username/password ก่อน' })
    bankBotRunning = true
    loginCooldownUntil = now + 5 * 60 * 1000  // cooldown 5 นาทีทันที
    try {
      const { log } = await loginKBiz({ username: cfg.username, password: cfg.password })
      res.json({ ok: true, log })
    } catch (err) {
      loginCooldownUntil = 0  // ถ้า error ล้าง cooldown ให้กดใหม่ได้
      res.status(500).json({ error: err.message, log: err.log || [] })
    } finally {
      bankBotRunning = false
    }
  })

  // POST /bank/snapshot — กดค้นหา + screenshot (ใช้ session เดิม)
  app.post('/bank/snapshot', requireLogin, async (req, res) => {
    if (bankBotRunning) return res.status(409).json({ error: 'Bot กำลังทำงานอยู่' })
    if (!getSessionStatus().active) return res.status(400).json({ error: 'ยังไม่ได้ Login กรุณากดปุ่ม Login ก่อน' })
    bankBotRunning = true
    try {
      const { fileName, log } = await snapshotKBiz({ screenshotDir: BANK_SCREENSHOTS_DIR })
      const snapshotTime = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short'
      }).format(new Date())
      const cfg = loadBankConfig()
      cfg.screenshot = `/bank-screenshots/${fileName}`
      cfg.snapshotTime = snapshotTime
      saveBankConfig(cfg)
      res.json({ ok: true, screenshot: cfg.screenshot, snapshotTime, log })
    } catch (err) {
      res.status(500).json({ error: err.message, log: err.log || [] })
    } finally {
      bankBotRunning = false
    }
  })

  // SPA fallback — ต้องอยู่หลัง API routes ทั้งหมด
  app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'client/dist/index.html'))
  })

  const PORT = process.env.PORT || 3000
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server รันอยู่ที่ port ${PORT}`)
  })
  server.timeout = 600000 // 10 นาที สำหรับ bot snapshot

  // Graceful shutdown: ปิด browser KBiz ด้วย
  process.on('SIGINT', async () => { await closeKBiz(); process.exit(0) })
  process.on('SIGTERM', async () => { await closeKBiz(); process.exit(0) })
}).catch(err => {
  console.error('❌ เกิดข้อผิดพลาดในการเริ่มต้น server:', err)
  process.exit(1)
})
