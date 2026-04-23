/**
 * test-razer-regen.js — เทส Regen flow headless:false
 * รัน: node test-razer-regen.js
 */

const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
puppeteerExtra.use(StealthPlugin())

const sleep = ms => new Promise(r => setTimeout(r, ms))

const EMAIL       = 'memicgansz8d@hotmail.com'
const PASSWORD    = 'FCGLtD0Vu'
const BACKUP_CODE = '53109849'
const SECURITY_URL = 'https://razerid.razer.com/account/security/codes'

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

async function dumpButtons(page, label) {
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(b => b.offsetParent !== null && b.textContent.trim())
      .map(b => b.textContent.trim().slice(0, 80))
  )
  console.log(`\n[buttons visible @ ${label}]:`)
  btns.forEach((t, i) => console.log(`  [${i}] "${t}"`))
}

async function dismissCookiePopup(page) {
  try {
    const dismissed = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const save = btns.find(b => /save my preferences/i.test(b.textContent) && b.offsetParent !== null)
      if (save) { save.click(); return 'Save My Preferences' }
      const accept = btns.find(b => /^(accept all|accept cookies|accept)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
      if (accept) { accept.click(); return accept.textContent.trim() }
      return null
    })
    if (dismissed) {
      console.log('[cookie] dismissed:', dismissed)
      await sleep(600)
      return dismissed
    }
  } catch {}
  return null
}

async function waitForButton(page, regex, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const ctx of [page, ...page.frames().filter(f => f !== page.mainFrame())]) {
      try {
        const result = await ctx.evaluate((re) => {
          const el = [...document.querySelectorAll('button,a,[role="button"]')]
            .find(b => new RegExp(re, 'i').test(b.textContent) && b.offsetParent !== null)
          if (el) { el.click(); return el.textContent.trim() }
          return null
        }, regex.source || regex)
        if (result) return result
      } catch {}
    }
    await sleep(300)
  }
  return null
}

;(async () => {
  const t0 = Date.now()
  const lap = () => `+${((Date.now()-t0)/1000).toFixed(1)}s`
  console.log('=== Razer Regen Test — headless:false ===')

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

  try {
    const page = await browser.newPage()
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    // clear cookies + storage ก่อนเริ่ม
    const cdp = await page.createCDPSession()
    await cdp.send('Network.clearBrowserCookies')
    await cdp.send('Network.clearBrowserCache')
    console.log('[init] cleared cookies & cache')

    // ── Phase 0: เปิดหน้า security/codes ─────────────────────
    console.log('\n[Phase 0] goto security/codes...')
    await page.goto(SECURITY_URL, { waitUntil: 'networkidle2', timeout: 30000 })
      .catch(e => console.warn('[Phase 0] goto warn:', e.message))
    console.log(`[Phase 0] URL: ${page.url()} (${lap()})`)

    // ── Phase 0: Login ถ้ายังไม่ได้ login ────────────────────
    const needLogin = !page.url().includes('/account/security') || page.url().includes('/login') || page.url().includes('/signin')
    console.log(`[Phase 0] needLogin=${needLogin}`)

    if (needLogin) {
      // dismiss cookie popup ก่อน login
      for (let i = 0; i < 3; i++) {
        const d = await dismissCookiePopup(page)
        if (!d) break
      }

      console.log('[Phase 0] รอ email input...')
      await page.waitForSelector('#input-login-email, input[type="email"]', { timeout: 10000 })
      console.log(`[Phase 0] เจอ email input (${lap()})`)

      const filledEmail = await fillReact(page, ['#input-login-email', 'input[type="email"]'], EMAIL)
      console.log('[Phase 0] filled email via:', filledEmail)
      await sleep(150)
      const filledPass = await fillReact(page, ['#input-login-password', 'input[type="password"]'], PASSWORD)
      console.log('[Phase 0] filled pass via:', filledPass)
      await sleep(150)

      await page.waitForFunction(
        () => [...document.querySelectorAll('button')]
          .find(b => /log in|sign in/i.test(b.textContent))?.disabled === false,
        { timeout: 10000 }
      ).catch(() => {})

      const loginClicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')]
          .find(b => /log in|sign in/i.test(b.textContent))
        if (btn) { btn.click(); return btn.textContent.trim() }
        return null
      })
      console.log(`[Phase 0] login clicked: ${loginClicked} (${lap()})`)

      // รอให้ OTP input โผล่ หรือ login form หายแล้ว redirect
      console.log('[Phase 0] รอ OTP หรือ logged-in state...')
      await page.waitForFunction(
        () => {
          const hasOtp = !!document.querySelector('input[id^="otp-input-"]')
          const emailGone = !document.querySelector('#input-login-email')
          return hasOtp || (emailGone && window.location.pathname !== '/')
        },
        { timeout: 25000, polling: 300 }
      ).catch(() => {})
      console.log(`[Phase 0] state check — URL: ${page.url()} (${lap()})`)

      // ── ถ้าต้องกรอก OTP เพื่อ login (login 2FA) ──────────────
      let loginOtpFound = false
      try {
        loginOtpFound = await page.evaluate(() => !!document.querySelector('input[id^="otp-input-"]'))
      } catch {}

      if (loginOtpFound) {
        console.log(`[Phase 0] LOGIN 2FA — เจอ OTP input, กรอก: ${BACKUP_CODE}`)

        // กด "Choose a different method" / "Backup Codes" ก่อนถ้ายังไม่ได้
        const methodClicked = await page.evaluate(() => {
          const el = [...document.querySelectorAll('button,a,[role="button"]')]
            .find(b => /different|change.*method/i.test(b.textContent) && b.offsetParent !== null)
          if (el) { el.click(); return el.textContent.trim() }
          return null
        }).catch(() => null)
        if (methodClicked) {
          console.log('[Phase 0] different method:', methodClicked)
          await sleep(500)
          await waitForButton(page, /backup|รหัสสำรอง/i, 5000)
          await sleep(500)
        }

        // กรอก backup code
        await page.waitForSelector('input[id^="otp-input-"]', { timeout: 5000 }).catch(() => {})
        await page.evaluate(() => {
          const el = document.querySelector('input[id="otp-input-0"]')
          if (el) el.focus()
        })
        await sleep(100)
        for (const ch of BACKUP_CODE.replace(/\s/g, ''))
          await page.keyboard.type(ch, { delay: 50 })
        await sleep(300)

        const loginSubmit = await page.evaluate(() => {
          const btn = document.querySelector('button[type="submit"]')
            || [...document.querySelectorAll('button')]
                 .find(b => /submit|confirm|verify|continue|ยืนยัน|log.?in/i.test(b.textContent) && b.offsetParent !== null && !b.disabled)
          if (btn) { btn.click(); return btn.textContent.trim() || '(submit)' }
          return null
        })
        if (!loginSubmit) await page.keyboard.press('Enter')
        console.log(`[Phase 0] LOGIN 2FA submit: ${loginSubmit || 'Enter'} (${lap()})`)

        // รอ login สำเร็จ — OTP หายไป
        await page.waitForFunction(
          () => !document.querySelector('input[id^="otp-input-"]'),
          { timeout: 15000, polling: 300 }
        ).catch(() => {})
        await sleep(1000)
        console.log(`[Phase 0] after login 2FA — URL: ${page.url()} (${lap()})`)
      }

      // dismiss post-login popups (terms, marketing)
      for (let i = 0; i < 8; i++) {
        const clicked = await page.evaluate(() => {
          if (/agreement|terms|ข้อตกลง/i.test(document.body.innerText)) {
            const btn = [...document.querySelectorAll('button,a,[role="button"]')]
              .find(b => /^(accept|ยอมรับ|同意)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
            if (btn) { btn.click(); return 'accept:' + btn.textContent.trim() }
          }
          if (/contact permission|marketing/i.test(document.body.innerText)) {
            const btn = [...document.querySelectorAll('button,a,[role="button"]')]
              .find(b => /^(skip|ข้าม)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
            if (btn) { btn.click(); return 'skip:' + btn.textContent.trim() }
          }
          return null
        }).catch(() => null)
        if (clicked) { console.log('[Phase 0] popup:', clicked); await sleep(800) }
        else break
        await sleep(300)
      }

      // ✅ Navigate กลับไป security/codes หลัง login สำเร็จ
      console.log(`[Phase 0] navigate กลับไป security/codes... (${lap()})`)
      await page.goto(SECURITY_URL, { waitUntil: 'networkidle2', timeout: 30000 })
        .catch(e => console.warn('[Phase 0] goto2 warn:', e.message))
      console.log(`[Phase 0] URL หลัง goto2: ${page.url()} (${lap()})`)

      for (let i = 0; i < 3; i++) {
        const d = await dismissCookiePopup(page)
        if (!d) break
      }
    }

    // ── Phase 1: รอ Generate New Codes หรือ 2FA ───────────────
    console.log(`\n[Phase 1] รอปุ่ม Generate New Codes หรือ OTP... (${lap()})`)

    // dismiss cookie popup ที่อาจยังค้างอยู่
    for (let i = 0; i < 3; i++) {
      const d = await dismissCookiePopup(page)
      if (!d) break
    }

    let hasGenerateBtn = false
    await page.waitForFunction(
      () => {
        const hasGen = [...document.querySelectorAll('button,a,[role="button"]')]
          .some(b => /generate new codes|สร้างรหัสใหม่/i.test(b.textContent) && b.offsetParent !== null)
        const has2FA = !!document.querySelector('input[id^="otp-input-"]')
        return hasGen || has2FA
      },
      { timeout: 15000, polling: 300 }
    ).catch(() => {})

    hasGenerateBtn = await page.evaluate(() =>
      [...document.querySelectorAll('button,a,[role="button"]')]
        .some(b => /generate new codes|สร้างรหัสใหม่/i.test(b.textContent) && b.offsetParent !== null)
    )
    console.log(`[Phase 1] hasGenerateBtn=${hasGenerateBtn} (${lap()})`)
    await dumpButtons(page, 'Phase 1 end')

    // ── Phase 2: 2FA ถ้าต้องทำก่อน ────────────────────────────
    if (!hasGenerateBtn) {
      console.log('\n[Phase 2] ต้องผ่าน 2FA ก่อน...')

      const clicked2 = await waitForButton(page, /different|change.*method|เลือกวิธีการอื่น/i)
      console.log('[Phase 2] Different method:', clicked2 ? `✅ "${clicked2}"` : '❌ ไม่พบ')
      await sleep(400)
      await dumpButtons(page, 'Phase 2 after different method')

      const clickedBackup = await waitForButton(page, /backup|รหัสสำรอง/i)
      console.log('[Phase 2] Backup Codes:', clickedBackup ? `✅ "${clickedBackup}"` : '❌ ไม่พบ')
      await sleep(400)
      await dumpButtons(page, 'Phase 2 after backup codes click')

      await page.waitForSelector('input[id^="otp-input-"]', { timeout: 10000 }).catch(() => {})
      let otpCtx = page
      for (const ctx of [page, ...page.frames()]) {
        try {
          if (await ctx.evaluate(() => !!document.querySelector('input[id^="otp-input-"]')))
            { otpCtx = ctx; break }
        } catch {}
      }
      console.log(`[Phase 2] OTP input — กรอก: ${BACKUP_CODE} (${lap()})`)

      await otpCtx.evaluate(() => {
        const el = document.querySelector('input[id="otp-input-0"]')
        if (el) el.focus()
      })
      await sleep(100)
      for (const ch of BACKUP_CODE.replace(/\s/g, ''))
        await page.keyboard.type(ch, { delay: 50 })
      await sleep(200)

      const submitClicked = await otpCtx.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]')
          || [...document.querySelectorAll('button')]
               .find(b => /submit|confirm|verify|continue|ยืนยัน/i.test(b.textContent) && b.offsetParent !== null)
        if (btn) { btn.click(); return btn.textContent.trim() || '(icon button)' }
        return null
      })
      if (!submitClicked) await page.keyboard.press('Enter')
      console.log('[Phase 2] Submit:', submitClicked ? `✅ "${submitClicked}"` : '⚠️ กด Enter แทน')

      await page.waitForFunction(
        () => window.location.href.includes('/account/security'),
        { timeout: 15000, polling: 300 }
      ).catch(() => {})
      console.log(`[Phase 2] URL หลัง 2FA: ${page.url()} (${lap()})`)

      // dismiss cookie popup อีกรอบ
      for (let i = 0; i < 3; i++) {
        const d = await dismissCookiePopup(page)
        if (!d) break
      }
    }

    // ── Phase 3: กด Generate New Codes ───────────────────────
    console.log(`\n[Phase 3] กด Generate New Codes... (${lap()})`)
    await dumpButtons(page, 'Phase 3 before Generate')

    await page.waitForFunction(
      () => [...document.querySelectorAll('button,a,[role="button"]')]
        .some(b => /generate new codes|สร้างรหัสใหม่/i.test(b.textContent) && b.offsetParent !== null),
      { timeout: 15000, polling: 300 }
    ).catch(() => {})

    const clickedGenerate = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button,a,[role="button"]')]
        .find(b => /generate new codes|สร้างรหัสใหม่/i.test(b.textContent) && b.offsetParent !== null)
      if (el) { el.click(); return el.textContent.trim() }
      return null
    }).catch(() => null)
    console.log(`[Phase 3] Generate: ${clickedGenerate ? `✅ "${clickedGenerate}"` : '❌ ไม่พบ'} (${lap()})`)

    // ── Phase 4: Modal confirm ────────────────────────────────
    console.log(`\n[Phase 4] Modal confirm... (${lap()})`)

    await page.waitForFunction(
      () => [...document.querySelectorAll('button,a,[role="button"]')]
        .some(b => /^(generate|สร้าง)$/i.test(b.textContent.trim()) && b.offsetParent !== null),
      { timeout: 8000, polling: 200 }
    ).catch(() => {})

    await dumpButtons(page, 'Phase 4 modal')

    const clickedConfirm = await page.evaluate(() => {
      const el = [...document.querySelectorAll('button,a,[role="button"]')]
        .find(b => /^(generate|สร้าง)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
      if (el) { el.click(); return el.textContent.trim() }
      return null
    }).catch(() => null)
    console.log(`[Phase 4] Confirm: ${clickedConfirm ? `✅ "${clickedConfirm}"` : '❌ ไม่พบ'} (${lap()})`)

    // ── Phase 5: อ่าน codes ใหม่ ────────────────────────────
    console.log(`\n[Phase 5] รอ backup codes ใหม่... (${lap()})`)

    await page.waitForFunction(
      () => {
        const codeRe = /^\d{6,12}$/
        const found = [...document.querySelectorAll('*')]
          .filter(el => el.childElementCount === 0 && el.offsetParent !== null)
          .map(el => el.textContent.trim())
          .filter(t => codeRe.test(t))
        return [...new Set(found)].length >= 5
      },
      { timeout: 15000, polling: 300 }
    ).catch(() => {})

    const newCodes = await page.evaluate(() => {
      const codeRe = /^\d{6,12}$/
      const fromEls = [...document.querySelectorAll('*')]
        .filter(el => el.childElementCount === 0 && el.offsetParent !== null)
        .map(el => el.textContent.trim())
        .filter(t => codeRe.test(t))
      if (fromEls.length >= 5) return [...new Set(fromEls)]
      return [...new Set(document.body.innerText.split(/\s+/).filter(t => codeRe.test(t.trim())))]
    })

    console.log(`\n${'═'.repeat(40)}`)
    console.log(`  พบ ${newCodes.length} backup codes ใหม่: (${lap()})`)
    console.log('═'.repeat(40))
    newCodes.slice(0, 10).forEach((c, i) => console.log(`  [${i+1}] ${c}`))
    console.log('═'.repeat(40))

    if (newCodes.length < 5) {
      console.error('❌ codes น้อยกว่า 5 — อาจอ่านไม่ครบ')
    } else {
      console.log('✅ สำเร็จ')
    }

    console.log('\n[รอ 15s ก่อนปิด browser]')
    await sleep(15000)

  } finally {
    await browser.close()
    console.log('=== Done ===')
  }
})()
