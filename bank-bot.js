/**
 * bank-bot.js — KBank KBiz Persistent Session Bot
 *
 * Export:
 *   loginKBiz({ username, password })  — เปิด browser, login, เริ่ม keep-alive
 *   snapshotKBiz({ screenshotDir })    — กดค้นหา + screenshot (ใช้ session เดิม)
 *   getSessionStatus()                 — คืน { active: bool }
 *   closeKBiz()                        — ปิด browser
 */
const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteerExtra.use(StealthPlugin())
const path = require('path')

const KBIZ_URL = 'https://kbiz.kasikornbank.com/authen/'
const delay = ms => new Promise(r => setTimeout(r, ms))
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

// ── Global state ──────────────────────────────────────────────
let _browser = null
let _page    = null
let _keepAliveTimer = null

function isAlive() {
  try {
    return !!_browser && !!_page && !_page.isClosed()
  } catch { return false }
}

// ── Keep-Alive ────────────────────────────────────────────────
function stopKeepAlive() {
  if (_keepAliveTimer) { clearTimeout(_keepAliveTimer); _keepAliveTimer = null }
}

function startKeepAlive() {
  stopKeepAlive()
  async function tick() {
    if (!isAlive()) return
    try {
      const action = rand(0, 4)
      if (action === 0) {
        await _page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 80) + 20))
        await delay(rand(300, 700))
        await _page.evaluate(() => window.scrollBy(0, -(Math.floor(Math.random() * 60) + 10)))
      } else if (action === 1) {
        await _page.mouse.move(rand(200, 1100), rand(150, 650), { steps: rand(5, 12) })
      } else if (action === 2) {
        await _page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      } else if (action === 3) {
        const cx = rand(350, 950), cy = rand(200, 600)
        await _page.mouse.move(cx, cy, { steps: 5 })
        await delay(200)
        await _page.mouse.move(cx + rand(-25, 25), cy + rand(-15, 15), { steps: 4 })
      }
      // action 4 = พัก
    } catch {}
    _keepAliveTimer = setTimeout(tick, rand(12000, 35000))
  }
  _keepAliveTimer = setTimeout(tick, rand(8000, 18000))
}

// ── ตรวจสถานะหน้า ─────────────────────────────────────────────
async function detectState() {
  if (!isAlive()) return 'dead'
  try {
    const text = await _page.evaluate(() => document.body?.innerText || '')
    if (text.includes('วันที่ทำรายการ') || text.includes('ยอดคงเหลือ')) return 'account'
    const frames = _page.frames()
    if (frames.some(f => f.url().includes('recent-tr'))) return 'account'
    if (text.includes('ดูรายละเอียดบัญชีเพิ่มเติม')) return 'dashboard'
    if (text.includes('Username') || text.includes('เข้าสู่ระบบ') || _page.url().includes('login')) return 'login'
    return 'unknown'
  } catch { return 'dead' }
}

// ── Login flow ────────────────────────────────────────────────
async function doLogin(username, password, log) {
  log.push('🌐 เปิด KBank KBiz...')
  await _page.goto(KBIZ_URL, { waitUntil: 'load', timeout: 60000 })
  await delay(3000)

  for (const sel of ['#Username', '#username', 'input[name="Username"]', 'input[type="text"]']) {
    try {
      const ok = await _page.evaluate(s => { const e = document.querySelector(s); return !!(e && e.offsetWidth > 0) }, sel)
      if (!ok) continue
      await _page.click(sel, { clickCount: 3 })
      await _page.type(sel, username, { delay: 60 })
      log.push(`✅ Username กรอกแล้ว`); break
    } catch {}
  }
  for (const sel of ['#Password', '#password', 'input[type="password"]']) {
    try {
      const el = await _page.$(sel); if (!el) continue
      await _page.click(sel, { clickCount: 3 })
      await _page.type(sel, password, { delay: 60 })
      log.push(`✅ Password กรอกแล้ว`); break
    } catch {}
  }
  await delay(500)
  await _page.keyboard.press('Enter')
  log.push('✅ กด Enter')
  log.push('⏳ รอ Dashboard... (สูงสุด 5 นาที)')
  log.push('👤 กรุณาทำ reCAPTCHA → กด Login → รอ OTP ถ้ามี')

  await _page.waitForFunction(
    () => (document.body?.innerText || '').includes('ดูรายละเอียดบัญชีเพิ่มเติม'),
    { timeout: 300000 }
  ).catch(() => { throw new Error('Timeout — Login ไม่สำเร็จ') })

  await delay(1000)
  log.push('✅ Dashboard โหลดแล้ว')
}

async function goToAccountPage(log) {
  const state = await detectState()
  if (state === 'dashboard') {
    log.push('🖱️ กด "ดูรายละเอียดบัญชีเพิ่มเติม"...')
    await clickLeafText('ดูรายละเอียดบัญชีเพิ่มเติม')
    await delay(2000)
    log.push('✅ เข้าหน้าบัญชีแล้ว')
  }
}

// ── helper: คลิก a.searchBtn ในทุก frame (Angular-safe) ─────────
async function clickSearchBtn(log) {
  const frames = _page.frames()
  log.push(`🔎 หา a.searchBtn ใน ${frames.length} frame(s)...`)

  for (const frame of frames) {
    try {
      const elHandle = await frame.$('a.searchBtn').catch(() => null)
      if (!elHandle) continue

      const box = await elHandle.boundingBox().catch(() => null)
      if (!box || box.width === 0) { log.push(`  ↳ พบ searchBtn ใน ${frame.url().slice(0, 60)} แต่ไม่มี bounding box`); continue }

      log.push(`✅ พบ a.searchBtn ใน ${frame.url().slice(0, 70)} — กำลังคลิก...`)

      // dispatch events ใน frame ก่อน (Angular zone)
      await frame.evaluate(() => {
        const el = document.querySelector('a.searchBtn')
        if (!el) return
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
        el.dispatchEvent(new MouseEvent('mousedown',  { bubbles: true, cancelable: true }))
        el.dispatchEvent(new MouseEvent('mouseup',    { bubbles: true, cancelable: true }))
        el.dispatchEvent(new MouseEvent('click',      { bubbles: true, cancelable: true }))
      }).catch(() => {})

      // ใช้ elementHandle.click() — Puppeteer คำนวณ coordinate ข้าม frame ให้เอง
      await elHandle.click({ delay: 80 }).catch(() => {})
      await elHandle.dispose()
      return true
    } catch {}
  }
  log.push('⚠️ ไม่พบ a.searchBtn ในทุก frame')
  return false
}

// ── helper: รอข้อความในทุก frame ──────────────────────────────
async function waitForTextAnyFrame(texts, timeoutMs, log) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const frame of _page.frames()) {
      try {
        const body = await frame.evaluate(() => document.body?.innerText || '').catch(() => '')
        const hits = texts.filter(t => body.includes(t))
        if (hits.length >= 2) {
          log.push(`✅ พบข้อความในตาราง: ${hits.join(', ')} (frame: ${frame.url().slice(0, 60)})`)
          return frame
        }
      } catch {}
    }
    await delay(800)
  }
  return null
}

// ── กดค้นหา + Screenshot ──────────────────────────────────────
async function clickSearchAndScreenshot(screenshotDir, log) {
  // log iframes ที่มีอยู่ตอนนี้
  const frameUrls = _page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank')
  log.push(`📋 Frames: ${frameUrls.length > 0 ? frameUrls.map(u => u.slice(0, 80)).join(' | ') : '(ไม่มี)'}`)

  // รอให้ a.searchBtn โหลดก่อน แล้วค่อยกด
  log.push('⏳ รอปุ่มค้นหาโหลด...')
  let searchClicked = false
  for (let attempt = 0; attempt < 15 && !searchClicked; attempt++) {
    await delay(1000)
    searchClicked = await clickSearchBtn(log)
  }
  if (!searchClicked) log.push('⚠️ ไม่พบ a.searchBtn — จะรอตารางโหลดเองหรือ screenshot ต่อ')

  // รอตารางในทุก frame
  log.push('⏳ รอตาราง...')
  const tableKeywords = ['วันที่ทำรายการ', 'ฝาก', 'ถอน', 'ยอดคงเหลือ']
  const tableFrame = await waitForTextAnyFrame(tableKeywords, 30000, log)

  await delay(1000)
  const fileName = `bank_${Date.now()}.png`
  const filePath = path.join(screenshotDir, fileName)

  if (tableFrame && tableFrame !== _page.mainFrame()) {
    // ตารางอยู่ใน iframe — หา iframe element แล้ว screenshot ตัวมันเลย
    log.push('📸 Screenshot iframe...')
    const iframes = await _page.$$('iframe')
    let shot = false
    for (const iframeEl of iframes) {
      try {
        const f = await iframeEl.contentFrame()
        if (f === tableFrame) {
          await iframeEl.screenshot({ path: filePath })
          shot = true; break
        }
      } catch {}
    }
    if (!shot) {
      log.push('  ↳ หา iframe element ไม่ได้ — screenshot ทั้งหน้าแทน')
      await _page.screenshot({ path: filePath, fullPage: false })
    }
  } else {
    if (!tableFrame) log.push('⚠️ ไม่พบตารางใน 30 วิ — Screenshot ทั้งหน้า')
    await _page.screenshot({ path: filePath, fullPage: false })
  }

  log.push('📸 Screenshot สำเร็จ')
  return { filePath, fileName }
}

// ── Public API ────────────────────────────────────────────────

/**
 * เปิด browser ใหม่ + Login + นำทางไปหน้าบัญชี + เริ่ม keep-alive
 * เรียกจากปุ่ม "Login"
 */
async function loginKBiz({ username, password }) {
  stopKeepAlive()
  // ปิด browser เก่าถ้ามี
  if (_browser) { try { await _browser.close() } catch {} }
  _browser = null; _page = null

  const log = []
  log.push('🚀 เปิด Browser...')
  _browser = await puppeteerExtra.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--window-size=1440,900',
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  })
  _page = await _browser.newPage()
  await _page.setViewport({ width: 1440, height: 900 })

  // ถ้า browser ถูกปิดภายนอก
  _browser.on('disconnected', () => {
    stopKeepAlive()
    _browser = null; _page = null
  })

  await doLogin(username, password, log)
  await goToAccountPage(log)

  log.push('🟢 Session พร้อมใช้งาน — คาหน้าต่างไว้แล้ว')
  startKeepAlive()
  return { log }
}

/**
 * กดค้นหา + screenshot โดยใช้ session เดิม
 * เรียกจากปุ่ม "อัพเดท"
 */
async function snapshotKBiz({ screenshotDir }) {
  if (!isAlive()) throw Object.assign(new Error('ยังไม่ได้ Login หรือ Session หมดแล้ว'), { log: [] })

  stopKeepAlive()
  const log = []

  const state = await detectState()
  log.push(`📍 สถานะ: ${state}`)

  try {
    if (state === 'login' || state === 'unknown') {
      throw Object.assign(new Error('Session หมดแล้ว กรุณากดปุ่ม Login ใหม่'), { log })
    }
    if (state === 'dashboard') await goToAccountPage(log)

    const { filePath, fileName } = await clickSearchAndScreenshot(screenshotDir, log)
    log.push('🏁 เสร็จสิ้น')
    startKeepAlive()
    return { filePath, fileName, log }
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') {
      err.message = 'Session หมดแล้ว กรุณากดปุ่ม Login ใหม่'
    }
    startKeepAlive()
    const e = new Error(err.message)
    e.log = err.log || log
    throw e
  }
}

function getSessionStatus() {
  return { active: isAlive() }
}

async function closeKBiz() {
  stopKeepAlive()
  if (_browser) { try { await _browser.close() } catch {} }
  _browser = null; _page = null
}

async function clickLeafText(text) {
  const coords = await _page.evaluate((txt) => {
    for (const el of document.querySelectorAll('*')) {
      if (el.offsetWidth === 0 || el.offsetHeight === 0) continue
      if (!(el.innerText || el.textContent || '').includes(txt)) continue
      if (Array.from(el.children).some(c => (c.innerText || c.textContent || '').includes(txt))) continue
      el.scrollIntoView({ behavior: 'instant', block: 'center' })
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }
    return null
  }, text)
  if (!coords) return false
  await delay(300)
  await _page.mouse.click(coords.x, coords.y)
  return true
}

module.exports = { loginKBiz, snapshotKBiz, getSessionStatus, closeKBiz }
