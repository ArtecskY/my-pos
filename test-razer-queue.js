/**
 * ทดสอบ queue logic ของ Razer Auto multi-pack
 * ไม่ต้องใช้ browser จริง / DB จริง / URL จริง
 */

// ── Mock queue เลียนแบบ index.js ──────────────────────────────
const razerQueue = []
let razerQueueRunning = false
const log = []

function enqueueRazerOrder(orderId, order, jobIndex = 1, totalJobs = 1) {
  razerQueue.push({ orderId, order, jobIndex, totalJobs })
  log.push(`enqueue order#${orderId} job${jobIndex}/${totalJobs} url=${order.userFields.urlLink}`)
  processRazerQueue()
}

function processRazerQueue() {
  if (razerQueueRunning || razerQueue.length === 0) return
  const { orderId, order, jobIndex, totalJobs } = razerQueue.shift()
  razerQueueRunning = true
  log.push(`start   order#${orderId} job${jobIndex}/${totalJobs}`)
  mockRunRazerOrder(orderId, order, jobIndex, totalJobs)
    .then(() => {
      if (jobIndex === totalJobs) {
        log.push(`done    order#${orderId} → status=success (${totalJobs}/${totalJobs} ชิ้น)`)
      } else {
        log.push(`done    order#${orderId} job${jobIndex}/${totalJobs} → รอชิ้นถัดไป...`)
      }
    })
    .catch(e => {
      log.push(`FAILED  order#${orderId} job${jobIndex}/${totalJobs} → ${e.message}`)
    })
    .finally(() => {
      razerQueueRunning = false
      processRazerQueue()
    })
}

// Mock bot — simulate 80ms per job
function mockRunRazerOrder(orderId, order, jobIndex, totalJobs) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (order.userFields.urlLink.includes('fail')) {
        reject(new Error('mock checkout failed'))
      } else {
        resolve()
      }
    }, 80)
  })
}

// ── Helper: สร้าง jobs จาก cart เหมือน index.js ──────────────
function buildJobs(razerItems, urlList) {
  const jobs = []
  let urlIdx = 0
  for (const item of razerItems) {
    for (let q = 0; q < item.quantity && urlIdx < urlList.length; q++, urlIdx++) {
      jobs.push({ packageId: item.product_id, url: urlList[urlIdx] })
    }
  }
  return jobs
}

// ── Test 1: 1 สินค้า quantity=2, 2 URLs ─────────────────────
function test1() {
  return new Promise(resolve => {
    log.push('=== Test 1: 1 สินค้า qty=2, URLs=[url-A, url-B] ===')
    const items = [{ product_id: 10, quantity: 2 }]
    const urls  = ['https://pay.gold.razer.com/url-A', 'https://pay.gold.razer.com/url-B']
    const jobs  = buildJobs(items, urls)
    const total = jobs.length
    jobs.forEach((job, i) => {
      enqueueRazerOrder(1, { gameId: 99, packageId: job.packageId, userFields: { urlLink: job.url } }, i + 1, total)
    })
    setTimeout(resolve, 500)
  })
}

// ── Test 2: 2 สินค้าต่างชนิด qty=1 แต่ละตัว, 2 URLs ─────────
function test2() {
  return new Promise(resolve => {
    log.push('=== Test 2: 2 สินค้าต่างชนิด qty=1 each, URLs=[url-C, url-D] ===')
    const items = [{ product_id: 11, quantity: 1 }, { product_id: 12, quantity: 1 }]
    const urls  = ['https://pay.gold.razer.com/url-C', 'https://pay.gold.razer.com/url-D']
    const jobs  = buildJobs(items, urls)
    const total = jobs.length
    jobs.forEach((job, i) => {
      enqueueRazerOrder(2, { gameId: 99, packageId: job.packageId, userFields: { urlLink: job.url } }, i + 1, total)
    })
    setTimeout(resolve, 500)
  })
}

// ── Test 3: job แรก fail, job 2 ยังทำงานต่อ ─────────────────
function test3() {
  return new Promise(resolve => {
    log.push('=== Test 3: job แรก fail, job 2 ยังทำงานต่อ ===')
    const urls = ['https://pay.gold.razer.com/url-fail', 'https://pay.gold.razer.com/url-E']
    const jobs = buildJobs([{ product_id: 13, quantity: 2 }], urls)
    const total = jobs.length
    jobs.forEach((job, i) => {
      enqueueRazerOrder(3, { gameId: 99, packageId: job.packageId, userFields: { urlLink: job.url } }, i + 1, total)
    })
    setTimeout(resolve, 500)
  })
}

// ── Test 4: 1 สินค้า qty=1 (เดิม ยังทำงานได้ปกติ) ───────────
function test4() {
  return new Promise(resolve => {
    log.push('=== Test 4: 1 สินค้า qty=1 (backward compat) ===')
    const urls = ['https://pay.gold.razer.com/url-F']
    const jobs = buildJobs([{ product_id: 14, quantity: 1 }], urls)
    const total = jobs.length
    jobs.forEach((job, i) => {
      enqueueRazerOrder(4, { gameId: 99, packageId: job.packageId, userFields: { urlLink: job.url } }, i + 1, total)
    })
    setTimeout(resolve, 500)
  })
}

// ── Run all ──────────────────────────────────────────────────
;(async () => {
  await test1()
  await test2()
  await test3()
  await test4()
  console.log('\n--- Queue Log ---')
  log.forEach(l => console.log(l))

  // ── Assertions ───────────────────────────────────────────
  console.log('\n--- Assertions ---')

  const check = (desc, cond) => console.log((cond ? 'PASS' : 'FAIL') + ' ' + desc)

  check('Test1: enqueue 2 jobs', log.filter(l => l.includes('order#1')).filter(l => l.startsWith('enqueue')).length === 2)
  check('Test1: start job 1 ก่อน job 2', (() => {
    const starts = log.filter(l => l.includes('order#1') && l.startsWith('start'))
    return starts[0]?.includes('job1/2') && starts[1]?.includes('job2/2')
  })())
  check('Test1: job2 start หลัง job1 done', (() => {
    const lines = log.filter(l => l.includes('order#1') && (l.startsWith('start') || l.startsWith('done')))
    const j1done = lines.findIndex(l => l.includes('job1/2') && l.startsWith('done'))
    const j2start = lines.findIndex(l => l.includes('job2/2') && l.startsWith('start'))
    return j1done < j2start
  })())
  check('Test1: success ที่ job2 (last)', log.some(l => l.includes('order#1') && l.includes('success') && l.includes('2/2 ชิ้น')))

  check('Test2: enqueue 2 jobs สินค้าต่างชนิด', log.filter(l => l.includes('order#2')).filter(l => l.startsWith('enqueue')).length === 2)
  check('Test2: success ที่ job2', log.some(l => l.includes('order#2') && l.includes('success')))

  check('Test3: job1 fail ไม่หยุด job2', log.some(l => l.includes('order#3') && l.includes('job2/2') && l.startsWith('start')))
  check('Test3: job2 success แม้ job1 fail', log.some(l => l.includes('order#3') && l.includes('success') && l.includes('2/2 ชิ้น')))

  check('Test4: 1 job backward compat', log.filter(l => l.includes('order#4') && l.startsWith('enqueue')).length === 1)
  check('Test4: success', log.some(l => l.includes('order#4') && l.includes('success')))
})()
