const { google } = require('googleapis')
const fs = require('fs')
const path = require('path')

const CREDENTIALS_PATH = path.join(__dirname, 'google-credentials.json')

function getClient() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('ไม่พบไฟล์ google-credentials.json')
  }
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH))
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
// unitQty   = จำนวนเหรียญ/ต้นทุน (แสดงในคอลัมน์ที่ 5)
// cost      = ต้นทุน (คอลัมน์ที่ 7)
// totalCost = ต้นทุนรวม (คอลัมน์ที่ 8)
// note      = หมายเหตุ (คอลัมน์ที่ 10)
function computeItemData(item) {
  const { fill_type, quantity, credit_deducted, email_cost,
          lot_cost_used, price_usd_used, cost_used,
          is_bundle, bundle_lot_info } = item

  // Bundle: คำนวณต้นทุนจาก bundle_lot_info
  // component.cost = ต้นทุน USD ต่อ lot, price_usd_used = อัตราแลกเปลี่ยน ฿/$
  if (is_bundle && bundle_lot_info) {
    try {
      const components = JSON.parse(bundle_lot_info)
      const rate = price_usd_used ?? 1
      let totalCost = 0
      const parts = []
      for (const c of components) {
        const compQty = c.qty ?? 1
        // ถ้า component มี price_usd เป็นของตัวเอง (order ใหม่) ใช้ของตัวเอง ไม่งั้นใช้ rate ระดับ order
        const compRate = c.price_usd ?? rate
        const compCostTHB = (c.cost ?? 0) * compRate * compQty
        totalCost += compCostTHB
        if (c.cost) parts.push(`${c.name} ${compCostTHB.toFixed(2)}฿`)
      }
      return {
        unitQty: quantity,
        cost: totalCost,
        totalCost,
        note: parts.join(' | '),
      }
    } catch {}
  }

  if (isEmailLike(fill_type)) {
    // EMAIL / RAZER / custom: ต้นทุน = email_cost, ต้นทุนรวม = credit_deducted × email_cost
    const ec = email_cost ?? 0
    const qty = credit_deducted ?? quantity
    return {
      unitQty: qty,
      cost: ec,
      totalCost: qty * ec,
      note: '',
    }
  }

  if (fill_type === 'ID_PASS') {
    // Stock77: จำนวนเหรียญ = price_usd_used, ต้นทุนรวม = price_usd_used × lot_cost_used
    const coins = price_usd_used ?? quantity
    const unitCost = lot_cost_used ?? 0
    return {
      unitQty: coins,
      cost: unitCost,
      totalCost: coins * unitCost,
      note: '',
    }
  }

  // UID / OTHER_UID: จำนวนเหรียญ = cost_used, ต้นทุนรวม = cost_used
  const uid_qty = cost_used ?? quantity
  return {
    unitQty: uid_qty,
    cost: uid_qty,
    totalCost: uid_qty,
    note: '',
  }
}

function fmt(num) {
  if (num === null || num === undefined || num === '') return ''
  return Number(num).toFixed(2)
}

// export ออเดอร์แบบรายวัน — แต่ละวันไปอยู่ tab ชื่อวันที่พ.ศ.
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

    const rows = []
    for (const o of dayOrders) {
      // รวมต้นทุนทั้งหมดของออเดอร์สำหรับคำนวณกำไร
      let orderTotalCost = 0
      const itemDataList = o.items.map(item => {
        const d = computeItemData(item)
        orderTotalCost += d.totalCost
        return { item, data: d }
      })

      const profit = (o.transfer_amount ?? 0) - orderTotalCost
      const time = toTimeOnly(o.transfer_time)

      // สร้างแถวสำหรับแต่ละ item ในออเดอร์
      itemDataList.forEach(({ item, data }, i) => {
        rows.push([
          i === 0 ? `#${o.order_id}` : '',             // No.
          i === 0 ? (o.transfer_amount ?? '') : '',     // ยอดโอน (฿)
          i === 0 ? time : '',                          // เวลาโอน
          item.product_name,                            // รายการสินค้า
          data.unitQty,                                 // จำนวนเหรียญ/ต้นทุน
          item.email_used || '-',                       // Email ที่ใช้
          fmt(data.cost),                               // ต้นทุน
          fmt(data.totalCost),                          // ต้นทุนรวม
          i === 0 ? fmt(profit) : '',                   // กำไร
          data.note,                                    // หมายเหตุ
        ])
      })
    }

    const range = `'${tabName}'!A1`
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${tabName}'!A:J`,
    })
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['No.', 'ยอดโอน (฿)', 'เวลาโอน', 'รายการสินค้า', 'จำนวนเหรียญ/ต้นทุน', 'Email ที่ใช้', 'ต้นทุน', 'ต้นทุนรวม', 'กำไร', 'หมายเหตุ'],
          ...rows,
        ],
      },
    })
  }

  return Object.keys(byDay).length
}

module.exports = { exportDailyOrders }
