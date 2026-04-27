const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../dev.env') })

const express = require('express')
const { createPublicClient, createWalletClient, http } = require('viem')
const { privateKeyToAccount } = require('viem/accounts')
const { base } = require('viem/chains')

const { createOrder, getOrder, listOpenOrders, lockOrder, settleOrder } = require('./lib/orders')
const { settle: defaultSettle } = require('./lib/settlement')

const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY
const ARBITER_ADDRESS    = process.env.ARBITER_ADDRESS
const SMALLOCATOR_URL    = process.env.SMALLOCATOR_URL || 'http://localhost:3001'
const BASE_RPC_URL       = process.env.BASE_RPC_URL    || 'https://mainnet.base.org'

// createApp accepts an optional settle override so tests can inject a fake.
function createApp({ settle } = {}) {
  let account, publicClient, walletClient

  if (!settle) {
    if (!ORACLE_PRIVATE_KEY) throw new Error('ORACLE_PRIVATE_KEY is required')
    if (!ARBITER_ADDRESS)    throw new Error('ARBITER_ADDRESS is required')
    account      = privateKeyToAccount(ORACLE_PRIVATE_KEY)
    publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL) })
    walletClient = createWalletClient({ chain: base, transport: http(BASE_RPC_URL), account })
    settle = (order) => defaultSettle(order, { walletClient, publicClient, arbiterAddress: ARBITER_ADDRESS, smallocatorUrl: SMALLOCATOR_URL })
  }

  const app = express()
  app.use(express.json())

  // ── POST /orders ───────────────────────────────────────────
  app.post('/orders', (req, res) => {
    const { sponsor, token, amount, nonce, expires, id, allocatedAmount, witness, witnessTypestring, sponsorSignature, mandate } = req.body
    if (!sponsor || !token || !amount || nonce == null || !expires || !id || !allocatedAmount || !witness || !witnessTypestring || !sponsorSignature || !mandate) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    if (!mandate.bankAccount || !mandate.amountNGN || !mandate.orderRef) {
      return res.status(400).json({ error: 'Missing mandate fields' })
    }
    res.status(201).json(createOrder(req.body))
  })

  // ── GET /orders ────────────────────────────────────────────
  app.get('/orders', (_req, res) => {
    res.json(listOpenOrders())
  })

  // ── PATCH /orders/:id/lock ─────────────────────────────────
  app.patch('/orders/:id/lock', (req, res) => {
    const { lpAddress } = req.body
    if (!lpAddress) return res.status(400).json({ error: 'lpAddress is required' })
    const order = lockOrder(req.params.id, lpAddress)
    if (!order) return res.status(404).json({ error: 'Order not found or not open' })
    res.json(order)
  })

  // ── POST /confirm-receipt ──────────────────────────────────
  app.post('/confirm-receipt', async (req, res) => {
    const { orderId } = req.body
    if (!orderId) return res.status(400).json({ error: 'orderId is required' })
    const order = getOrder(orderId)
    if (!order)                    return res.status(404).json({ error: 'Order not found' })
    if (order.status === 'settled') return res.status(409).json({ error: 'Already settled' })
    if (order.status !== 'locked') return res.status(400).json({ error: 'Order not locked by an LP yet' })
    try {
      const txHash = await settle(order)
      settleOrder(orderId, txHash)
      res.json({ success: true, txHash, explorerUrl: `https://basescan.org/tx/${txHash}` })
    } catch (err) {
      console.error('Settlement error:', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── GET /health ────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', oracle: account?.address, arbiter: ARBITER_ADDRESS, chain: 'base' })
  })

  return app
}

module.exports = { createApp }

if (require.main === module) {
  const app = createApp()
  const PORT = process.env.PORT || 3002
  app.listen(PORT, () => {
    console.log(`Compex backend on port ${PORT}`)
    console.log(`  Arbiter: ${ARBITER_ADDRESS}`)
  })
}
