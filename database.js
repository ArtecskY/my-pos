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

  console.log('✅ เชื่อมต่อฐานข้อมูลสำเร็จ')
  return db
}

function save() {
  const data = db.export()
  fs.writeFileSync('pos.db', Buffer.from(data))
}

module.exports = { initDB, save, getDB: () => db }