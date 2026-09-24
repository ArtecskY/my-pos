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
  // migrate fill_type à¸ˆà¸²à¸ categories à¸ªà¸³à¸«à¸£à¸±à¸š email à¹€à¸à¹ˆà¸²à¸—à¸µà¹ˆà¸¡à¸µ category_id
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
  try { db.run('ALTER TABLE orders ADD COLUMN channel TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN transfer_time2 TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN sort_order INTEGER DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN tw INTEGER DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN initial_credits REAL DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN created_date TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN broken INTEGER DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN manual_data TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN order_note TEXT') } catch (e) { /* column exists */ }
  try { db.run("ALTER TABLE emails ADD COLUMN backup_codes TEXT NOT NULL DEFAULT '[]'") } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE emails ADD COLUMN razer_account_type TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE categories ADD COLUMN razer_account_type TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN razer_url TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN razer_status TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN razer_note TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN razer_started_at TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE orders ADD COLUMN razer_finished_at TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN credits_min REAL') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN credits_max REAL') } catch (e) { /* column exists */ }
  db.run(`CREATE TABLE IF NOT EXISTS razer_account_types (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS email_topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    remaining REAL NOT NULL,
    cost REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`)
  try { db.run('ALTER TABLE order_items ADD COLUMN topup_breakdown TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE categories ADD COLUMN shop_name TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN shop_name TEXT') } catch (e) { /* column exists */ }
  db.run(`CREATE TABLE IF NOT EXISTS email_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT 'bg-slate-100 text-slate-700',
    behavior TEXT NOT NULL DEFAULT 'EMAIL'
  )`)
  try { db.run("ALTER TABLE email_types ADD COLUMN behavior TEXT NOT NULL DEFAULT 'EMAIL'") } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE product_lots ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN uid TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN razer_jobs TEXT') } catch (e) { /* column exists */ }

  // 24Pay API system
  try { db.run('ALTER TABLE categories ADD COLUMN pay24_enabled INTEGER DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE products ADD COLUMN pay24_data TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN pay24_transaction_id TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN pay24_status TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN pay24_result_code TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN pay24_input TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN pay24_finished_at TEXT') } catch (e) { /* column exists */ }
  db.run(`CREATE TABLE IF NOT EXISTS pay24_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)

  // OOC_AUTO system
  try { db.run('ALTER TABLE categories ADD COLUMN ooc_enabled INTEGER DEFAULT 0') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN ooc_url TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN ooc_status TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN ooc_error TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE order_items ADD COLUMN ooc_finished_at TEXT') } catch (e) { /* column exists */ }
  db.run(`CREATE TABLE IF NOT EXISTS ooc_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS ooc_topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    cost REAL NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS ooc_api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    active INTEGER NOT NULL DEFAULT 1
  )`)

  db.run(`CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT,
    transfer_amount REAL,
    reserve_time TEXT,
    channel TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`)
  try { db.run('ALTER TABLE reservations ADD COLUMN note TEXT') } catch (e) { /* column exists */ }

  db.run(`CREATE TABLE IF NOT EXISTS reservation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1
  )`)

  // à¸œà¸¹à¹‰à¹ƒà¸Šà¹‰à¸„à¸™à¹à¸£à¸à¹€à¸›à¹‡à¸™ admin à¹€à¸ªà¸¡à¸­
  db.run('UPDATE users SET is_admin=1 WHERE id=(SELECT MIN(id) FROM users)')

  // User management overhaul: roles, suspend, session invalidation, audit log
  try { db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'") } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE users ADD COLUMN last_login_at TEXT') } catch (e) { /* column exists */ }
  try { db.run('ALTER TABLE users ADD COLUMN created_at TEXT') } catch (e) { /* column exists */ }
  db.run("UPDATE users SET role='superadmin' WHERE is_admin=1")
  db.run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    actor_username TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    created_at TEXT
  )`)

  console.log('âœ… à¹€à¸Šà¸·à¹ˆà¸­à¸¡à¸•à¹ˆà¸­à¸à¸²à¸™à¸‚à¹‰à¸­à¸¡à¸¹à¸¥à¸ªà¸³à¹€à¸£à¹‡à¸ˆ')
  return db
}

// sql.js (WASM) เมื่อหน่วยความจำเต็มจะพังแบบกู้ไม่ได้ (out of memory / memory access out of bounds / malformed schema)
// ตรวจด้วย query เบาๆ — ถ้า throw แปลว่า DB ใน memory เสียแล้ว
function isHealthy() {
  try {
    db.exec('SELECT COUNT(*) FROM sqlite_master')
    return true
  } catch (e) {
    console.error('[db] health check ล้มเหลว:', e?.message || String(e))
    return false
  }
}

// ปิด process ด้วย exit code 1 ให้ Railway เปิดใหม่ (โหลด pos.db ล่าสุดที่ยังดีอยู่)
function exitOnBrokenDB(reason) {
  console.error(`[db] ฐานข้อมูลใน memory เสียหาย (${reason}) — ปิด server เพื่อให้ restart อัตโนมัติ`)
  process.exit(1)
}

function save() {
  // ห้ามเขียน DB ที่เสียทับ pos.db ที่ยังดีอยู่
  if (!isHealthy()) exitOnBrokenDB('save')
  const data = db.export()
  fs.writeFileSync(DB_PATH, Buffer.from(data))
}

module.exports = { initDB, save, getDB: () => db, isHealthy, exitOnBrokenDB }