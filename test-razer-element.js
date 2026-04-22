/**
 * test-razer-element.js
 * รัน: node test-razer-element.js <payment-url>
 * เพื่อ debug ว่า bot อ่าน #orderSummaryOrderTotal ถูกไหม
 */

const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
puppeteerExtra.use(StealthPlugin())

const sleep = ms => new Promise(r => setTimeout(r, ms))

const PAYMENT_URL = process.argv[2] || 'https://pay.gold.razer.com'
const EMAIL    = 'ritamarial5375@hotmail.com'
const PASSWORD = 'h2cBgE81z'

async function fillReact(page, selectors, value) {
  return page.evaluate((sels, val) => {
    for (const sel of sels) {
      const el = document.querySelector(sel)
      if (!el) continue
      el.focus()
      el.dispatchEvent(new Event('focus', { bubbles: true }))
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
        .set.call(el, val)
      el.dispatchEvent(new Event('input',  { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      el.dispatchEvent(new Event('blur',   { bubbles: true }))
      return sel
    }
    return null
  }, selectors, value)
}

async function dumpOrderElements(page, label) {
  console.log(`\n========== ${label} ==========`)
  console.log('URL:', page.url())

  // dump #orderSummaryOrderTotal ใน main frame
  const mainInfo = await page.evaluate(() => {
    const el = document.getElementById('orderSummaryOrderTotal')
    if (!el) return null
    return { rawText: el.textContent, outerHTML: el.outerHTML, parentHTML: el.parentElement?.outerHTML?.slice(0, 400) }
  })
  console.log('[main frame] #orderSummaryOrderTotal:', mainInfo ? JSON.stringify(mainInfo) : 'NOT FOUND')

  // dump ทุก element ที่มี id มี "total" ใน main frame
  const allTotals = await page.evaluate(() => {
    return [...document.querySelectorAll('[id*="total" i], [id*="order" i], [id*="amount" i], [id*="gold" i]')]
      .map(el => ({ id: el.id, tag: el.tagName, text: el.textContent.trim().slice(0, 80), visible: el.offsetParent !== null }))
  })
  console.log('[main frame] elements with total/order/amount/gold in id:', JSON.stringify(allTotals, null, 2))

  // dump iframes
  const frames = page.frames()
  console.log(`[frames] total: ${frames.length}`)
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue
    const furl = frame.url()
    try {
      const fInfo = await frame.evaluate(() => {
        const el = document.getElementById('orderSummaryOrderTotal')
        if (!el) return null
        return { rawText: el.textContent, outerHTML: el.outerHTML }
      })
      if (fInfo) {
        console.log(`[iframe ${furl}] #orderSummaryOrderTotal FOUND:`, JSON.stringify(fInfo))
      } else {
        // ลอง dump totals ใน iframe
        const fTotals = await frame.evaluate(() => {
          return [...document.querySelectorAll('[id*="total" i], [id*="order" i], [id*="amount" i]')]
            .map(el => ({ id: el.id, text: el.textContent.trim().slice(0, 60) }))
        })
        if (fTotals.length > 0)
          console.log(`[iframe ${furl}] total-related elements:`, JSON.stringify(fTotals))
      }
    } catch (e) {
      console.log(`[iframe ${furl}] evaluate error: ${e.message}`)
    }
  }

  // dump หน้าทั้งหมด: text สั้นๆ
  const bodySnip = await page.evaluate(() => document.body?.innerText?.slice(0, 600))
  console.log('[body text snippet]:', bodySnip)
  console.log(`==========================================\n`)
}

;(async () => {
  console.log('=== Razer Element Test ===')
  console.log('URL:', PAYMENT_URL)
  console.log('Email:', EMAIL)

  const browser = await puppeteerExtra.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 900 })

    // ก่อน login
    console.log('\n[1] เปิด URL...')
    await page.goto(PAYMENT_URL, { waitUntil: 'networkidle2', timeout: 30000 }).catch(e => console.log('goto warn:', e.message))
    await sleep(2000)
    await dumpOrderElements(page, 'BEFORE LOGIN')

    // screenshot ก่อน login
    await page.screenshot({ path: 'C:/Users/artec/razer-before-login.png', fullPage: true }).catch(() => {})
    console.log('screenshot saved: C:/Users/artec/razer-before-login.png')

    // dismiss cookie popup
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => /save my preferences/i.test(b.textContent) && b.offsetParent !== null)
      if (btn) { btn.click(); return 'cookie dismissed' }
      return 'no cookie popup'
    }).then(r => console.log('[cookie]', r))

    // login
    console.log('\n[2] กรอก email/password...')
    const emailFilled = await fillReact(page, ['#loginEmail', 'input[type="email"]'], EMAIL)
    console.log('email field:', emailFilled)
    await sleep(200)
    const passFilled = await fillReact(page, ['#loginPassword', 'input[type="password"]'], PASSWORD)
    console.log('password field:', passFilled)
    await sleep(200)

    // กด login
    console.log('[3] กด login...')
    const btnClicked = await page.evaluate(() => {
      const btn = document.getElementById('btn-log-in')
        || [...document.querySelectorAll('button')].find(b => /log.?in/i.test(b.textContent))
      if (btn) { btn.removeAttribute('disabled'); btn.click(); return btn.id || btn.textContent.trim() }
      return null
    })
    console.log('login btn clicked:', btnClicked)

    // รอหลัง login
    console.log('[4] รอ 5s หลัง login...')
    await sleep(5000)
    await dumpOrderElements(page, 'AFTER LOGIN (5s)')

    // ทดสอบ getPageOrderAmount logic ใหม่
    console.log('\n[5] ทดสอบ getPageOrderAmount (poll จนได้ USD)...')
    const maxWait = 15000
    const interval = 500
    const started = Date.now()
    let rawResult = null
    while (Date.now() - started < maxWait) {
      rawResult = await page.evaluate(() => {
        const el = document.getElementById('orderSummaryOrderTotal')
        return el ? el.textContent : null
      })
      const isLocal = /฿|baht|thb|vnd|₫|idr|rp\s|sgd|myr|rm\s|php|₱/i.test(rawResult || '')
      console.log(`  raw="${(rawResult||'').trim()}" isNonUSD=${isLocal}`)
      if (!isLocal) break
      console.log('  → ยังเป็น local currency, poll ต่อ...')
      await sleep(interval)
    }
    const isLocalFinal = /฿|baht|thb|vnd|₫|idr|rp\s|sgd|myr|rm\s|php|₱/i.test(rawResult || '')
    console.log(`\n==> getPageOrderAmount result: raw="${(rawResult||'').trim()}" isNonUSD=${isLocalFinal}`)
    if (!isLocalFinal && rawResult) {
      // parseLocaleNumber inline
      const cleaned = rawResult.replace(/[^0-9.,]/g, '')
      const lastDot = cleaned.lastIndexOf('.'), lastComma = cleaned.lastIndexOf(',')
      let n
      if (lastDot > lastComma) {
        n = cleaned.slice(lastDot+1).length === 3 ? parseFloat(cleaned.replace(/\./g,'')) : parseFloat(cleaned.replace(/,/g,''))
      } else if (lastComma > lastDot) {
        n = parseFloat(cleaned.replace(/\./g,'').replace(',','.'))
      } else { n = parseFloat(cleaned) }
      console.log(`==> parsed USD amount: ${n}`)
    }

    // screenshot หลัง login
    await page.screenshot({ path: 'C:/Users/artec/razer-after-login.png', fullPage: true }).catch(() => {})
    console.log('screenshot saved: C:/Users/artec/razer-after-login.png')

    // dump HTML ทั้งหน้า
    const fullHTML = await page.evaluate(() => document.documentElement.outerHTML)
    require('fs').writeFileSync('C:/Users/artec/razer-page.html', fullHTML)
    console.log('full HTML saved: C:/Users/artec/razer-page.html (size:', fullHTML.length, ')')

  } finally {
    await browser.close()
    console.log('\n=== Done ===')
  }
})()
