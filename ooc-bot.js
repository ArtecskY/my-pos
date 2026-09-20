/**
 * ooc-bot.js — OOC Auto Topup Bot (Puppeteer)
 *
 * Flow: เข้า URL → กดปุ่มเข้าสู่ระบบ → กรอก Email/Password → Login → กดปุ่มจ่าย → บันทึกผล
 *
 * Export: processOocItem(orderItemId, { db, save, email, password })
 * Queue + enqueue managed in index.js
 */

const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
puppeteerExtra.use(StealthPlugin())

const fs   = require('fs')
const path = require('path')

const SCREENSHOT_DIR = path.join(__dirname, 'public', 'bot-screenshots')
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function shot(page, label) {
  try {
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `ooc-${label}.png`), fullPage: false })
  } catch {}
}

// ─── Selectors ───────────────────────────────────────────────────────────────
const SEL = {
  // ขั้นตอน 1: หน้า order — ปุ่ม "เข้าสู่ระบบ"
  loginPageBtn:  'body > div.flex.min-h-dvh.flex-col.justify-between.text-foreground > section > div > div > section.mt-16 > button',

  // ขั้นตอน 2: หน้า Login — ช่อง email, password, ปุ่ม submit
  emailInput:    '#email',
  passwordInput: '#password',
  loginBtn:      '#northbound-login-form > div.mt-8 > button',

  // ขั้นตอน 3: หน้าชำระเงิน — ปุ่มจ่าย (ตั้งค่าแล้ว แต่ยังไม่ใช้งานจนกว่าจะทดสอบครบ)
  payBtn:        '#payment-form > section.mt-8 > button',

  // ขั้นตอน 4: หน้ายืนยัน — TBD
  successEl:     'TODO_SELECTOR_SUCCESS_ELEMENT',
  refNoEl:       'TODO_SELECTOR_REF_NUMBER',
}

const STEP_TIMEOUT = 30000  // ms รอแต่ละ selector
const NAV_TIMEOUT  = 60000

async function runOocBrowser(url, email, password) {
  let browser
  try {
    browser = await puppeteerExtra.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setDefaultNavigationTimeout(NAV_TIMEOUT)
    await page.setDefaultTimeout(STEP_TIMEOUT)

    // ── Step 1: เข้า URL และกดปุ่มเข้าสู่ระบบ ──────────────────
    console.log('[ooc-bot] กำลังเปิด URL:', url)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await sleep(1500)
    await shot(page, 'step1-loaded')

    await page.waitForSelector(SEL.loginPageBtn, { timeout: STEP_TIMEOUT })
    await page.click(SEL.loginPageBtn)
    await sleep(2000)
    await shot(page, 'step1-clicked-login')
    console.log('[ooc-bot] กดปุ่มเข้าสู่ระบบแล้ว')

    // ── Step 2: Login ────────────────────────────────────────────
    await page.waitForSelector(SEL.emailInput, { timeout: STEP_TIMEOUT })
    await page.click(SEL.emailInput)
    await page.type(SEL.emailInput, email, { delay: 60 })
    await page.click(SEL.passwordInput)
    await page.type(SEL.passwordInput, password, { delay: 60 })
    await shot(page, 'step2-login-filled')
    await page.click(SEL.loginBtn)
    await sleep(3000)
    await shot(page, 'step2-login-done')
    console.log('[ooc-bot] Login แล้ว')

    // ── Step 3: กดปุ่มจ่าย ──────────────────────────────────────
    await page.waitForSelector(SEL.payBtn, { timeout: STEP_TIMEOUT })
    await shot(page, 'step3-before-pay')
    await page.click(SEL.payBtn)
    await sleep(3000)
    await shot(page, 'step3-after-pay')
    console.log('[ooc-bot] กดจ่ายแล้ว')

    // ── Step 4: รอผลยืนยัน ──────────────────────────────────────
    let refNo = null
    if (!SEL.successEl.startsWith('TODO')) {
      await page.waitForSelector(SEL.successEl, { timeout: STEP_TIMEOUT })
      if (SEL.refNoEl && !SEL.refNoEl.startsWith('TODO')) {
        try {
          refNo = await page.$eval(SEL.refNoEl, el => el.textContent?.trim())
        } catch {}
      }
      await shot(page, 'step4-success')
    } else {
      // successEl ยังไม่ได้ตั้งค่า — ถือว่าสำเร็จถ้าไม่มี error จากขั้นก่อนหน้า
      await shot(page, 'step4-unknown')
    }
    console.log('[ooc-bot] สำเร็จ refNo:', refNo)
    return { success: true, refNo }

  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

async function processOocItem(orderItemId, { db, save, email, password }) {
  if (!email || !password) throw new Error('ยังไม่ได้ตั้งค่า Email/Password ของ OOC')

  const row = db.exec('SELECT ooc_url, price FROM order_items WHERE id=?', [orderItemId])
  if (!row[0]) throw new Error('ไม่พบ order item')
  const oocUrl   = row[0].values[0][0]
  const itemCost = row[0].values[0][1] ?? 0

  if (!oocUrl) throw new Error('ไม่มี URL สำหรับเติม')

  db.run('UPDATE order_items SET ooc_status=? WHERE id=?', ['processing', orderItemId])
  save()

  let result
  try {
    result = await runOocBrowser(oocUrl, email, password)
  } catch (e) {
    db.run('UPDATE order_items SET ooc_status=?, ooc_error=?, ooc_finished_at=? WHERE id=?',
      ['failed', e.message.slice(0, 200), new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }), orderItemId])
    save()
    throw e
  }

  // ตัด credit (cost ของ item)
  if (itemCost > 0) {
    try {
      db.run("UPDATE ooc_config SET value=CAST(CAST(value AS REAL) - ? AS TEXT) WHERE key='credit'", [itemCost])
    } catch {}
  }

  const errVal = result.refNo ? null : null
  db.run('UPDATE order_items SET ooc_status=?, ooc_error=?, ooc_finished_at=? WHERE id=?',
    ['success', result.refNo || null, new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }), orderItemId])
  save()
  return result
}

module.exports = { processOocItem }
