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

// แปลง "2026-02-28T14:30" หรือ "2026-02-28 14:30" → "28/02/2569" (พ.ศ.)
function toThaiDateTab(dateStr) {
  const date = dateStr ? new Date(dateStr.replace(' ', 'T')) : new Date()
  const d = date.getDate().toString().padStart(2, '0')
  const m = (date.getMonth() + 1).toString().padStart(2, '0')
  const y = (date.getFullYear() + 543).toString()
  return `${d}/${m}/${y}`
}

// แปลง "2026-02-28T14:30" → "14:30"
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

    const rows = dayOrders.map(o => [
      `#${o.order_id}`,
      o.transfer_amount ?? '',
      toTimeOnly(o.transfer_time),
      o.products,
    ])

    // ชื่อ tab มี "/" ต้องใส่ single quote ใน range notation
    const range = `'${tabName}'!A1`

    // clear ก่อนแล้ว write ใหม่ ป้องกัน duplicate
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `'${tabName}'!A:D`,
    })

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [
          ['เลขที่', 'ยอดโอน (฿)', 'เวลาโอน', 'รายการสินค้า'],
          ...rows,
        ],
      },
    })
  }

  return Object.keys(byDay).length
}

module.exports = { exportDailyOrders }
