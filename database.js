const fs = require('fs')
const path = require('path')
const initSqlJs = require('sql.js')

const DB_PATH = path.join(process.env.DATA_DIR || __dirname, 'pos.db')

let db

async function initDB() {
  const SQL = await initSqlJs()

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    link_sms TEXT,
    credits REAL NOT NULL DEFAULT 0,
    category_id INTEGER,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS product_bundles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    component_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS product_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    cost REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0
  )`)

  try { db.run('ALTER TABLE products ADD COLUMN image TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN category_id INTEGER') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN transfer_amount REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN transfer_time TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE categories ADD COLUMN fill_type TEXT DEFAULT "UID"') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN note TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN cost REAL DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN fill_type TEXT') } catch (e) { /* column exists */ }
  // migrate fill_type จาก categories สำหรับ email เก่าที่มี category_id
  db.run(`UPDATE emails SET fill_type = (SELECT fill_type FROM categories WHERE id = emails.category_id) WHERE fill_type IS NULL AND category_id IS NOT NULL`)
  try { db.run('ALTER TABLE order_items ADD COLUMN credit_deducted REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN email_id_used INTEGER') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN is_bundle INTEGER DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN price_usd REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN lot_id_used INTEGER') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN price_usd_used REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN cost REAL DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN cost_used REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN lot_cost_used REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN bundle_lot_info TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0') } catch (e) { /* column exists */ }
  // ผู้ใช้คนแรกเป็น admin เสมอ
  db.run('UPDATE users SET is_admin=1 WHERE id=(SELECT MIN(id) FROM users)')
  // migrate old ID_PASS → EMAIL
  db.run('UPDATE categories SET fill_type="EMAIL" WHERE fill_type="ID_PASS"')

  console.log('✅ เชื่อมต่อฐานข้อมูลสำเร็จ')
  return db
}

function save() {
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

module.exports = { initDB, save, getDB: () => db }