const POLL_INTERVAL = 5000
const MAX_WAIT = 5 * 60 * 1000

async function callAndPoll(product_key, item_sku, input, apiKey, apiUrl) {
  const createRes = await fetch(`${apiUrl}/agent/orders/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ product_key, item_sku, input }),
  })
  let createData
  try { createData = await createRes.json() } catch { throw new Error(`API ตอบกลับผิดพลาด: ${createRes.status}`) }
  if (!createRes.ok) throw new Error(createData?.message || createData?.error || `API error ${createRes.status}`)

  const transactionId = createData?.order?.transactionId
  if (!transactionId) throw new Error('ไม่ได้รับ transactionId จาก API')

  const start = Date.now()
  while (Date.now() - start < MAX_WAIT) {
    await new Promise(res => setTimeout(res, POLL_INTERVAL))
    const statusRes = await fetch(`${apiUrl}/agent/orders/${transactionId}`, { headers: { 'X-Api-Key': apiKey } })
    const statusData = await statusRes.json().catch(() => ({}))
    const state = statusData.state
    const resultCode = statusData.result_code || null
    if (state === 'completed') return { transactionId, resultCode: resultCode || 'SUCCESS_DELIVERY_CONFIRMED' }
    if (state === 'failed' || state === 'refunded') throw new Error(`Order ${state}: ${resultCode || ''}`)
  }
  throw new Error('Order หมดเวลา (5 นาที)')
}

async function processPay24Item(orderItemId, { db, save, apiKey, apiUrl }) {
  // ตรวจสอบว่าเป็น bundle หรือไม่
  const bundleCheck = db.exec('SELECT bundle_lot_info FROM order_items WHERE id=?', [orderItemId])
  const bundleLotStr = bundleCheck[0]?.values[0][0]
  if (bundleLotStr) {
    let bundleLot = null
    try { bundleLot = JSON.parse(bundleLotStr) } catch {}
    if (bundleLot?.pay24_bundle_components) {
      return processPay24Bundle(orderItemId, bundleLot.pay24_bundle_components, { db, save, apiKey, apiUrl })
    }
  }

  // Single item mode
  const r = db.exec(
    'SELECT oi.pay24_input, p.pay24_data FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.id=?',
    [orderItemId]
  )
  if (!r[0]) throw new Error('ไม่พบ order item')

  const [pay24InputStr, pay24DataStr] = r[0].values[0]
  const input = (() => { try { return JSON.parse(pay24InputStr || '{}') } catch { return {} } })()
  const pd = (() => { try { return JSON.parse(pay24DataStr || '{}') } catch { return {} } })()

  const { product_key, item_sku } = pd
  if (!product_key || !item_sku) throw new Error('ไม่พบ product_key หรือ item_sku')
  if (!apiKey) throw new Error('ยังไม่ได้ตั้ง API Key')

  db.run('UPDATE order_items SET pay24_status=? WHERE id=?', ['processing', orderItemId])
  save()

  const { transactionId, resultCode } = await callAndPoll(product_key, item_sku, input, apiKey, apiUrl)
    .catch(e => {
      db.run('UPDATE order_items SET pay24_status=?, pay24_result_code=?, pay24_finished_at=? WHERE id=?',
        ['failed', e.message.slice(0, 100), new Date().toISOString(), orderItemId])
      save()
      throw e
    })

  db.run('UPDATE order_items SET pay24_status=?, pay24_result_code=?, pay24_transaction_id=?, pay24_finished_at=? WHERE id=?',
    ['success', resultCode, transactionId, new Date().toISOString(), orderItemId])
  save()
  return { success: true, transactionId }
}

async function processPay24Bundle(orderItemId, components, { db, save, apiKey, apiUrl }) {
  if (!apiKey) throw new Error('ยังไม่ได้ตั้ง API Key')

  const inputRes = db.exec('SELECT pay24_input FROM order_items WHERE id=?', [orderItemId])
  const input = (() => { try { return JSON.parse(inputRes[0]?.values[0][0] || '{}') } catch { return {} } })()

  db.run('UPDATE order_items SET pay24_status=? WHERE id=?', ['processing', orderItemId])
  save()

  let anyFailed = false

  for (let i = 0; i < components.length; i++) {
    if (components[i].status === 'success') continue  // ข้ามรายการที่สำเร็จแล้ว (กรณี retry)

    const pdRes = db.exec('SELECT pay24_data FROM products WHERE id=?', [components[i].product_id])
    const pd = (() => { try { return JSON.parse(pdRes[0]?.values[0][0] || '{}') } catch { return {} } })()
    const { product_key, item_sku } = pd

    if (!product_key || !item_sku) {
      components[i] = { ...components[i], status: 'failed', error: 'ไม่พบ product_key หรือ item_sku' }
      anyFailed = true
      db.run('UPDATE order_items SET bundle_lot_info=? WHERE id=?',
        [JSON.stringify({ pay24_bundle_components: components }), orderItemId])
      save()
      continue
    }

    components[i] = { ...components[i], status: 'processing' }
    db.run('UPDATE order_items SET bundle_lot_info=? WHERE id=?',
      [JSON.stringify({ pay24_bundle_components: components }), orderItemId])
    save()

    try {
      const { transactionId, resultCode } = await callAndPoll(product_key, item_sku, input, apiKey, apiUrl)
      components[i] = { ...components[i], status: 'success', transactionId, result_code: resultCode }
    } catch (e) {
      components[i] = { ...components[i], status: 'failed', error: e.message.slice(0, 200) }
      anyFailed = true
    }

    db.run('UPDATE order_items SET bundle_lot_info=? WHERE id=?',
      [JSON.stringify({ pay24_bundle_components: components }), orderItemId])
    save()
  }

  const finalStatus = anyFailed ? 'partial' : 'success'
  db.run('UPDATE order_items SET pay24_status=?, pay24_finished_at=? WHERE id=?',
    [finalStatus, new Date().toISOString(), orderItemId])
  save()
  return { success: !anyFailed, partial: anyFailed }
}

module.exports = { processPay24Item }
