const { parseAbi } = require('viem')

const ARBITER_ABI = parseAbi([
  'function settleOfframp((bytes allocatorData, bytes sponsorSignature, address sponsor, uint256 nonce, uint256 expires, bytes32 witness, string witnessTypestring, uint256 id, uint256 allocatedAmount, (uint256 claimant, uint256 amount)[] claimants) calldata claim) external',
])

// POST /compact — Smallocator returns allocatorData for a given compact.
// Verify exact request/response shape against your Smallocator version.
async function getAllocatorData(compact, smallocatorUrl) {
  const res = await fetch(`${smallocatorUrl}/compact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(compact),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Smallocator error ${res.status}: ${body}`)
  }
  const data = await res.json()
  return data.allocatorData
}

async function settle(order, { walletClient, publicClient, arbiterAddress, smallocatorUrl }) {
  const allocatorData = await getAllocatorData(
    {
      sponsor: order.sponsor,
      nonce: order.nonce,
      expires: order.expires,
      id: order.resourceLockId,
      allocatedAmount: order.allocatedAmount,
      witness: order.witness,
      witnessTypestring: order.witnessTypestring,
    },
    smallocatorUrl
  )

  // claimant = bytes12(0) ++ lpAddress — plain EOA withdrawal, no re-lock
  const claimant = BigInt(order.lpAddress)

  const claim = {
    allocatorData,
    sponsorSignature: order.sponsorSignature,
    sponsor: order.sponsor,
    nonce: BigInt(order.nonce),
    expires: BigInt(order.expires),
    witness: order.witness,
    witnessTypestring: order.witnessTypestring,
    id: BigInt(order.resourceLockId),
    allocatedAmount: BigInt(order.allocatedAmount),
    claimants: [{ claimant, amount: BigInt(order.allocatedAmount) }],
  }

  const txHash = await walletClient.writeContract({
    address: arbiterAddress,
    abi: ARBITER_ABI,
    functionName: 'settleOfframp',
    args: [claim],
  })

  await publicClient.waitForTransactionReceipt({ hash: txHash })
  return txHash
}

module.exports = { settle, getAllocatorData, ARBITER_ABI }
