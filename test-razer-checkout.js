/**
 * test-razer-checkout.js  — loop 2 รอบ headless:false หยุดที่ Backup Codes
 * รัน: node test-razer-checkout.js
 */

const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
puppeteerExtra.use(StealthPlugin())

const sleep = ms => new Promise(r => setTimeout(r, ms))

const PAYMENT_URL = 'https://pay.gold.razer.com/order/bW9lTWZjQTJMZjFBY0FJdzYwRXByRmcxdGVqNVhySXRNZVo3TkM5S2NZQT0'

const ACCOUNTS = [
  { email: 'funn1que.zxc@gmail.com', password: '014785920Zxc' },
  // เพิ่ม account ที่ 2 ที่นี่ถ้ามี:
  // { email: 'account2@gmail.com', password: 'password2' },
  { email: 'funn1que.zxc@gmail.com', password: '014785920Zxc' },  // วน account เดิมรอบ 2
]

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

function isNonUsdCurrency(raw) {
  return /฿|baht|thb|vnd|₫|idr|rp\s|sgd|myr|rm\s|php|₱/i.test(raw)
}

function parseLocaleNumber(str) {
  const cleaned = str.replace(/[^0-9.,]/g, '')
  if (!cleaned) return null
  const lastDot   = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  let n
  if (lastDot > lastComma) {
    n = cleaned.slice(lastDot + 1).length === 3
      ? parseFloat(cleaned.replace(/\./g, ''))
      : parseFloat(cleaned.replace(/,/g, ''))
  } else if (lastComma > lastDot) {
    n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  } else {
    n = parseFloat(cleaned)
  }
  return isFinite(n) && n > 0 ? n : null
}

async function runRound(browser, cdpClient, acc, roundNum) {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  รอบที่ ${roundNum}: ${acc.email}`)
  console.log('═'.repeat(60))

  // clear cookies ระหว่างรอบ
  try { await cdpClient.send('Network.clearBrowserCookies') } catch {}

  const page = await browser.newPage()
  try {
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    // ── Step 0: เปิด URL ────────────────────────────────────
    console.log(`\n[${roundNum}] Step 0: เปิด URL...`)
    await page.goto(PAYMENT_URL, { waitUntil: 'networkidle2', timeout: 30000 })
      .catch(e => console.warn('goto:', e.message))
    await sleep(1500)

    // dismiss cookie popup
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find(b => /save my preferences|accept all|accept cookies/i.test(b.textContent) && b.offsetParent !== null)
      if (btn) btn.click()
    })
    await sleep(500)

    const preLoginRaw = await page.evaluate(() =>
      document.getElementById('orderSummaryOrderTotal')?.textContent?.trim()
    )
    console.log(`[${roundNum}] orderSummaryOrderTotal before login: "${preLoginRaw}"`)

    // ── Step 1: Login ────────────────────────────────────────
    console.log(`\n[${roundNum}] Step 1: Login (${acc.email})...`)
    await page.waitForSelector('input[type="email"]', { timeout: 5000 }).catch(() => {})

    await fillReact(page, ['#loginEmail', 'input[type="email"]'], acc.email)
    await sleep(200)
    await fillReact(page, ['#loginPassword', 'input[type="password"]'], acc.password)
    await sleep(200)

    await page.waitForFunction(
      () => {
        const btn = document.getElementById('btn-log-in')
          || [...document.querySelectorAll('button')].find(b => /log.?in/i.test(b.textContent))
        return btn && !btn.disabled
      },
      { timeout: 8000 }
    ).catch(() => {})

    const loginClicked = await page.evaluate(() => {
      const btn = document.getElementById('btn-log-in')
        || [...document.querySelectorAll('button')].find(b => /log.?in/i.test(b.textContent))
      if (btn) { btn.removeAttribute('disabled'); btn.click(); return btn.id || btn.textContent.trim() }
      return null
    })
    console.log(`[${roundNum}] login btn:`, loginClicked)

    try {
      await page.waitForSelector('#userTotalGold', { timeout: 15000 })
      const gold = await page.evaluate(() =>
        document.getElementById('userTotalGold')?.textContent?.trim()
      )
      console.log(`[${roundNum}] ✅ Login สำเร็จ — userTotalGold: ${gold}`)
    } catch {
      console.error(`[${roundNum}] ❌ #userTotalGold ไม่ปรากฏใน 15s`)
      return
    }

    // ── Step 2: รอ USD amount ────────────────────────────────
    console.log(`\n[${roundNum}] Step 2: รอ USD amount...`)
    let goldAmount = null
    const pollStart = Date.now()
    while (Date.now() - pollStart < 15000) {
      const raw = await page.evaluate(() =>
        document.getElementById('orderSummaryOrderTotal')?.textContent
      )
      const isLocal = isNonUsdCurrency(raw || '')
      console.log(`  raw="${raw?.trim()}" isLocal=${isLocal}`)
      if (!isLocal && raw) {
        goldAmount = parseLocaleNumber(raw)
        console.log(`[${roundNum}] ✅ Gold amount = ${goldAmount} USD`)
        break
      }
      await sleep(500)
    }
    if (goldAmount == null) console.warn(`[${roundNum}] ⚠️ อ่าน USD amount ไม่ได้`)

    // ── Step 3: Proceed to Checkout ─────────────────────────
    console.log(`\n[${roundNum}] Step 3: กด Proceed to Checkout...`)
    await page.waitForFunction(
      () => [...document.querySelectorAll('button,[role="button"],a')]
        .some(b => /proceed|pay now|checkout|reload to checkout|ดำเนินการต่อ/i.test(b.textContent) && b.offsetParent !== null),
      { timeout: 8000 }
    ).catch(() => {})

    const s3 = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button,[role="button"],a')]
        .find(e => /proceed|pay now|checkout|reload to checkout|ดำเนินการต่อ/i.test(e.textContent) && e.offsetParent !== null)
      if (el) { el.click(); return el.textContent.trim() }
      return null
    })
    console.log(`[${roundNum}] Step 3:`, s3 ? `✅ "${s3}"` : '❌ ไม่พบปุ่ม')
    await sleep(2000)

    // ── Step 4: Edit ─────────────────────────────────────────
    console.log(`\n[${roundNum}] Step 4: กด Edit...`)
    await page.waitForFunction(
      () => [...document.querySelectorAll('button,a,[role="button"]')]
        .some(b => /^edit$|^แก้ไข$/i.test(b.textContent.trim())),
      { timeout: 12000 }
    ).catch(() => {})

    const s4 = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button,a,[role="button"]')]
        .find(b => /^edit$|^แก้ไข$/i.test(b.textContent.trim()))
      if (el) { el.scrollIntoView(); el.click(); return el.textContent.trim() }
      return null
    })
    console.log(`[${roundNum}] Step 4:`, s4 ? `✅ "${s4}"` : '❌ ไม่พบปุ่ม')
    await sleep(2000)

    // ── Step 5: Choose a different method ───────────────────
    console.log(`\n[${roundNum}] Step 5: กด Choose a different method...`)
    let s5 = null
    for (let i = 0; i < 25; i++) {
      for (const ctx of [page, ...page.frames().filter(f => f !== page.mainFrame())]) {
        try {
          s5 = await ctx.evaluate(() => {
            const el = [...document.querySelectorAll('button,a,[role="button"]')]
              .find(b => /different|change.*method|เลือกวิธีการอื่น/i.test(b.textContent) && b.offsetParent !== null)
            if (el) { el.click(); return el.textContent.trim() }
            return null
          })
          if (s5) break
        } catch {}
      }
      if (s5) break
      if (i % 5 === 0) console.log(`  รอ... ${i}s`)
      await sleep(1000)
    }
    console.log(`[${roundNum}] Step 5:`, s5 ? `✅ "${s5}"` : '❌ ไม่พบปุ่ม')
    await sleep(1500)

    // ── Step 6: Backup Codes ─────────────────────────────────
    console.log(`\n[${roundNum}] Step 6: กด Backup Codes...`)
    let s6 = null
    for (let i = 0; i < 15; i++) {
      for (const ctx of [page, ...page.frames().filter(f => f !== page.mainFrame())]) {
        try {
          s6 = await ctx.evaluate(() => {
            const el = [...document.querySelectorAll('button,a,[role="button"]')]
              .find(b => /backup|รหัสสำรอง/i.test(b.textContent) && b.offsetParent !== null)
            if (el) { el.click(); return el.textContent.trim() }
            return null
          })
          if (s6) break
        } catch {}
      }
      if (s6) break
      if (i % 3 === 0) console.log(`  รอ... ${i}s`)
      await sleep(1000)
    }
    console.log(`[${roundNum}] Step 6:`, s6 ? `✅ "${s6}"` : '❌ ไม่พบปุ่ม')

    // ── ตรวจ OTP input ────────────────────────────────────────
    let otpFound = false
    for (const ctx of [page, ...page.frames()]) {
      try {
        if (await ctx.evaluate(() => !!document.querySelector('input[id^="otp-input-"]'))) {
          otpFound = true; break
        }
      } catch {}
    }
    console.log(`[${roundNum}] OTP input visible: ${otpFound}`)

    console.log(`\n[${roundNum}] ✅ ถึง Backup Codes — หยุด 30s ก่อนรอบถัดไป`)
    await sleep(30000)

  } finally {
    await page.close()
  }
}

;(async () => {
  console.log('=== Razer Bot Loop Test — headless:false ===')
  console.log(`URL: ${PAYMENT_URL}`)
  console.log(`จำนวน account: ${ACCOUNTS.length} รอบ\n`)

  const browser = await puppeteerExtra.launch({
    headless: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--lang=en-US',
      '--accept-lang=en-US,en',
    ],
    defaultViewport: { width: 1280, height: 900 },
  })

  const cdpClient = await browser.target().createCDPSession()

  try {
    for (let i = 0; i < ACCOUNTS.length; i++) {
      await runRound(browser, cdpClient, ACCOUNTS[i], i + 1)
    }
    console.log('\n=== ✅ ครบทุกรอบแล้ว — ปิด browser ใน 5s ===')
    await sleep(5000)
  } finally {
    await browser.close()
    console.log('=== Done ===')
  }
})()
