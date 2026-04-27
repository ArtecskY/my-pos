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
      // dot = thousands separator  ("3.100", "VND 3.100")
      n = parseFloat(cleaned.replace(/\./g, ''))
    } else {
      // dot = decimal separator  ("2.06", "3,100.00")
      n = parseFloat(cleaned.replace(/,/g, ''))
    }
  } else if (lastComma > lastDot) {
    // comma = decimal separator  ("96,86", "3.100,00")
    n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'))
  } else {
    n = parseFloat(cleaned)
  }
  return isFinite(n) && n > 0 ? n : null
}

// ตรวจว่า raw text เป็นสกุลเงินที่ไม่ใช่ USD หรือเปล่า (THB, VND, ฿, ₫, ฿ ...)
function isNonUsdCurrency(raw) {
  return /฿|baht|thb|vnd|₫|idr|rp\s|sgd|myr|rm\s|php|₱/i.test(raw)
}

// อ่าน Razer Gold order amount จาก #orderSummaryOrderTotal
// หลัง login หน้าจะอัปเดตจาก THB → USD อัตโนมัติ
// poll จนกว่าค่าจะเป็น USD (ไม่มี ฿ หรือสกุลท้องถิ่น) แล้วจึงอ่าน
async function getPageOrderAmount(page) {
  // รอให้ element โหลดก่อน
  try {
    await page.waitForSelector('#orderSummaryOrderTotal', { timeout: 15000 })
  } catch {
    console.warn('[razer-bot] #orderSummaryOrderTotal ไม่โหลดใน 15s')
  }

  const maxWait  = 15000
  const interval = 500
  const started  = Date.now()
  let raw = null

  // poll จนกว่า element จะไม่แสดงสกุลเงินท้องถิ่น
  while (Date.now() - started < maxWait) {
    raw = await page.evaluate(() => {
      const el = document.getElementById('orderSummaryOrderTotal')
      return el ? el.textContent : null
    })

    if (raw == null) {
      console.warn('[razer-bot] #orderSummaryOrderTotal ไม่พบ')
      return null
    }

    if (!isNonUsdCurrency(raw)) break   // ได้ USD แล้ว

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

// ── Browser ───────────────────────────────────────────────────
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

// ── React-aware input filler ──────────────────────────────────
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

// ── Login บน pay.gold.razer.com ───────────────────────────────
async function loginOnPaymentPage(page, account) {
  await page.waitForSelector('input[type="email"]', { timeout: 5000 }).catch(() => {})

  // dismiss cookie popup
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

  // poll URL หลัง login
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    if (page.url().includes('pay.gold.razer.com')) break
  }
}

// ── Checkout ──────────────────────────────────────────────────
async function processCheckout(page, backupCode) {
  // Step 1: กด Proceed to Checkout
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

  // Step 2: กด Edit
  const step2 = await page.waitForFunction(
    () => [...document.querySelectorAll('button,a,[role="button"]')]
      .some(b => /^edit$/i.test(b.textContent.trim())),
    { timeout: 12000 }
  ).catch(() => null)
  if (!step2) console.warn('[checkout] Step2: Edit button ไม่พบภายใน 12s')

  const step2Clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button,a,[role="button"]')]
      .find(b => /^edit$/i.test(b.textContent.trim()))
    if (el) { el.scrollIntoView(); el.click(); return el.textContent.trim() }
    return null
  })
  console.log('[checkout] Step2 clicked:', step2Clicked)

  // Step 3: กด Choose a different method (poll main + iframes)
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

  // Step 4: กด Backup Codes
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

  // Step 5: หา OTP frame → type code
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

  // Submit
  const submitClicked = await otpFrame.evaluate(() => {
    const btn = document.querySelector('button[type="submit"]')
      || [...document.querySelectorAll('button')]
           .find(b => /submit|confirm|verify|continue/i.test(b.textContent) && b.offsetParent !== null)
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

  // Step 7: กด BACK TO MERCHANT
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

// ── Login บน razerid.razer.com ────────────────────────────────
async function loginRazerId(page, account) {
  await sleep(5000)

  // Cookie popup (อาจซ้อน 2 ชั้น)
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

  // Post-login popups (Agreement / Contact Permission)
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

// ── Regen Backup Codes ────────────────────────────────────────
async function regenerateBackupCodes(browser, account, loadRazerAccounts, saveRazerAccounts) {
  const regenStart = Date.now()
  console.log(`[regen] เริ่ม email#${account.id} (${account.email}) — ${new Date().toISOString()}`)
  const page = await browser.newPage()
  try {
    await page.goto('https://razerid.razer.com/account/security/codes',
      { waitUntil: 'networkidle2' })

    // Phase 0: ตรวจ session
    await sleep(3000)
    if (!page.url().includes('/account/security')) {
      await loginRazerId(page, account)
      for (let i = 0; i < 30; i++) {
        await sleep(1000)
        if (page.url().includes('/account/security')) break
      }
    }

    // Phase 1: รอ Generate New Codes หรือ OTP
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

    // Phase 2: 2FA ด้วย backup code
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
               .find(b => /submit|confirm|verify|continue/i.test(b.textContent) && b.offsetParent !== null)
        if (btn) { btn.click(); return btn.textContent.trim() }
        return null
      })
      if (!submitClicked) await page.keyboard.press('Enter')

      // ตัด code ที่ใช้แล้ว
      const updAccs = loadRazerAccounts()
      const updAcc = updAccs.find(a => a.id === account.id)
      if (updAcc) {
        updAcc.backup_codes = updAcc.backup_codes.slice(1)
        saveRazerAccounts(updAccs)
      }

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
      await sleep(2000)
    }

    // Phase 3: กด Generate New Codes
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

    // Phase 4: กด Generate ใน modal
    let clickedConfirm = null
    for (let i = 0; i < 10; i++) {
      try {
        clickedConfirm = await page.evaluate(() => {
          const el = [...document.querySelectorAll('button,a,[role="button"]')]
            .find(b => /^generate$/i.test(b.textContent.trim()) && b.offsetParent !== null)
          if (el) { el.click(); return el.textContent.trim() }
          return null
        })
        if (clickedConfirm) break
      } catch {}
      await sleep(500)
    }
    await sleep(3000)

    // Phase 5: อ่าน codes ใหม่
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

    const elapsed = ((Date.now() - regenStart) / 1000).toFixed(1)
    console.log(`[regen] สำเร็จ email#${account.id} — ${codesToSave.length} codes ใหม่ — ใช้เวลา ${elapsed}s`)
    return codesToSave.length

  } finally {
    await page.close()
  }
}

// ── Standalone regen wrapper ──────────────────────────────────
async function regenAccountBackupCodes(account, loadRazerAccounts, saveRazerAccounts) {
  const browser = await launchBrowser()
  try {
    return await regenerateBackupCodes(browser, account, loadRazerAccounts, saveRazerAccounts)
  } finally {
    await browser.close()
  }
}

// ── Main Topup Entry Point ────────────────────────────────────
async function runRazerOrder(orderId, order, { loadRazerAccounts, saveRazerAccounts, db, save }, jobIndex = 1, totalJobs = 1) {
  const payUrl = order.userFields?.urlLink
  if (!payUrl || !payUrl.startsWith(VALID_PAY_ORIGIN))
    throw new Error('URL ไม่ถูกต้อง ต้องขึ้นต้นด้วย ' + VALID_PAY_ORIGIN)

  // ดึง product + category เพื่อหา razer_account_type + credits_min/max
  const pkgRes = db.exec(
    'SELECT p.credits_min, p.credits_max, c.razer_account_type FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id=?',
    [order.packageId]
  )
  const pkgRow = pkgRes[0]?.values[0]
  const pkg = pkgRow ? { credits_min: pkgRow[0], credits_max: pkgRow[1] } : {}
  const reqAccountType = pkgRow?.[2] || null

  // โหลด candidates: fill_type=RAZER, ไม่ locked, ไม่ broken, razer_account_type ตรง, มี backup_codes
  // ถ้า credits_max ตั้งไว้ → เลือกเฉพาะ account ที่ credits >= credits_max
  //   แล้ว sort จาก surplus (credits - max) น้อยสุดก่อน (ใช้คนที่พอดีก่อน)
  // ถ้าไม่มี credits_max → filter credits > 0 แล้ว sort มากสุดก่อน (พฤติกรรมเดิม)
  const hasMax = pkg.credits_max != null
  const allAccounts = loadRazerAccounts()
    .filter(a =>
      !a.is_locked &&
      !a.broken &&
      a.backup_codes.length > 0 &&
      (!reqAccountType || a.razer_account_type === reqAccountType) &&
      (hasMax ? a.credits >= pkg.credits_max : a.credits > 0) &&
      a.backup_codes.length >= 2   // ต้องมี >= 2 codes: 1 สำหรับ checkout + 1 สำหรับ regen 2FA
    )
    .sort((a, b) =>
      hasMax
        ? (a.credits - pkg.credits_max) - (b.credits - pkg.credits_max)  // surplus น้อยสุดก่อน
        : b.credits - a.credits                                            // credits มากสุดก่อน
    )

  console.log(`[razer-bot] credits_max=${pkg.credits_max ?? 'ไม่ได้ตั้ง'} → candidates ${allAccounts.length} accounts`)
  allAccounts.forEach((a, i) =>
    console.log(`[razer-bot]   [${i+1}] email#${a.id} credits=${a.credits}${hasMax ? ` surplus=${(a.credits - pkg.credits_max).toFixed(2)}` : ''}`)
  )

  if (!allAccounts.length)
    throw new Error('ไม่มี Razer account ที่พร้อมใช้งาน')

  if (jobIndex === 1) {
    db.run('UPDATE orders SET razer_status=?, razer_started_at=? WHERE id=?', ['processing', new Date().toISOString(), orderId])
  } else {
    db.run('UPDATE orders SET razer_note=? WHERE id=?', [`กำลังดำเนินการชิ้นที่ ${jobIndex}/${totalJobs}...`, orderId])
  }
  save()

  const browser = await launchBrowser()
  let selectedAccount = null
  const accountErrors = []

  try {
    let razerGoldAmount = null  // อ่านหลัง login ครั้งแรก

    const client = await browser.target().createCDPSession()

    for (const acc of allAccounts) {
      // clear cookies
      try { await client.send('Network.clearBrowserCookies') } catch {}

      const page = await browser.newPage()
      try {
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
        await page.goto(payUrl, { waitUntil: 'networkidle2' })
        await loginOnPaymentPage(page, acc)

        // ตรวจ login สำเร็จ
        try {
          await page.waitForSelector('#userTotalGold', { timeout: 10000 })
        } catch {
          await page.close()
          continue
        }

        // อ่านยอด Gold จาก #orderSummaryOrderTotal หลัง login (ครั้งแรกเท่านั้น)
        if (razerGoldAmount === null) {
          razerGoldAmount = await getPageOrderAmount(page)
          console.log(`[razer-bot] Gold amount from page: ${razerGoldAmount}`)

          if (razerGoldAmount != null) {
            const amountCheck = validateAmount(razerGoldAmount, pkg)
            if (!amountCheck.valid) throw new Error(amountCheck.reason)
          }
        }

        const goldToDeduct = razerGoldAmount ?? 0

        // poll รอ #userTotalGold มีค่า (สูงสุด 10s)
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

        // Lock account
        db.run('UPDATE emails SET is_locked=1 WHERE id=?', [acc.id])
        save()
        selectedAccount = acc

        const codeToUse = acc.backup_codes[0]
        await processCheckout(page, codeToUse)

        // Success: ตัด credit, ตัด backup code, unlock
        db.run(
          'UPDATE emails SET credits=credits-?, is_locked=0, backup_codes=? WHERE id=?',
          [goldToDeduct, JSON.stringify(acc.backup_codes.slice(1)), acc.id]
        )
        db.run(
          'UPDATE order_items SET email_id_used=?, credit_deducted=? WHERE order_id=?',
          [acc.id, goldToDeduct, orderId]
        )
        if (jobIndex === totalJobs) {
          db.run('UPDATE orders SET razer_status=?, razer_note=?, razer_finished_at=? WHERE id=?',
            ['success', totalJobs > 1 ? `เสร็จสิ้น ${totalJobs}/${totalJobs} ชิ้น` : null, new Date().toISOString(), orderId])
        } else {
          db.run('UPDATE orders SET razer_note=? WHERE id=?', [`${jobIndex}/${totalJobs} เสร็จแล้ว — รอชิ้นถัดไป...`, orderId])
        }
        save()

        // auto-regen ถ้า codes เหลือน้อยกว่า 5
        // ใช้ regenAccountBackupCodes (สร้าง browser ใหม่ของตัวเอง) แทน regenerateBackupCodes(browser,...)
        // เพราะ browser หลักจะถูกปิดใน finally ทันทีหลัง return
        const remainingCodes = acc.backup_codes.slice(1)
        if (remainingCodes.length < 5) {
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
        // update note ทันทีแต่ละรอบ เพื่อเห็น progress แม้ crash กลางทาง
        db.run('UPDATE orders SET razer_note=? WHERE id=?', [accountErrors.join(' | '), orderId])
        save()
        // unlock ถ้า lock ไปแล้ว
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
