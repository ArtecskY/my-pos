const fs = require('fs')
const initSqlJs = require('sql.js')

let db

async function initDB() {
  const SQL = await initSqlJs()
  
  if (fs.existsSync('pos.db')) {
    const fileBuffer = fs.readFileSync('pos.db')
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

  try { db.run('ALTER TABLE products ADD COLUMN image TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN category_id INTEGER') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN transfer_amount REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN transfer_time TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE categories ADD COLUMN fill_type TEXT DEFAULT "UID"') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN note TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN cost REAL DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN credit_deducted REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN email_id_used INTEGER') } catch (e) { /* column exists */ }
  // migrate old ID_PASS → EMAIL
  db.run('UPDATE categories SET fill_type="EMAIL" WHERE fill_type="ID_PASS"')

  console.log('✅ เชื่อมต่อฐานข้อมูลสำเร็จ')
  return db
}

function save() {
  const data = db.export()
  fs.writeFileSync('pos.db', Buffer.from(data))
}

module.exports = { initDB, save, getDB: () => db }