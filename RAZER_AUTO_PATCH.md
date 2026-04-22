# Razer Auto System — Patch Instructions for Claude Code

อ่านไฟล์นี้แล้วนำ Razer Auto system ไปติดตั้งในโปรเจคนี้ตามขั้นตอนด้านล่างทั้งหมด

---

## 1. ติดตั้ง Dependencies

เพิ่มใน `package.json` ใน `optionalDependencies`:

```json
"puppeteer-extra": "^3.3.6",
"puppeteer-extra-plugin-stealth": "^2.11.2"
```

รันคำสั่ง:
```bash
npm install puppeteer-extra puppeteer-extra-plugin-stealth --save-optional
```

---

## 2. สร้างไฟล์ `razer-bot.js` (ไฟล์ใหม่ ที่ root ของโปรเจค)

```js
/**
 * razer-bot.js — Razer Gold Auto Topup Bot
 *
 * Export:
 *   runRazerOrder(orderId, order, ctx)           — entry point หลัก, ยิงจาก POST /orders
 *   regenAccountBackupCodes(account, loadFn, saveFn) — regen backup codes (admin trigger)
 *
 * order = { gameId, packageId, userFields: { urlLink } }
 * ctx   = { loadRazerAccounts, saveRazerAccounts, db, save }
 */

const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
puppeteerExtra.use(StealthPlugin())

const VALID_PAY_ORIGIN = 'https://pay.gold.razer.com'
const sleep = ms => new Promise(r => setTimeout(r, ms))

function validateAmount(goldAmount, pkg) {
  if (pkg.credits_min == null && pkg.credits_max == null) return { valid: true }
  if (pkg.credits_max != null && goldAmount > pkg.credits_max)
    return { valid: false, reason: `ยอด Gold ${goldAmount} เกิน Max ${pkg.credits_max}` }
  if (pkg.credits_min != null && goldAmount < pkg.credits_min)
    return { valid: false, reason: `ยอด Gold ${goldAmount} ต่ำกว่า Min ${pkg.credits_min}` }
  return { valid: true }
}

// แปลงตัวเลขที่อาจมาจาก locale ต่างๆ (en: "2.06", vi: "96,86", "3.100,00")
function parseLocaleNumber(str) {
  const cleaned = str.replace(/[^0-9.,]/g, '')
  if (!cleaned) return null
  const lastDot   = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  let n
  if (lastDot > lastComma) {
    const afterDot = cleaned.slice(lastDot + 1)
    if (afterDot.length === 3) {
      n = parseFloat(cleaned.replace(/\./g, ''))
    } else {
      n = parseFloat(cleaned.replace(/,/g, ''))
    }
  } else if (lastComma > lastDot) {
    n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  } else {
    n = parseFloat(cleaned)
  }
  return isFinite(n) && n > 0 ? n : null
}

function isNonUsdCurrency(raw) {
  return /฿|baht|thb|vnd|₫|idr|rp\s|sgd|myr|rm\s|php|₱/i.test(raw)
}

async function getPageOrderAmount(page) {
  try {
    await page.waitForSelector('#orderSummaryOrderTotal', { timeout: 15000 })
  } catch {
    console.warn('[razer-bot] #orderSummaryOrderTotal ไม่โหลดใน 15s')
  }

  const maxWait  = 15000
  const interval = 500
  const started  = Date.now()
  let raw = null

  while (Date.now() - started < maxWait) {
    raw = await page.evaluate(() => {
      const el = document.getElementById('orderSummaryOrderTotal')
      return el ? el.textContent : null
    })

    if (raw == null) {
      console.warn('[razer-bot] #orderSummaryOrderTotal ไม่พบ')
      return null
    }

    if (!isNonUsdCurrency(raw)) break

    console.log(`[razer-bot] รอ page อัปเดตจาก "${raw.trim()}" → USD...`)
    await sleep(interval)
  }

  if (raw == null) return null

  if (isNonUsdCurrency(raw)) {
    console.warn(`[razer-bot] element ยังเป็นสกุลท้องถิ่น "${raw.trim()}" หลังรอ ${maxWait}ms — ข้าม`)
    return null
  }

  const n = parseLocaleNumber(raw)
  console.log(`[razer-bot] #orderSummaryOrderTotal raw="${raw.trim()}" → ${n} USD`)
  return n
}

async function launchBrowser() {
  return puppeteerExtra.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--lang=en-US',
      '--accept-lang=en-US,en',
    ],
  })
}

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

async function loginOnPaymentPage(page, account) {
  await page.waitForSelector('input[type="email"]', { timeout: 5000 }).catch(() => {})

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => /save my preferences/i.test(b.textContent) && b.offsetParent !== null)
    if (btn) {
      const cb = document.querySelector('input[type="checkbox"]')
      if (cb && !cb.checked) cb.click()
      btn.click()
    }
  })

  await fillReact(page, ['#loginEmail', 'input[type="email"]'], account.email)
  await sleep(100)
  await fillReact(page, ['#loginPassword', 'input[type="password"]'], account.password)
  await sleep(100)

  await page.waitForFunction(
    () => {
      const btn = document.getElementById('btn-log-in')
        || [...document.querySelectorAll('button')].find(b => /log.?in/i.test(b.textContent))
      return btn && !btn.disabled
    },
    { timeout: 8000 }
  ).catch(() => {})

  await page.evaluate(() => {
    const btn = document.getElementById('btn-log-in')
      || [...document.querySelectorAll('button')].find(b => /log.?in/i.test(b.textContent))
    if (btn) { btn.removeAttribute('disabled'); btn.click() }
  })

  for (let i = 0; i < 20; i++) {
    await sleep(500)
    if (page.url().includes('pay.gold.razer.com')) break
  }
}

async function processCheckout(page, backupCode) {
  // Step 1: Proceed to Checkout
  const step1 = await page.waitForFunction(
    () => [...document.querySelectorAll('button,[role="button"],a')]
      .some(b => /proceed|pay now|checkout|reload to checkout|ดำเนินการต่อ/i.test(b.textContent) && b.offsetParent !== null),
    { timeout: 8000 }
  ).catch(() => null)
  if (!step1) console.warn('[checkout] Step1: Proceed button ไม่พบภายใน 8s')

  const step1Clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button,[role="button"],a')]
      .find(e => /proceed|pay now|checkout|reload to checkout|ดำเนินการต่อ/i.test(e.textContent) && e.offsetParent !== null)
    if (el) { el.click(); return el.textContent.trim() }
    return null
  })
  console.log('[checkout] Step1 clicked:', step1Clicked)

  // Step 2: Edit
  const step2 = await page.waitForFunction(
    () => [...document.querySelectorAll('button,a,[role="button"]')]
      .some(b => /^edit$|^แก้ไข$/i.test(b.textContent.trim())),
    { timeout: 12000 }
  ).catch(() => null)
  if (!step2) console.warn('[checkout] Step2: Edit button ไม่พบภายใน 12s')

  const step2Clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button,a,[role="button"]')]
      .find(b => /^edit$|^แก้ไข$/i.test(b.textContent.trim()))
    if (el) { el.scrollIntoView(); el.click(); return el.textContent.trim() }
    return null
  })
  console.log('[checkout] Step2 clicked:', step2Clicked)

  // Step 3: Choose a different method
  let clicked2 = null
  for (let i = 0; i < 25; i++) {
    for (const ctx of [page, ...page.frames().filter(f => f !== page.mainFrame())]) {
      try {
        clicked2 = await ctx.evaluate((re) => {
          const el = [...document.querySelectorAll('button,a,[role="button"]')]
            .find(b => new RegExp(re).test(b.textContent) && b.offsetParent !== null)
          if (el) { el.click(); return el.textContent.trim() }
          return null
        }, /different|change.*method|เลือกวิธีการอื่น/i.source)
        if (clicked2) break
      } catch {}
    }
    if (clicked2) break
    await sleep(1000)
  }
  console.log('[checkout] Step3 clicked:', clicked2 || 'NOT FOUND')

  // Step 4: Backup Codes
  let clicked3 = null
  for (let i = 0; i < 15; i++) {
    for (const ctx of [page, ...page.frames().filter(f => f !== page.mainFrame())]) {
      try {
        clicked3 = await ctx.evaluate(() => {
          const el = [...document.querySelectorAll('button,a,[role="button"]')]
            .find(b => /backup|รหัสสำรอง/i.test(b.textContent) && b.offsetParent !== null)
          if (el) { el.click(); return el.textContent.trim() }
          return null
        })
        if (clicked3) break
      } catch {}
    }
    if (clicked3) break
    await sleep(1000)
  }
  console.log('[checkout] Step4 clicked:', clicked3 || 'NOT FOUND')

  // Step 5: กรอก OTP
  await page.waitForSelector('input[id^="otp-input-"]', { timeout: 8000 }).catch(() => {})

  let otpFrame = page
  for (const ctx of [page, ...page.frames()]) {
    try {
      if (await ctx.evaluate(() => !!document.querySelector('input[id^="otp-input-"]')))
        { otpFrame = ctx; break }
    } catch {}
  }

  await otpFrame.evaluate(() => {
    const el = document.querySelector('input[id="otp-input-0"]')
    if (el) el.focus()
  })
  await sleep(200)
  for (const ch of backupCode.replace(/\s/g, ''))
    await page.keyboard.type(ch, { delay: 80 })
  await sleep(300)

  const submitClicked = await otpFrame.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]')
      || [...document.querySelectorAll('button')]
           .find(b => /submit|confirm|verify|continue|ยืนยัน/i.test(b.textContent) && b.offsetParent !== null)
    if (btn) { btn.click(); return btn.textContent.trim() }
    return null
  })
  if (!submitClicked) await page.keyboard.press('Enter')

  // Step 6: รอหน้า Congratulations
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => {})

  const afterSubmitUrl  = page.url()
  const afterSubmitText = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
  const onSuccessPage   = /complete|success/i.test(afterSubmitUrl)
                       || /congratulations|success|สำเร็จ|thành.?công/i.test(afterSubmitText)

  console.log(`[checkout] Step6 url=${afterSubmitUrl}`)
  console.log(`[checkout] Step6 onSuccessPage=${onSuccessPage} snippet="${afterSubmitText.slice(0, 100)}"`)

  if (!onSuccessPage) {
    throw new Error(`Checkout ไม่สำเร็จ — URL: ${afterSubmitUrl.slice(-60)} — ${afterSubmitText.slice(0, 120)}`)
  }

  // Step 7: Back to Merchant
  let backClicked = null
  for (let i = 0; i < 20; i++) {
    backClicked = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button,a,[role="button"]')]
        .find(b => /back.?to.?merchant|กลับไปหน้าสินค้า/i.test(b.textContent) && b.offsetParent !== null)
      if (el) { el.click(); return el.textContent.trim() }
      return null
    }).catch(() => null)
    if (backClicked) break
    await sleep(500)
  }
  console.log(`[checkout] Step7 BACK TO MERCHANT: ${backClicked || 'NOT FOUND'}`)

  if (backClicked) {
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {})
    console.log(`[checkout] Step7 navigated to: ${page.url()}`)
  }
}

async function loginRazerId(page, account) {
  await sleep(5000)

  for (let attempt = 0; attempt < 4; attempt++) {
    const dismissed = await page.evaluate(() => {
      const saveBtn = [...document.querySelectorAll('button')]
        .find(b => /save my preferences/i.test(b.textContent) && b.offsetParent !== null)
      if (saveBtn) {
        const cb = [...document.querySelectorAll('input[type="checkbox"]')]
          .find(c => /do not track/i.test(c.closest('label')?.textContent))
          || document.querySelector('input[type="checkbox"]')
        if (cb && !cb.checked) cb.click()
        saveBtn.click()
        return 'Save My Preferences'
      }
      const closeBtn = [...document.querySelectorAll('button,a')]
        .find(el => /accept all|accept cookies|i agree/i.test(el.textContent) && el.offsetParent !== null)
      if (closeBtn) { closeBtn.click(); return closeBtn.textContent.trim() }
      return null
    })
    if (dismissed) await sleep(1000)
    else break
  }

  await page.waitForSelector('#input-login-email, input[type="email"]', { timeout: 10000 })

  await fillReact(page, ['#input-login-email', 'input[type="email"]'], account.email)
  await sleep(500)
  await fillReact(page, ['#input-login-password', 'input[type="password"]'], account.password)
  await sleep(500)

  await page.waitForFunction(
    () => [...document.querySelectorAll('button')]
      .find(b => /log in|sign in/i.test(b.textContent))?.disabled === false,
    { timeout: 10000 }
  ).catch(() => {})

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => /log in|sign in/i.test(b.textContent))
    if (btn) btn.click()
  })
  await sleep(5000)

  for (let i = 0; i < 8; i++) {
    const clicked = await page.evaluate(() => {
      const isAgreement = /agreement|terms|ข้อตกลง|利用規約|服务条款|약관/i.test(document.body.innerText)
      if (isAgreement) {
        const btn = [...document.querySelectorAll('button,a,[role="button"]')]
          .find(b => /^(accept|ยอมรับ|同意|수락|accepter|aceptar)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
        if (btn) { btn.click(); return 'accept:' + btn.textContent.trim() }
      }
      const isPermission = /contact permission|marketing|communication/i.test(document.body.innerText)
      if (isPermission) {
        const btn = [...document.querySelectorAll('button,a,[role="button"]')]
          .find(b => /^(skip|ข้าม|スキップ|跳过|건너뛰기)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
        if (btn) { btn.click(); return 'skip:' + btn.textContent.trim() }
      }
      return null
    })
    if (clicked) await sleep(2000)
    else break
    await sleep(1000)
  }
}

async function regenerateBackupCodes(browser, account, loadRazerAccounts, saveRazerAccounts) {
  const page = await browser.newPage()
  try {
    await page.goto('https://razerid.razer.com/account/security/codes',
      { waitUntil: 'networkidle2' })

    await sleep(3000)
    if (!page.url().includes('/account/security')) {
      await loginRazerId(page, account)
      for (let i = 0; i < 30; i++) {
        await sleep(1000)
        if (page.url().includes('/account/security')) break
      }
    }

    let hasGenerateBtn = false
    for (let i = 0; i < 10; i++) {
      await sleep(1000)
      hasGenerateBtn = await page.evaluate(() =>
        [...document.querySelectorAll('button,a,[role="button"]')]
          .some(b => /generate new codes|สร้างรหัสใหม่/i.test(b.textContent) && b.offsetParent !== null)
      )
      if (hasGenerateBtn) break
      const has2FA = await page.evaluate(() => !!document.querySelector('input[id^="otp-input-"]'))
      if (has2FA) break
    }

    if (!hasGenerateBtn) {
      let clicked2 = null
      for (let i = 0; i < 15; i++) {
        for (const ctx of [page, ...page.frames().filter(f => f !== page.mainFrame())]) {
          try {
            clicked2 = await ctx.evaluate((re) => {
              const el = [...document.querySelectorAll('button,a,[role="button"]')]
                .find(b => new RegExp(re).test(b.textContent) && b.offsetParent !== null)
              if (el) { el.click(); return el.textContent.trim() }
              return null
            }, /different|change.*method|เลือกวิธีการอื่น/i.source)
            if (clicked2) break
          } catch {}
        }
        if (clicked2) break
        await sleep(1000)
      }

      let clickedBackup = null
      for (let i = 0; i < 12; i++) {
        for (const ctx of [page, ...page.frames().filter(f => f !== page.mainFrame())]) {
          try {
            clickedBackup = await ctx.evaluate(() => {
              const el = [...document.querySelectorAll('button,a,[role="button"]')]
                .find(b => /backup|รหัสสำรอง/i.test(b.textContent) && b.offsetParent !== null)
              if (el) { el.click(); return el.textContent.trim() }
              return null
            })
            if (clickedBackup) break
          } catch {}
        }
        if (clickedBackup) break
        await sleep(1000)
      }

      await page.waitForSelector('input[id^="otp-input-"]', { timeout: 10000 }).catch(() => {})

      const freshAccounts = loadRazerAccounts()
      const freshAcc = freshAccounts.find(a => a.id === account.id)
      const codes = freshAcc?.backup_codes || []
      if (!codes.length) throw new Error('ไม่มี backup codes เหลือสำหรับ 2FA regen')
      const codeForRegen = codes[0]

      let otpCtx = page
      for (const ctx of [page, ...page.frames()]) {
        try {
          if (await ctx.evaluate(() => !!document.querySelector('input[id^="otp-input-"]')))
            { otpCtx = ctx; break }
        } catch {}
      }

      await otpCtx.evaluate(() => {
        const el = document.querySelector('input[id="otp-input-0"]')
        if (el) el.focus()
      })
      await sleep(100)
      for (const ch of codeForRegen.replace(/\s/g, ''))
        await page.keyboard.type(ch, { delay: 60 })
      await sleep(300)

      const submitClicked = await otpCtx.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]')
          || [...document.querySelectorAll('button')]
               .find(b => /submit|confirm|verify|continue|ยืนยัน/i.test(b.textContent) && b.offsetParent !== null)
        if (btn) { btn.click(); return btn.textContent.trim() }
        return null
      })
      if (!submitClicked) await page.keyboard.press('Enter')

      const updAccs = loadRazerAccounts()
      const updAcc = updAccs.find(a => a.id === account.id)
      if (updAcc) {
        updAcc.backup_codes = updAcc.backup_codes.slice(1)
        saveRazerAccounts(updAccs)
      }

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
      await sleep(2000)
    }

    let clickedGenerate = null
    for (let i = 0; i < 15; i++) {
      try {
        clickedGenerate = await page.evaluate(() => {
          const el = [...document.querySelectorAll('button,a,[role="button"]')]
            .find(b => /generate new codes|สร้างรหัสใหม่/i.test(b.textContent) && b.offsetParent !== null)
          if (el) { el.click(); return el.textContent.trim() }
          return null
        })
        if (clickedGenerate) break
      } catch {}
      await sleep(1000)
    }

    let clickedConfirm = null
    for (let i = 0; i < 10; i++) {
      try {
        clickedConfirm = await page.evaluate(() => {
          const el = [...document.querySelectorAll('button,a,[role="button"]')]
            .find(b => /^(generate|สร้าง)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
          if (el) { el.click(); return el.textContent.trim() }
          return null
        })
        if (clickedConfirm) break
      } catch {}
      await sleep(500)
    }
    await sleep(3000)

    const newCodes = await page.evaluate(() => {
      const codeRe = /^\d{6,12}$/
      const fromEls = [...document.querySelectorAll('*')]
        .filter(el => el.childElementCount === 0 && el.offsetParent !== null)
        .map(el => el.textContent.trim())
        .filter(t => codeRe.test(t))
      if (fromEls.length >= 5) return [...new Set(fromEls)]
      return [...new Set(document.body.innerText.split(/\s+/).filter(t => codeRe.test(t.trim())))]
    })

    if (newCodes.length < 5)
      throw new Error(`พบ codes ใหม่แค่ ${newCodes.length} อัน`)

    const codesToSave = newCodes.slice(0, 10)
    const finalAccs = loadRazerAccounts()
    const finalAcc = finalAccs.find(a => a.id === account.id)
    if (finalAcc) {
      finalAcc.backup_codes = codesToSave
      saveRazerAccounts(finalAccs)
    }

    return codesToSave.length

  } finally {
    await page.close()
  }
}

async function regenAccountBackupCodes(account, loadRazerAccounts, saveRazerAccounts) {
  const browser = await launchBrowser()
  try {
    return await regenerateBackupCodes(browser, account, loadRazerAccounts, saveRazerAccounts)
  } finally {
    await browser.close()
  }
}

async function runRazerOrder(orderId, order, { loadRazerAccounts, saveRazerAccounts, db, save }) {
  const payUrl = order.userFields?.urlLink
  if (!payUrl || !payUrl.startsWith(VALID_PAY_ORIGIN))
    throw new Error('URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย ' + VALID_PAY_ORIGIN)

  const pkgRes = db.exec(
    'SELECT p.credits_min, p.credits_max, c.razer_account_type FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id=?',
    [order.packageId]
  )
  const pkgRow = pkgRes[0]?.values[0]
  const pkg = pkgRow ? { credits_min: pkgRow[0], credits_max: pkgRow[1] } : {}
  const reqAccountType = pkgRow?.[2] || null

  const allAccounts = loadRazerAccounts()
    .filter(a =>
      !a.is_locked &&
      !a.broken &&
      a.backup_codes.length > 0 &&
      a.credits > 0 &&
      (!reqAccountType || a.razer_account_type === reqAccountType)
    )
    .sort((a, b) => b.credits - a.credits)

  if (!allAccounts.length)
    throw new Error('ไม่มี Razer account ที่พร้อมใช้งาน')

  db.run('UPDATE orders SET razer_status=?, razer_started_at=? WHERE id=?', ['processing', new Date().toISOString(), orderId])
  save()

  const browser = await launchBrowser()
  let selectedAccount = null
  const accountErrors = []

  try {
    let razerGoldAmount = null

    const client = await browser.target().createCDPSession()

    for (const acc of allAccounts) {
      try { await client.send('Network.clearBrowserCookies') } catch {}

      const page = await browser.newPage()
      try {
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
        await page.goto(payUrl, { waitUntil: 'networkidle2' })
        await loginOnPaymentPage(page, acc)

        try {
          await page.waitForSelector('#userTotalGold', { timeout: 10000 })
        } catch {
          await page.close()
          continue
        }

        if (razerGoldAmount === null) {
          razerGoldAmount = await getPageOrderAmount(page)
          console.log(`[razer-bot] Gold amount from page: ${razerGoldAmount}`)

          if (razerGoldAmount != null) {
            const amountCheck = validateAmount(razerGoldAmount, pkg)
            if (!amountCheck.valid) throw new Error(amountCheck.reason)
          }
        }

        const goldToDeduct = razerGoldAmount ?? 0

        let liveRaw = ''
        for (let i = 0; i < 20; i++) {
          liveRaw = await page.evaluate(() =>
            document.getElementById('userTotalGold')?.textContent?.trim() ?? ''
          )
          if (liveRaw && parseLocaleNumber(liveRaw) != null) break
          await sleep(500)
        }
        const liveCredit = parseLocaleNumber(liveRaw) ?? 0
        console.log(`[razer-bot] account#${acc.id} liveCredit raw="${liveRaw}" → ${liveCredit}, need=${goldToDeduct}`)

        if (goldToDeduct > 0 && liveCredit < goldToDeduct) {
          console.log(`[razer-bot] account#${acc.id} credit ไม่พอ (${liveCredit} < ${goldToDeduct}) → ข้าม`)
          await page.close()
          continue
        }

        db.run('UPDATE emails SET is_locked=1 WHERE id=?', [acc.id])
        save()
        selectedAccount = acc

        const codeToUse = acc.backup_codes[0]
        await processCheckout(page, codeToUse)

        db.run(
          'UPDATE emails SET credits=credits-?, is_locked=0, backup_codes=? WHERE id=?',
          [goldToDeduct, JSON.stringify(acc.backup_codes.slice(1)), acc.id]
        )
        db.run(
          'UPDATE order_items SET email_id_used=?, credit_deducted=? WHERE order_id=?',
          [acc.id, goldToDeduct, orderId]
        )
        db.run('UPDATE orders SET razer_status=?, razer_finished_at=? WHERE id=?', ['success', new Date().toISOString(), orderId])
        save()

        const remainingCodes = acc.backup_codes.slice(1)
        if (remainingCodes.length < 3) {
          const updAcc = loadRazerAccounts().find(a => a.id === acc.id)
          if (updAcc) {
            console.log(`[razer-bot] auto-regen triggered for email#${acc.id} (codes เหลือ ${remainingCodes.length})`)
            regenAccountBackupCodes(updAcc, loadRazerAccounts, saveRazerAccounts)
              .then(n => console.log(`[razer-bot] auto-regen สำเร็จ email#${acc.id}: ${n} codes ใหม่`))
              .catch(e => console.error(`[razer-bot] auto-regen failed for email#${acc.id}:`, e.message))
          }
        }

        await page.close()
        return
      } catch (err) {
        const msg = `account#${acc.id}(${acc.email}): ${err.message}`
        console.error(`[razer-bot] ${msg}`)
        accountErrors.push(msg)
        db.run('UPDATE orders SET razer_note=? WHERE id=?', [accountErrors.join(' | '), orderId])
        save()
        if (selectedAccount?.id === acc.id) {
          db.run('UPDATE emails SET is_locked=0 WHERE id=?', [acc.id])
          save()
        }
        try { await page.close() } catch {}
        selectedAccount = null
      }
    }

    throw new Error('ไม่สามารถ checkout ได้กับทุก account ที่ลอง: ' + accountErrors.join(' | '))

  } finally {
    try { await browser.close() } catch {}
  }
}

module.exports = { runRazerOrder, regenAccountBackupCodes }
```

---

## 3. แก้ไข `database.js` — เพิ่ม ALTER TABLE และ CREATE TABLE

เพิ่ม block ด้านล่างนี้ต่อท้ายก่อนบรรทัด `console.log('✅ เชื่อมต่อฐานข้อมูลสำเร็จ')`:

```js
  try { db.run("ALTER TABLE emails ADD COLUMN backup_codes TEXT NOT NULL DEFAULT '[]'") } catch (e) {}
  try { db.run('ALTER TABLE emails ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0') } catch (e) {}
  try { db.run('ALTER TABLE emails ADD COLUMN razer_account_type TEXT') } catch (e) {}
  try { db.run('ALTER TABLE categories ADD COLUMN razer_account_type TEXT') } catch (e) {}
  try { db.run('ALTER TABLE orders ADD COLUMN razer_url TEXT') } catch (e) {}
  try { db.run('ALTER TABLE orders ADD COLUMN razer_status TEXT') } catch (e) {}
  try { db.run('ALTER TABLE orders ADD COLUMN razer_note TEXT') } catch (e) {}
  try { db.run('ALTER TABLE orders ADD COLUMN razer_started_at TEXT') } catch (e) {}
  try { db.run('ALTER TABLE orders ADD COLUMN razer_finished_at TEXT') } catch (e) {}
  try { db.run('ALTER TABLE products ADD COLUMN credits_min REAL') } catch (e) {}
  try { db.run('ALTER TABLE products ADD COLUMN credits_max REAL') } catch (e) {}
  db.run(`CREATE TABLE IF NOT EXISTS razer_account_types (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`)
```

---

## 4. แก้ไข `index.js`

### 4a. เพิ่ม require ที่ด้านบน (หลัง require อื่นๆ)

```js
let razerBot = null
try { razerBot = require('./razer-bot') } catch (e) { console.warn('[razer-bot] puppeteer ไม่พร้อม:', e.message) }
```

### 4b. เพิ่ม Queue + loadRazerAccounts ภายใน `initDB().then()` callback (ก่อน route แรก)

```js
  // ── Razer Order Queue ────────────────────────────────────────
  const razerQueue = []
  let razerQueueRunning = false

  function enqueueRazerOrder(orderId, order) {
    razerQueue.push({ orderId, order })
    console.log(`[razer-queue] เพิ่ม order#${orderId} เข้าคิว (คิวรวม: ${razerQueue.length})`)
    processRazerQueue()
  }

  function processRazerQueue() {
    if (razerQueueRunning || razerQueue.length === 0) return
    const { orderId, order } = razerQueue.shift()
    razerQueueRunning = true
    console.log(`[razer-queue] เริ่ม order#${orderId} (คิวรอ: ${razerQueue.length})`)
    razerBot.runRazerOrder(orderId, order, { loadRazerAccounts, saveRazerAccounts, db, save })
      .catch(e => {
        console.error(`[razer-queue] order#${orderId} failed:`, e.message)
        db.run('UPDATE orders SET razer_status=?, razer_note=?, razer_finished_at=? WHERE id=?',
          ['failed', e.message, new Date().toISOString(), orderId])
        save()
      })
      .finally(() => {
        razerQueueRunning = false
        console.log(`[razer-queue] order#${orderId} เสร็จ — คิวรอ: ${razerQueue.length}`)
        processRazerQueue()
      })
  }

  function loadRazerAccounts() {
    const r = db.exec(
      "SELECT id, email, password, credits, broken, is_locked, backup_codes, razer_account_type FROM emails WHERE fill_type='RAZER'"
    )
    if (!r[0]) return []
    return r[0].values.map(row => ({
      id: row[0],
      email: row[1],
      password: row[2],
      credits: row[3] || 0,
      broken: row[4] || 0,
      is_locked: row[5] || 0,
      backup_codes: (() => { try { return JSON.parse(row[6] || '[]') } catch { return [] } })(),
      razer_account_type: row[7] || null,
    }))
  }

  function saveRazerAccounts(accounts) {
    for (const acc of accounts) {
      db.run(
        'UPDATE emails SET credits=?, is_locked=?, backup_codes=? WHERE id=?',
        [acc.credits, acc.is_locked ? 1 : 0, JSON.stringify(acc.backup_codes || []), acc.id]
      )
    }
    save()
  }
  // ────────────────────────────────────────────────────────────
```

### 4c. ใน `POST /orders` — หลัง `save()` และ `res.json(...)` เพิ่ม RAZER_AUTO trigger

หา block ที่สร้าง order สำเร็จแล้ว เพิ่มก่อนปิด route handler:

```js
    // รับ razer_url จาก req.body ด้วย (เพิ่มใน destructure ต้น route)
    // const { items, ..., razer_url } = req.body

    // เพิ่ม razer_url ลง orders ถ้ามี RAZER_AUTO item
    const hasRazerAuto = items.some(item => {
      const p = db.exec('SELECT category_id FROM products WHERE id=?', [item.product_id])
      const catId = p[0]?.values[0][0]
      if (!catId) return false
      const c = db.exec('SELECT fill_type FROM categories WHERE id=?', [catId])
      return c[0]?.values[0][0] === 'RAZER_AUTO'
    })

    if (hasRazerAuto && razer_url) {
      db.run('UPDATE orders SET razer_url=?, razer_status=? WHERE id=?', [razer_url, 'pending', orderId])
    }

    save()
    res.json({ order_id: orderId, total })

    // ยิง Razer bot async หลัง response
    if (hasRazerAuto && razer_url && razerBot) {
      const razerItem = items.find(item => {
        const p = db.exec('SELECT category_id FROM products WHERE id=?', [item.product_id])
        const catId = p[0]?.values[0][0]
        if (!catId) return false
        const c = db.exec('SELECT fill_type FROM categories WHERE id=?', [catId])
        return c[0]?.values[0][0] === 'RAZER_AUTO'
      })
      if (razerItem) {
        const p = db.exec('SELECT category_id FROM products WHERE id=?', [razerItem.product_id])
        const gameId = p[0]?.values[0][0]
        enqueueRazerOrder(
          orderId,
          { gameId, packageId: razerItem.product_id, userFields: { urlLink: razer_url } }
        )
      }
    }
```

### 4d. เพิ่ม Razer API routes (ต่อท้าย routes อื่นๆ ก่อน `app.listen`)

```js
  // ── Razer Account Types ──────────────────────────────────────
  app.get('/razer-account-types', requireLogin, (req, res) => {
    const r = db.exec('SELECT id, name FROM razer_account_types ORDER BY name')
    res.json(r[0] ? r[0].values.map(row => ({ id: row[0], name: row[1] })) : [])
  })

  app.post('/razer-account-types', requireLogin, (req, res) => {
    const { name } = req.body
    if (!name?.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อประเภท' })
    try {
      db.run('INSERT INTO razer_account_types (name) VALUES (?)', [name.trim()])
      const r = db.exec('SELECT last_insert_rowid()')
      save()
      res.json({ id: r[0].values[0][0], name: name.trim() })
    } catch {
      res.status(400).json({ error: 'ชื่อนี้มีอยู่แล้ว' })
    }
  })

  app.delete('/razer-account-types/:id', requireLogin, (req, res) => {
    db.run('DELETE FROM razer_account_types WHERE id=?', [req.params.id])
    save()
    res.json({ message: 'ลบสำเร็จ' })
  })

  // ── Razer Bot routes ─────────────────────────────────────────
  app.post('/razer-accounts/:id/regen', requireLogin, (req, res) => {
    if (!razerBot) return res.status(503).json({ error: 'Razer bot ไม่พร้อม (puppeteer ไม่ติดตั้ง)' })
    const emailRes = db.exec(
      "SELECT id, email, password, backup_codes FROM emails WHERE id=? AND fill_type='RAZER'",
      [req.params.id]
    )
    if (!emailRes[0]) return res.status(404).json({ error: 'ไม่พบ Razer account' })
    const row = emailRes[0].values[0]
    const account = {
      id: row[0], email: row[1], password: row[2],
      backup_codes: (() => { try { return JSON.parse(row[3] || '[]') } catch { return [] } })(),
    }
    res.json({ message: 'เริ่ม regen backup codes แล้ว' })
    razerBot.regenAccountBackupCodes(account, loadRazerAccounts, saveRazerAccounts)
      .then(count => console.log(`[razer-bot] regen สำเร็จ: ${count} codes สำหรับ email ${account.id}`))
      .catch(e => console.error(`[razer-bot] regen failed email ${account.id}:`, e.message))
  })

  app.get('/razer-status/:orderId', requireLogin, (req, res) => {
    const r = db.exec('SELECT razer_status, razer_note FROM orders WHERE id=?', [req.params.orderId])
    if (!r[0]) return res.status(404).json({ error: 'ไม่พบ order' })
    const [status, note] = r[0].values[0]
    res.json({ status: status || null, note: note || null })
  })

  app.get('/razer-orders', requireLogin, (req, res) => {
    const r = db.exec(`
      SELECT o.id, o.created_at, o.total, o.razer_status, o.razer_note, o.razer_url,
             p.name AS product_name, o.razer_started_at, o.razer_finished_at
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.razer_url IS NOT NULL
      ORDER BY o.id DESC
      LIMIT 30
    `)
    if (!r[0]) return res.json([])
    res.json(r[0].values.map(v => ({
      id: v[0], created_at: v[1], total: v[2],
      razer_status: v[3], razer_note: v[4], razer_url: v[5],
      product_name: v[6], razer_started_at: v[7], razer_finished_at: v[8],
    })))
  })
```

### 4e. ใน `PUT /emails/:id` — เพิ่ม field `backup_codes` และ `razer_account_type` ใน UPDATE query

```js
  // destructure เพิ่ม:
  const { ..., backup_codes, razer_account_type } = req.body
  const backupCodesStr = JSON.stringify(
    Array.isArray(backup_codes) ? backup_codes : []
  )
  // UPDATE query เพิ่ม:
  db.run(
    'UPDATE emails SET ..., backup_codes=?, razer_account_type=? WHERE id=?',
    [..., backupCodesStr, razer_account_type || null, req.params.id]
  )
```

---

## 5. สร้างไฟล์ `client/src/pages/RazerPage.jsx` (ไฟล์ใหม่)

```jsx
import { useState, useEffect } from 'react'

export default function RazerPage() {
  const [emails, setEmails] = useState([])
  const [accountTypes, setAccountTypes] = useState([])
  const [editModal, setEditModal] = useState(null)
  const [editCodes, setEditCodes] = useState('')
  const [editAccountType, setEditAccountType] = useState('')
  const [saving, setSaving] = useState(false)
  const [regenning, setRegenning] = useState({})
  const [msg, setMsg] = useState('')
  const [razerOrders, setRazerOrders] = useState([])
  const [searchEmail, setSearchEmail] = useState('')
  const [ordersCollapsed, setOrdersCollapsed] = useState(false)
  const [newTypeName, setNewTypeName] = useState('')
  const [typeError, setTypeError] = useState('')

  function loadEmails() {
    fetch('/emails').then(r => r.json())
      .then(all => setEmails(all.filter(e => e.fill_type === 'RAZER')))
  }
  function loadAccountTypes() {
    fetch('/razer-account-types').then(r => r.json()).then(setAccountTypes)
  }
  function loadRazerOrders() {
    fetch('/razer-orders').then(r => r.json()).then(setRazerOrders).catch(() => {})
  }

  useEffect(() => {
    loadEmails(); loadAccountTypes(); loadRazerOrders()
    const t = setInterval(() => { loadEmails(); loadAccountTypes(); loadRazerOrders() }, 5000)
    return () => clearInterval(t)
  }, [])

  async function addAccountType() {
    setTypeError('')
    if (!newTypeName.trim()) { setTypeError('กรุณากรอกชื่อ'); return }
    const res = await fetch('/razer-account-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newTypeName.trim() }),
    })
    const d = await res.json()
    if (!res.ok) { setTypeError(d.error); return }
    setNewTypeName(''); loadAccountTypes()
  }

  async function deleteAccountType(id) {
    await fetch(`/razer-account-types/${id}`, { method: 'DELETE' })
    loadAccountTypes()
  }

  function openEdit(email) {
    setEditModal(email)
    setEditCodes((email.backup_codes || []).join('\n'))
    setEditAccountType(email.razer_account_type || '')
    setMsg('')
  }

  async function saveEdit() {
    if (!editModal) return
    setSaving(true)
    const codes = editCodes.split('\n').map(s => s.trim()).filter(Boolean)
    await fetch(`/emails/${editModal.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...editModal, backup_codes: codes, razer_account_type: editAccountType || null }),
    })
    setSaving(false); setEditModal(null); loadEmails()
  }

  async function triggerRegen(id) {
    setRegenning(prev => ({ ...prev, [id]: true })); setMsg('')
    try {
      const res = await fetch(`/razer-accounts/${id}/regen`, { method: 'POST' })
      const d = await res.json()
      setMsg(res.ok ? `Regen เริ่มแล้วสำหรับ account #${id}` : (d.error || 'เกิดข้อผิดพลาด'))
    } catch { setMsg('ไม่สามารถเชื่อมต่อได้') }
    setRegenning(prev => ({ ...prev, [id]: false }))
  }

  const botReadyCount = emails.filter(e => e.razer_account_type && (e.backup_codes || []).length > 0 && !e.broken).length
  const filteredEmails = emails.filter(e =>
    !searchEmail.trim() || e.email.toLowerCase().includes(searchEmail.toLowerCase())
  )
  const pendingCount = razerOrders.filter(o => o.razer_status === 'pending').length
  const processingCount = razerOrders.filter(o => o.razer_status === 'processing').length

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Razer Bot Accounts</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            พร้อมใช้งาน <span className="font-semibold text-green-600">{botReadyCount}</span> / {emails.length} accounts
          </p>
        </div>
        {(pendingCount + processingCount) > 0 && (
          <div className="flex gap-2">
            {processingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                ⚙️ กำลังทำ {processingCount}
              </span>
            )}
            {pendingCount > 0 && (
              <span className="inline-flex items-center gap-1.5 bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                ⏳ คิวรอ {pendingCount}
              </span>
            )}
          </div>
        )}
      </div>

      {msg && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">{msg}</div>
      )}

      {razerOrders.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <button
            onClick={() => setOrdersCollapsed(v => !v)}
            className="w-full px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-700 text-sm">รายการ Razer Auto ล่าสุด</h3>
              <span className="text-xs text-slate-400">({razerOrders.length} รายการ)</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">อัปเดตทุก 5 วินาที</span>
              <span className="text-slate-400 text-xs">{ordersCollapsed ? '▼' : '▲'}</span>
            </div>
          </button>
          {!ordersCollapsed && (
            <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
              {razerOrders.map(o => {
                const status = o.razer_status
                const badge =
                  status === 'success'     ? <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold whitespace-nowrap">✅ สำเร็จ</span>
                  : status === 'failed'   ? <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold whitespace-nowrap">❌ ล้มเหลว</span>
                  : status === 'processing' ? <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold whitespace-nowrap">⚙️ กำลังทำ</span>
                  : <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-semibold whitespace-nowrap">⏳ รอ</span>
                const toThai = iso => {
                  if (!iso) return '—'
                  return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false,
                    year: 'numeric', month: '2-digit', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit' })
                }
                let durSec = null
                if (o.razer_started_at && o.razer_finished_at) {
                  durSec = Math.round((new Date(o.razer_finished_at) - new Date(o.razer_started_at)) / 1000)
                }
                return (
                  <div key={o.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-700 truncate">{o.product_name || `Order #${o.id}`}</p>
                      <p className="text-xs text-slate-400">
                        {toThai(o.created_at)} · ฿{Number(o.total).toFixed(2)}
                        {durSec !== null && <span className="ml-2 text-slate-300">⏱ {durSec}s</span>}
                      </p>
                      {o.razer_note && <p className="text-xs text-red-500 truncate max-w-sm">{o.razer_note}</p>}
                    </div>
                    <div className="flex-shrink-0">{badge}</div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <h3 className="font-semibold text-slate-700 mb-3 text-sm">Account Types</h3>
          <div className="flex gap-2 mb-3">
            <input type="text" value={newTypeName}
              onChange={e => setNewTypeName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addAccountType()}
              placeholder="เช่น TH-A, SG-B..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
            <button onClick={addAccountType}
              className="px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm cursor-pointer font-medium">+</button>
          </div>
          {typeError && <p className="text-red-500 text-xs mb-2">{typeError}</p>}
          {accountTypes.length === 0
            ? <p className="text-slate-400 text-xs">ยังไม่มี Account Type</p>
            : <div className="flex flex-wrap gap-1.5">
                {accountTypes.map(t => (
                  <div key={t.id} className="flex items-center gap-1 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1">
                    <span className="text-xs font-semibold text-orange-700">{t.name}</span>
                    <button onClick={() => deleteAccountType(t.id)}
                      className="text-orange-400 hover:text-red-500 text-xs cursor-pointer leading-none">✕</button>
                  </div>
                ))}
              </div>
          }
        </div>

        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
            <input type="text" value={searchEmail}
              onChange={e => setSearchEmail(e.target.value)}
              placeholder="ค้นหา Email..."
              className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
            />
            {searchEmail && (
              <button onClick={() => setSearchEmail('')}
                className="text-slate-400 hover:text-slate-600 text-sm cursor-pointer">✕</button>
            )}
            <span className="text-xs text-slate-400 whitespace-nowrap">{filteredEmails.length}/{emails.length}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 text-left">Email</th>
                  <th className="px-4 py-2.5 text-left">Type</th>
                  <th className="px-4 py-2.5 text-right">Credits</th>
                  <th className="px-4 py-2.5 text-center">Codes</th>
                  <th className="px-4 py-2.5 text-center">สถานะ</th>
                  <th className="px-4 py-2.5 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEmails.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-400 text-sm">
                    {searchEmail ? 'ไม่พบ Email ที่ค้นหา' : 'ยังไม่มี Razer accounts'}
                  </td></tr>
                )}
                {filteredEmails.map(email => {
                  const codes = email.backup_codes || []
                  const hasType = !!email.razer_account_type
                  const botReady = hasType && codes.length > 0 && !email.broken
                  const creditsNeg = Number(email.credits) < 0
                  return (
                    <tr key={email.id} className={
                      email.broken ? 'bg-red-50' :
                      email.is_locked ? 'bg-yellow-50' :
                      creditsNeg ? 'bg-orange-50' : ''
                    }>
                      <td className="px-4 py-2.5 font-medium text-slate-700 max-w-[180px] truncate">{email.email}</td>
                      <td className="px-4 py-2.5">
                        {hasType
                          ? <span className="bg-orange-100 text-orange-700 rounded-full px-2 py-0.5 text-xs font-semibold">{email.razer_account_type}</span>
                          : <span className="bg-slate-100 text-slate-400 rounded-full px-2 py-0.5 text-xs">—</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-mono text-xs ${creditsNeg ? 'text-red-500 font-semibold' : 'text-slate-600'}`}>
                        {Number(email.credits).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          codes.length >= 3 ? 'bg-green-100 text-green-700' :
                          codes.length > 0  ? 'bg-yellow-100 text-yellow-700' :
                                              'bg-red-100 text-red-700'}`}>
                          {codes.length}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {email.broken    && <span className="bg-red-100 text-red-600 rounded-full px-2 py-0.5 text-xs">Broken</span>}
                        {email.is_locked && <span className="bg-yellow-100 text-yellow-600 rounded-full px-2 py-0.5 text-xs">Locked</span>}
                        {creditsNeg && !email.broken && <span className="bg-orange-100 text-orange-600 rounded-full px-2 py-0.5 text-xs">Credit-</span>}
                        {botReady && !email.is_locked && !creditsNeg && <span className="bg-green-100 text-green-600 rounded-full px-2 py-0.5 text-xs">พร้อม</span>}
                        {!botReady && !email.broken && !email.is_locked && !creditsNeg && <span className="bg-slate-100 text-slate-400 rounded-full px-2 py-0.5 text-xs">ไม่พร้อม</span>}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button onClick={() => openEdit(email)}
                            className="px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-xs cursor-pointer">แก้ไข</button>
                          <button onClick={() => triggerRegen(email.id)} disabled={regenning[email.id]}
                            className="px-2.5 py-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-lg text-xs cursor-pointer">
                            {regenning[email.id] ? '...' : 'Regen'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {editModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="font-bold text-slate-800">แก้ไข Razer Account</h3>
            <p className="text-sm text-slate-500">{editModal.email}</p>
            <div>
              <label className="block text-sm text-slate-500 mb-1.5">Razer Account Type</label>
              {accountTypes.length === 0
                ? <p className="text-xs text-orange-500">ยังไม่มี Account Type</p>
                : <select value={editAccountType} onChange={e => setEditAccountType(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400">
                    <option value="">— ยังไม่ได้ตั้ง —</option>
                    {accountTypes.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
              }
            </div>
            <div>
              <label className="block text-sm text-slate-500 mb-1.5">
                Backup Codes <span className="text-slate-400">(1 code ต่อบรรทัด)</span>
              </label>
              <textarea value={editCodes} onChange={e => setEditCodes(e.target.value)} rows={8}
                placeholder={'12345678\n87654321\n...'}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-400 resize-none" />
              <p className="text-xs text-slate-400 mt-1">{editCodes.split('\n').filter(s => s.trim()).length} codes</p>
            </div>
            <div className="flex gap-2.5">
              <button onClick={saveEdit} disabled={saving}
                className="flex-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white py-2.5 rounded-xl cursor-pointer font-medium">
                {saving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              <button onClick={() => setEditModal(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 py-2.5 rounded-xl cursor-pointer">ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

## 6. เพิ่ม Route ใน Frontend Router

ใน router หลัก (เช่น `App.jsx`) เพิ่ม:

```jsx
import RazerPage from './pages/RazerPage'

// ใน routes:
<Route path="/razer" element={<RazerPage />} />
```

และเพิ่มลิงก์ใน sidebar/nav:
```jsx
<NavLink to="/razer">Razer Bot</NavLink>
```

---

## 7. ข้อกำหนด categories ใน DB

category ที่จะใช้ Razer Auto ต้องตั้งค่า `fill_type = 'RAZER_AUTO'` และระบุ `razer_account_type` ให้ตรงกับ Account Type ที่สร้างไว้

email (Razer account) ที่ใช้ต้องมี `fill_type = 'RAZER'`

---

## หมายเหตุ

- Bot รองรับทั้งภาษาไทยและอังกฤษใน UI ของ Razer (ใช้ `--lang=en-US` บังคับก่อน มี Thai fallback regex)
- Auto-regen จะทำงานอัตโนมัติเมื่อ backup codes เหลือน้อยกว่า 3 อัน
- Queue ทำงานทีละ 1 order (sequential) เพื่อป้องกัน race condition
- Accounts ถูก sort ตาม credits มากสุดก่อน และ lock ระหว่าง checkout
