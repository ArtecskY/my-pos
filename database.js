const Database = require('better-sqlite3')
const db = new Database('pos.db')

// ตารางสินค้า
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    stock INTEGER NOT NULL
  )
`)

// ตารางออเดอร์
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    total REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )
`)

// ตารางรายการสินค้าในออเดอร์
db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL
  )
`)

console.log('✅ เชื่อมต่อฐานข้อมูลสำเร็จ')

// ตารางผู้ใช้
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  )
`)

module.exports = db