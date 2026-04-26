const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const { createApp } = require('../index')
const { _reset } = require('../lib/orders')

const app = createApp({ settle: async () => '0xtxhash123' })

// Minimal HTTP test helper — no extra dependencies needed
const http = require('http')

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app)
    server.listen(0, () => {
      const port = server.address().port
      const payload = body ? JSON.stringify(body) : null
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      }
      const req = http.request(options, res => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          server.close()
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        })
      })
      req.on('error', err => { server.close(); reject(err) })
      if (payload) req.write(payload)
      req.end()
    })
  })
}

const sampleOrder = {
  sponsor: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '100',
  nonce: 1,
  expires: 9999999999,
  id: '99999',
  allocatedAmount: '100000000',
  witness: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  witnessTypestring: 'string bankAccount,uint96 amountNGN,string orderRef,uint32 deadline',
  sponsorSignature: '0xcafebabe',
  mandate: { bankAccount: '0123456789', amountNGN: '150000', orderRef: 'REF-001', deadline: 9999999999 },
}

beforeEach(() => _reset())

// ── POST /orders ──────────────────────────────────────────────

test('POST /orders creates an order', async () => {
  const res = await request('POST', '/orders', sampleOrder)
  assert.equal(res.status, 201)
  assert.equal(res.body.status, 'open')
  assert.equal(res.body.sponsor, sampleOrder.sponsor)
  assert.match(res.body.id, /^[0-9a-f-]{36}$/)
})

test('POST /orders 400 on missing fields', async () => {
  const res = await request('POST', '/orders', { sponsor: '0xabc' })
  assert.equal(res.status, 400)
})

// ── GET /orders ───────────────────────────────────────────────

test('GET /orders returns only open orders', async () => {
  const created = await request('POST', '/orders', sampleOrder)
  const orderId = created.body.id
  await request('POST', '/orders', sampleOrder) // second order, stays open

  // lock the first
  await request('PATCH', `/orders/${orderId}/lock`, { lpAddress: '0xlp' })

  const res = await request('GET', '/orders', null)
  assert.equal(res.status, 200)
  assert.equal(res.body.length, 1)
  assert.equal(res.body[0].status, 'open')
})

// ── PATCH /orders/:id/lock ────────────────────────────────────

test('PATCH /orders/:id/lock locks an open order', async () => {
  const created = await request('POST', '/orders', sampleOrder)
  const res = await request('PATCH', `/orders/${created.body.id}/lock`, { lpAddress: '0xLP' })
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'locked')
  assert.equal(res.body.lpAddress, '0xLP')
})

test('PATCH /orders/:id/lock 400 on missing lpAddress', async () => {
  const created = await request('POST', '/orders', sampleOrder)
  const res = await request('PATCH', `/orders/${created.body.id}/lock`, {})
  assert.equal(res.status, 400)
})

test('PATCH /orders/:id/lock 404 on unknown id', async () => {
  const res = await request('PATCH', '/orders/unknown-id/lock', { lpAddress: '0xlp' })
  assert.equal(res.status, 404)
})

test('PATCH /orders/:id/lock 404 if already locked', async () => {
  const created = await request('POST', '/orders', sampleOrder)
  await request('PATCH', `/orders/${created.body.id}/lock`, { lpAddress: '0xlp1' })
  const res = await request('PATCH', `/orders/${created.body.id}/lock`, { lpAddress: '0xlp2' })
  assert.equal(res.status, 404)
})

// ── POST /confirm-receipt ─────────────────────────────────────

test('POST /confirm-receipt settles a locked order', async () => {
  const created = await request('POST', '/orders', sampleOrder)
  const orderId = created.body.id
  await request('PATCH', `/orders/${orderId}/lock`, { lpAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' })

  const res = await request('POST', '/confirm-receipt', { orderId })
  assert.equal(res.status, 200)
  assert.equal(res.body.success, true)
  assert.equal(res.body.txHash, '0xtxhash123')
})

test('POST /confirm-receipt 404 on unknown order', async () => {
  const res = await request('POST', '/confirm-receipt', { orderId: 'nope' })
  assert.equal(res.status, 404)
})

test('POST /confirm-receipt 409 if already settled', async () => {
  const created = await request('POST', '/orders', sampleOrder)
  const orderId = created.body.id
  await request('PATCH', `/orders/${orderId}/lock`, { lpAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' })
  await request('POST', '/confirm-receipt', { orderId })

  const res = await request('POST', '/confirm-receipt', { orderId })
  assert.equal(res.status, 409)
})

test('POST /confirm-receipt 400 if not locked', async () => {
  const created = await request('POST', '/orders', sampleOrder)
  const res = await request('POST', '/confirm-receipt', { orderId: created.body.id })
  assert.equal(res.status, 400)
})

test('POST /confirm-receipt 400 on missing orderId', async () => {
  const res = await request('POST', '/confirm-receipt', {})
  assert.equal(res.status, 400)
})

// ── GET /health ───────────────────────────────────────────────

test('GET /health returns ok', async () => {
  const res = await request('GET', '/health', null)
  assert.equal(res.status, 200)
  assert.equal(res.body.status, 'ok')
})
