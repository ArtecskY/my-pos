/**
 * test-razer-regen.js — เทส Regen flow headless:false
 * หยุดก่อน Phase 3 (Generate New Codes) เพื่อดูปุ่มภาษาไทย
 * รัน: node test-razer-regen.js
 */

const puppeteerExtra = require('puppeteer-extra')
const StealthPlugin  = require('puppeteer-extra-plugin-stealth')
puppeteerExtra.use(StealthPlugin())

const sleep = ms => new Promise(r => setTimeout(r, ms))

const EMAIL       = 'funn1que.zxc@gmail.com'
const PASSWORD    = '014785920Zxc'
const BACKUP_CODE = '11911389'

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

// dump ปุ่มที่มองเห็นทุกตัวบนหน้า
async function dumpButtons(page, label) {
  const btns = await page.evaluate(() =>
    [...document.querySelectorAll('button,a,[role="button"]')]
      .filter(b => b.offsetParent !== null && b.textContent.trim())
      .map(b => b.textContent.trim().slice(0, 80))
  )
  console.log(`\n[buttons visible @ ${label}]:`)
  btns.forEach((t, i) => console.log(`  [${i}] "${t}"`))
}

;(async () => {
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

    // ── Phase 0: เปิดหน้า security/codes ─────────────────────
    console.log('\n[Phase 0] เปิด razerid.razer.com/account/security/codes...')
    await page.goto('https://razerid.razer.com/account/security/codes',
      { waitUntil: 'networkidle2', timeout: 30000 })
    await sleep(3000)
    console.log('[Phase 0] URL:', page.url())

    // ── Phase 0: Login ถ้ายังไม่ได้ login ────────────────────
    if (!page.url().includes('/account/security')) {
      console.log('\n[Phase 0] ต้อง login...')

      // Cookie popup
      for (let attempt = 0; attempt < 4; attempt++) {
        const dismissed = await page.evaluate(() => {
          const saveBtn = [...document.querySelectorAll('button')]
            .find(b => /save my preferences/i.test(b.textContent) && b.offsetParent !== null)
          if (saveBtn) { saveBtn.click(); return 'Save My Preferences' }
          const closeBtn = [...document.querySelectorAll('button,a')]
            .find(el => /accept all|accept cookies|i agree/i.test(el.textContent) && el.offsetParent !== null)
          if (closeBtn) { closeBtn.click(); return closeBtn.textContent.trim() }
          return null
        })
        if (dismissed) { console.log('[Phase 0] cookie dismissed:', dismissed); await sleep(1000) }
        else break
      }

      await page.waitForSelector('#input-login-email, input[type="email"]', { timeout: 10000 })
      await fillReact(page, ['#input-login-email', 'input[type="email"]'], EMAIL)
      await sleep(300)
      await fillReact(page, ['#input-login-password', 'input[type="password"]'], PASSWORD)
      await sleep(300)

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
      console.log('[Phase 0] login clicked:', loginClicked)
      await sleep(5000)

      // Post-login popups
      for (let i = 0; i < 8; i++) {
        const clicked = await page.evaluate(() => {
          const isAgreement = /agreement|terms|ข้อตกลง/i.test(document.body.innerText)
          if (isAgreement) {
            const btn = [...document.querySelectorAll('button,a,[role="button"]')]
              .find(b => /^(accept|ยอมรับ|同意)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
            if (btn) { btn.click(); return 'accept:' + btn.textContent.trim() }
          }
          const isPermission = /contact permission|marketing/i.test(document.body.innerText)
          if (isPermission) {
            const btn = [...document.querySelectorAll('button,a,[role="button"]')]
              .find(b => /^(skip|ข้าม)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
            if (btn) { btn.click(); return 'skip:' + btn.textContent.trim() }
          }
          return null
        })
        if (clicked) { console.log('[Phase 0] popup:', clicked); await sleep(2000) }
        else break
        await sleep(1000)
      }

      for (let i = 0; i < 30; i++) {
        await sleep(1000)
        if (page.url().includes('/account/security')) break
      }
    }

    console.log('[Phase 0] URL หลัง login:', page.url())

    // ── Phase 1: รอ Generate New Codes หรือ 2FA ───────────────
    console.log('\n[Phase 1] รอปุ่ม Generate New Codes หรือ OTP...')
    let hasGenerateBtn = false
    for (let i = 0; i < 10; i++) {
      await sleep(1000)
      hasGenerateBtn = await page.evaluate(() =>
        [...document.querySelectorAll('button,a,[role="button"]')]
          .some(b => /generate new codes|สร้างรหัสใหม่/i.test(b.textContent) && b.offsetParent !== null)
      )
      if (hasGenerateBtn) { console.log(`[Phase 1] ✅ เจอปุ่ม Generate New Codes (${i+1}s)`); break }
      const has2FA = await page.evaluate(() => !!document.querySelector('input[id^="otp-input-"]'))
      if (has2FA) { console.log(`[Phase 1] ⚠️ เจอ OTP input แทน (${i+1}s)`); break }
      console.log(`  รอ... ${i+1}s`)
    }

    await dumpButtons(page, 'Phase 1 end')

    // ── Phase 2: 2FA ถ้าต้องทำก่อน ────────────────────────────
    if (!hasGenerateBtn) {
      console.log('\n[Phase 2] ต้องผ่าน 2FA ก่อน...')

      // กด different method
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
      console.log('[Phase 2] Different method:', clicked2 ? `✅ "${clicked2}"` : '❌ ไม่พบ')
      await sleep(1000)
      await dumpButtons(page, 'Phase 2 after different method')

      // กด Backup Codes
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
      console.log('[Phase 2] Backup Codes:', clickedBackup ? `✅ "${clickedBackup}"` : '❌ ไม่พบ')
      await sleep(1000)
      await dumpButtons(page, 'Phase 2 after backup codes click')

      // รอ OTP input
      await page.waitForSelector('input[id^="otp-input-"]', { timeout: 10000 }).catch(() => {})
      let otpCtx = page
      for (const ctx of [page, ...page.frames()]) {
        try {
          if (await ctx.evaluate(() => !!document.querySelector('input[id^="otp-input-"]')))
            { otpCtx = ctx; break }
        } catch {}
      }
      console.log('[Phase 2] OTP input found — กรอก code:', BACKUP_CODE)

      await otpCtx.evaluate(() => {
        const el = document.querySelector('input[id="otp-input-0"]')
        if (el) el.focus()
      })
      await sleep(200)
      for (const ch of BACKUP_CODE.replace(/\s/g, ''))
        await page.keyboard.type(ch, { delay: 80 })
      await sleep(300)

      // Submit
      const submitClicked = await otpCtx.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]')
          || [...document.querySelectorAll('button')]
               .find(b => /submit|confirm|verify|continue|ยืนยัน/i.test(b.textContent) && b.offsetParent !== null)
        if (btn) { btn.click(); return btn.textContent.trim() || '(icon button)' }
        return null
      })
      if (!submitClicked) await page.keyboard.press('Enter')
      console.log('[Phase 2] Submit:', submitClicked ? `✅ "${submitClicked}"` : '⚠️ กด Enter แทน')

      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {})
      await sleep(2000)
      console.log('[Phase 2] URL หลัง submit:', page.url())
    }

    // ── Phase 3: กด Generate New Codes ───────────────────────
    console.log('\n[Phase 3] กด Generate New Codes...')
    await dumpButtons(page, 'Phase 3 before Generate')

    let clickedGenerate = null
    for (let i = 0; i < 15; i++) {
      clickedGenerate = await page.evaluate(() => {
        const el = [...document.querySelectorAll('button,a,[role="button"]')]
          .find(b => /generate new codes|สร้างรหัสใหม่/i.test(b.textContent) && b.offsetParent !== null)
        if (el) { el.click(); return el.textContent.trim() }
        return null
      }).catch(() => null)
      if (clickedGenerate) break
      await sleep(1000)
    }
    console.log('[Phase 3] Generate New Codes:', clickedGenerate ? `✅ "${clickedGenerate}"` : '❌ ไม่พบ')
    await sleep(2000)

    // ── Phase 4: Modal confirm ────────────────────────────────
    console.log('\n[Phase 4] Modal confirm...')
    await dumpButtons(page, 'Phase 4 modal')

    const modalBtns = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter(b => b.offsetParent !== null)
        .map(b => ({ text: b.textContent.trim(), type: b.type, id: b.id }))
    )
    console.log('[Phase 4] All visible buttons:', JSON.stringify(modalBtns, null, 2))

    let clickedConfirm = null
    for (let i = 0; i < 10; i++) {
      clickedConfirm = await page.evaluate(() => {
        const el = [...document.querySelectorAll('button,a,[role="button"]')]
          .find(b => /^(generate|สร้าง)$/i.test(b.textContent.trim()) && b.offsetParent !== null)
        if (el) { el.click(); return el.textContent.trim() }
        return null
      }).catch(() => null)
      if (clickedConfirm) break
      await sleep(500)
    }
    console.log('[Phase 4] Confirm:', clickedConfirm ? `✅ "${clickedConfirm}"` : '❌ ไม่พบ')
    await sleep(3000)

    // ── Phase 5: อ่าน codes ใหม่ ────────────────────────────
    console.log('\n[Phase 5] อ่าน backup codes ใหม่...')
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
    console.log(`  พบ ${newCodes.length} backup codes ใหม่:`)
    console.log('═'.repeat(40))
    newCodes.slice(0, 10).forEach((c, i) => console.log(`  [${i+1}] ${c}`))
    console.log('═'.repeat(40))

    if (newCodes.length < 5) {
      console.error('❌ codes น้อยกว่า 5 — อาจอ่านไม่ครบ')
    } else {
      console.log('✅ สำเร็จ — copy codes ด้านบนได้เลย')
    }

    console.log('\n[รอ 30s ก่อนปิด browser]')
    await sleep(30000)

  } finally {
    await browser.close()
    console.log('=== Done ===')
  }
})()
