const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { createOrder, getOrder, listOpenOrders, lockOrder, settleOrder, _reset } = require('../lib/orders')

const sample = {
  sponsor: '0xabc',
  token: '0xusdc',
  amount: '100',
  nonce: 1,
  expires: 9999999999,
  id: '12345',
  allocatedAmount: '100000000',
  witness: '0xdeadbeef',
  witnessTypestring: 'string bankAccount',
  sponsorSignature: '0xcafe',
  mandate: { bankAccount: '0123456789', amountNGN: '150000', orderRef: 'REF-001', deadline: 9999999999 },
}

beforeEach(() => _reset())

test('createOrder returns order with open status and uuid', () => {
  const order = createOrder(sample)
  assert.equal(order.status, 'open')
  assert.match(order.id, /^[0-9a-f-]{36}$/)
  assert.equal(order.sponsor, sample.sponsor)
})

test('getOrder returns null for unknown id', () => {
  assert.equal(getOrder('nope'), null)
})

test('getOrder returns order after create', () => {
  const { id } = createOrder(sample)
  assert.ok(getOrder(id))
})

test('listOpenOrders returns only open orders', () => {
  const a = createOrder(sample)
  const b = createOrder(sample)
  lockOrder(b.id, '0xlp')
  const open = listOpenOrders()
  assert.equal(open.length, 1)
  assert.equal(open[0].id, a.id)
})

test('lockOrder sets status and lpAddress', () => {
  const { id } = createOrder(sample)
  const order = lockOrder(id, '0xlp')
  assert.equal(order.status, 'locked')
  assert.equal(order.lpAddress, '0xlp')
  assert.ok(order.lockedAt)
})

test('lockOrder returns null for unknown order', () => {
  assert.equal(lockOrder('nope', '0xlp'), null)
})

test('lockOrder returns null if order is already locked', () => {
  const { id } = createOrder(sample)
  lockOrder(id, '0xlp1')
  assert.equal(lockOrder(id, '0xlp2'), null)
})

test('settleOrder sets status and txHash', () => {
  const { id } = createOrder(sample)
  lockOrder(id, '0xlp')
  const order = settleOrder(id, '0xtxhash')
  assert.equal(order.status, 'settled')
  assert.equal(order.txHash, '0xtxhash')
  assert.ok(order.settledAt)
})

test('settleOrder returns null for unknown order', () => {
  assert.equal(settleOrder('nope', '0xtx'), null)
})
