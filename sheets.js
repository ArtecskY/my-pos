const { google } = require('googleapis')
const fs = require('fs')
const path = require('path')

const CREDENTIALS_PATH = path.join(__dirname, 'google-credentials.json')

function getClient() {
  let credentials
  if (process.env.GOOGLE_CREDENTIALS) {
    let raw = process.env.GOOGLE_CREDENTIALS.trim()
    if (!raw.startsWith('{')) raw = Buffer.from(raw, 'base64').toString('utf-8')
    credentials = JSON.parse(raw)
  } else if (fs.existsSync(CREDENTIALS_PATH)) {
    credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH))
  } else {
    throw new Error('ไม่พบ Google credentials (ตั้ง env GOOGLE_CREDENTIALS หรือใส่ google-credentials.json)')
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

// แปลง timestamp → "dd/mm/พ.ศ." สำหรับชื่อ tab
function toThaiDateTab(dateStr) {
  const date = dateStr ? new Date(dateStr.replace(' ', 'T')) : new Date()
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = (date.getFullYear() + 543).toString()
  return `${d}/${m}/${y}`
}

// แปลง timestamp → "HH:MM"
function toTimeOnly(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr.replace(' ', 'T'))
  const h = date.getHours().toString().padStart(2, '0')
  const min = date.getMinutes().toString().padStart(2, '0')
  return `${h}:${min}`
}

// สร้าง sheet tab ถ้ายังไม่มี
async function ensureSheetTab(sheetsClient, spreadsheetId, tabName) {
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId })
  const existing = meta.data.sheets.find(s => s.properties.title === tabName)
  if (existing) return
  await sheetsClient.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }],
    },
  })
}

// ตรวจว่าเป็นประเภทที่ใช้ email (EMAIL, RAZER, custom) หรือเปล่า
function isEmailLike(fill_type) {
  if (!fill_type) return false
  if (['EMAIL', 'OTHER_EMAIL', 'RAZER'].includes(fill_type)) return true
  // custom types (ไม่ใช่ UID, ID_PASS)
  if (!['UID', 'OTHER_UID', 'ID_PASS'].includes(fill_type)) return true
  return false
}

// คำนวณข้อมูลต้นทุนต่อ item → { unitQty, cost, totalCost, note }
// unitQty   = จำนวนเหรียญ/ต้นทุน (แสดงในคอลัมน์)
// cost      = ต้นทุนต่อหน่วย
// totalCost = ต้นทุนรวมของ item นี้
// note      = หมายเหตุ
function computeItemData(item) {
  const { product_name, fill_type, quantity, credit_deducted, email_cost,
          lot_cost_used, price_usd_used, cost_used,
          is_bundle, bundle_lot_info, topup_breakdown } = item

  // Bundle: คำนวณต้นทุนจาก bundle_lot_info (price_usd/qty ถูก enrich จาก products table ใน index.js)
  if (is_bundle && bundle_lot_info) {
    try {
      const components = JSON.parse(bundle_lot_info)
      let totalCoins = 0
      let totalCost = 0
      const parts = []
      for (const c of components) {
        const coins = (c.price_usd ?? 0) * (c.qty ?? 1)
        const compCost = (c.cost ?? 0) * coins
        totalCoins += coins
        totalCost += compCost
        parts.push(`  ${c.name}${c.cost != null ? ` ต้นทุน ${c.cost}` : ''}`)
      }
      return {
        unitQty: totalCoins || quantity,
        cost: totalCost,
        totalCost,
        note: product_name + '\n' + parts.join('\n'),
      }
    } catch {}
  }

  if (isEmailLike(fill_type)) {
    const qty = credit_deducted ?? quantity
    if (topup_breakdown) {
      try {
        const breakdown = JSON.parse(topup_breakdown)
        const totalCost = breakdown.reduce((s, b) => s + (b.amount_used || 0) * (b.cost || 0), 0)
        const avgCost = qty > 0 ? totalCost / qty : (email_cost ?? 0)
        return {
          unitQty: qty,
          cost: avgCost,
          totalCost,
          note: breakdown.map(b => `  ${Number(b.amount_used).toFixed(2)} เครดิต × ฿${b.cost}`).join('\n'),
        }
      } catch {}
    }
    const ec = email_cost ?? 0
    return {
      unitQty: qty,
      cost: ec,
      totalCost: qty * ec,
      note: '',
    }
  }

  if (fill_type === 'ID_PASS') {
    // Stock77: price_usd_used คือราคาต่อหน่วย ต้องคูณ quantity
    const coins = (price_usd_used ?? 0) * quantity
    const unitCost = lot_cost_used ?? 0
    return {
      unitQty: coins,
      cost: unitCost,
      totalCost: coins * unitCost,
      note: '',
    }
  }

  // UID / OTHER_UID: cost_used คือต้นทุนต่อหน่วย, totalCost = cost_used * quantity
  const uid_unitCost = cost_used ?? 0
  const uid_qty = quantity || 1
  return {
    unitQty: uid_qty,
    cost: uid_unitCost,
    totalCost: uid_unitCost * uid_qty,
    note: '',
  }
}

function fmt(num) {
  if (num === null || num === undefined || num === '') return ''
  return Number(num).toFixed(2)
}

// export ออเดอร์แบบรายวัน — แต่ละวันไปอยู่ tab ชื่อวันที่พ.ศ.
// คอลัมน์: No., ยอดโอน (฿), ชื่อเกม, ช่องทาง, เวลาโอน, รายการสินค้า, จำนวนเหรียญ/ต้นทุน, Email ที่ใช้, ต้นทุน, ต้นทุนรวม, กำไร, หมายเหตุ
async function exportDailyOrders(spreadsheetId, orders) {
  const auth = getClient()
  const sheets = google.sheets({ version: 'v4', auth })

  // จัดกลุ่มตามวันที่ (key = ชื่อ tab)
  const byDay = {}
  for (const o of orders) {
    const tabName = toThaiDateTab(o.transfer_time)
    if (!byDay[tabName]) byDay[tabName] = []
    byDay[tabName].push(o)
  }

  for (const [tabName, dayOrders] of Object.entries(byDay)) {
    await ensureSheetTab(sheets, spreadsheetId, tabName)

    // เรียงตามเวลาจากเช้าไปสาย
    dayOrders.sort((a, b) => {
      const ta = (a.transfer_time || a.ts || '').replace(' ', 'T')
      const tb = (b.transfer_time || b.ts || '').replace(' ', 'T')
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })

    const rows = []
    for (const [orderIdx, o] of dayOrders.entries()) {
      const itemDataList = o.items.map(item => {
        const d = computeItemData(item)
        return { item, data: d }
      })

      const time = toTimeOnly(o.transfer_time)

      // สร้างแถวสำหรับแต่ละ item — ยอดโอนและกำไรคิดแยกต่อแพ็ก
      itemDataList.forEach(({ item, data }, i) => {
        // ยอดโอนต่อ item = ราคาขาย (oi.price * quantity)
        // ถ้า item ไม่มี price (manual order หรือ price=0) ใช้ transfer_amount ทั้งออเดอร์
        const itemPrice = item.price != null && Number(item.price) > 0
          ? Number(item.price) * (Number(item.quantity) || 1)
          : (i === 0 ? (o.transfer_amount ?? '') : '')

        // กำไรต่อ item = ยอดโอน - ต้นทุนรวม
        const itemProfit = item.price != null && Number(item.price) > 0
          ? Number(item.price) * (Number(item.quantity) || 1) - data.totalCost
          : (i === 0 ? (o.transfer_amount ?? 0) - data.totalCost : '')

        rows.push([
          i === 0 ? `#${orderIdx + 1}` : '',           // No.
          itemPrice,                                     // ยอดโอน (฿) — แยกต่อแพ็ก
          i === 0 ? (o.category_name || '') : '',       // ชื่อเกม
          i === 0 ? (o.channel || '') : '',             // ช่องทาง (ระหว่างชื่อเกมกับเวลาโอน)
          i === 0 ? time : '',                          // เวลาโอน
          item.product_name,                            // รายการสินค้า
          data.unitQty,                                 // จำนวนเหรียญ/ต้นทุน
          item.email_used || '-',                       // Email ที่ใช้
          fmt(data.cost),                               // ต้นทุน
          fmt(data.totalCost),                          // ต้นทุนรวม
          item.price != null && Number(item.price) > 0 ? fmt(itemProfit) : (i === 0 ? fmt(itemProfit) : ''), // กำไรต่อแพ็ก
          data.note,                                    // หมายเหตุ
        ])
      })
    }

    const range = `'${tabName}'!A1`
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${tabName}'!A:L`,
    })
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['No.', 'ยอดโอน (฿)', 'ชื่อเกม', 'ช่องทาง', 'เวลาโอน', 'รายการสินค้า', 'จำนวนเหรียญ/ต้นทุน', 'Email ที่ใช้', 'ต้นทุน', 'ต้นทุนรวม', 'กำไร', 'หมายเหตุ'],
          ...rows,
        ],
      },
    })
  }

  return Object.keys(byDay).length
}

module.exports = { exportDailyOrders }
