const { randomUUID } = require('crypto')

const orders = new Map()

function createOrder({ sponsor, token, amount, nonce, expires, id, allocatedAmount, witness, witnessTypestring, sponsorSignature, mandate }) {
  const orderId = randomUUID()
  const order = {
    id: orderId,
    status: 'open',
    createdAt: Date.now(),
    sponsor,
    token,
    amount,
    nonce,
    expires,
    resourceLockId: id,
    allocatedAmount,
    witness,
    witnessTypestring,
    sponsorSignature,
    mandate,
    lpAddress: null,
    txHash: null,
  }
  orders.set(orderId, order)
  return order
}

function getOrder(id) {
  return orders.get(id) ?? null
}

function listOpenOrders() {
  return [...orders.values()].filter(o => o.status === 'open')
}

function lockOrder(id, lpAddress) {
  const order = orders.get(id)
  if (!order || order.status !== 'open') return null
  order.status = 'locked'
  order.lpAddress = lpAddress
  order.lockedAt = Date.now()
  return order
}

function settleOrder(id, txHash) {
  const order = orders.get(id)
  if (!order) return null
  order.status = 'settled'
  order.txHash = txHash
  order.settledAt = Date.now()
  return order
}

function _reset() {
  orders.clear()
}

module.exports = { createOrder, getOrder, listOpenOrders, lockOrder, settleOrder, _reset }
