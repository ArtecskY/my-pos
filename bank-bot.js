/**
 * bank-bot.js — Bot ดึงข้อมูลธนาคาร KBank KBiz
 */
const puppeteer = require('puppeteer')
const path = require('path')

const KBIZ_URL = 'https://kbiz.kasikornbank.com/'
const delay = ms => new Promise(r => setTimeout(r, ms))

async function snapshotKBiz({ username, password, screenshotDir }) {
  const log = []
  let browser = null

  try {
    log.push('🚀 เปิด Browser...')
    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ['--window-size=1440,900', '--disable-blink-features=AutomationControlled', '--start-maximized'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    })

    // ── 1. Login ──────────────────────────────────────────────
    log.push('🌐 เปิด KBank KBiz...')
    await page.goto(KBIZ_URL, { waitUntil: 'networkidle2', timeout: 30000 })
    await delay(3000)

    for (const sel of ['#Username', '#username', 'input[name="Username"]', 'input[type="text"]']) {
      try {
        const ok = await page.evaluate(s => { const e = document.querySelector(s); return e && e.offsetWidth > 0 }, sel)
        if (!ok) continue
        await page.click(sel, { clickCount: 3 })
        await page.type(sel, username, { delay: 60 })
        log.push(`✅ Username → ${sel}`); break
      } catch {}
    }
    for (const sel of ['#Password', '#password', 'input[type="password"]']) {
      try {
        const el = await page.$(sel); if (!el) continue
        await page.click(sel, { clickCount: 3 })
        await page.type(sel, password, { delay: 60 })
        log.push(`✅ Password → ${sel}`); break
      } catch {}
    }
    await delay(500)
    await page.keyboard.press('Enter')
    log.push('✅ กด Enter → Login')
    log.push('⏳ รอ Login + OTP (ถ้ามี)... (สูงสุด 5 นาที)')
    log.push('👤 กรุณาทำ: reCAPTCHA → กด Login → รอ Dashboard')

    await page.waitForFunction(
      () => (document.body?.innerText || '').includes('ดูรายละเอียดบัญชีเพิ่มเติม'),
      { timeout: 300000 }
    ).catch(() => { throw new Error('Timeout — Login ไม่สำเร็จ') })

    await delay(1000)
    log.push('✅ Dashboard โหลดแล้ว')

    // ── 2. กด ดูรายละเอียดบัญชีเพิ่มเติม ────────────────────
    log.push('🖱️ กด "ดูรายละเอียดบัญชีเพิ่มเติม >"...')
    await clickLeafText(page, 'ดูรายละเอียดบัญชีเพิ่มเติม')
    log.push('✅ คลิกสำเร็จ')

    // ── 3. กด a.searchBtn ─────────────────────────────────────
    log.push('🔍 กด "ค้นหา"...')
    let searchClicked = false
    for (let i = 0; i < 20; i++) {
      await delay(500)
      const recentFrame = page.frames().find(f => f.url().includes('recent-tr'))
      if (!recentFrame) continue
      const coords = await recentFrame.evaluate(() => {
        const el = document.querySelector('a.searchBtn')
        if (!el || el.offsetWidth === 0) return null
        el.click()
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }).catch(() => null)
      if (coords) {
        await delay(200)
        await page.mouse.click(coords.x, coords.y)
        log.push('✅ คลิก "ค้นหา" สำเร็จ')
        searchClicked = true; break
      }
    }
    if (!searchClicked) log.push('⚠️ กด ค้นหา ไม่ได้')

    // ── 4. รอตาราง ─────────────────────────────────────────
    log.push('⏳ รอตารางโหลด...')
    await page.waitForFunction(
      () => ['วันที่ทำรายการ', 'ฝาก', 'ถอน'].filter(k => (document.body?.innerText || '').includes(k)).length >= 2,
      { timeout: 180000 }
    ).catch(() => { throw new Error('Timeout — ไม่พบตารางรายการ') })

    await delay(1500)
    log.push('✅ พบตารางรายการ!')

    // ── 5. Screenshot ──────────────────────────────────────────
    const fileName = `bank_${Date.now()}.png`
    const filePath = path.join(screenshotDir, fileName)

    const tableAbsY = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        if (!(node.textContent || '').includes('วันที่ทำรายการ')) continue
        let el = node.parentElement
        while (el && el !== document.body) {
          if (el.offsetWidth > 400) return window.scrollY + el.getBoundingClientRect().top
          el = el.parentElement
        }
      }
      return null
    })

    if (tableAbsY !== null) {
      await page.evaluate(y => window.scrollTo({ top: y - 5, behavior: 'instant' }), tableAbsY)
      await delay(500)
    }
    await page.screenshot({ path: filePath, fullPage: false })
    log.push('📸 Screenshot สำเร็จ')
    log.push('🏁 เสร็จสิ้น!')
    return { filePath, fileName, log }

  } catch (err) {
    log.push(`❌ ${err.message}`)
    const error = new Error(err.message)
    error.log = log
    throw error
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

async function clickLeafText(page, text) {
  const coords = await page.evaluate((txt) => {
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
  await page.mouse.click(coords.x, coords.y)
  return true
}

module.exports = { snapshotKBiz }
