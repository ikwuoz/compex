'use client'

import { useSignTypedData, useAccount } from 'wagmi'
import { Address, parseUnits, keccak256, encodeAbiParameters, toHex } from 'viem'

// ─── Constants ──────────────────────────────────────────────
const COMPACT_DOMAIN = {
  name: 'TheCompact',
  version: '0',
  chainId: 8453,
  verifyingContract: '0x00000000000000171ede64904551eeDF3C6C9788' as Address
} as const

const COMPACT_TYPES = {
  Compact: [
    { name: 'arbiter', type: 'address' },
    { name: 'sponsor', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expires', type: 'uint256' },
    { name: 'lockTag', type: 'bytes12' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'mandate', type: 'Mandate' }
  ],
  Mandate: [
    { name: 'bankAccount', type: 'string' },
    { name: 'amountNGN', type: 'uint96' },
    { name: 'orderRef', type: 'string' },
    { name: 'deadline', type: 'uint32' }
  ]
} as const

// The Compact contract address
const THE_COMPACT = '0x00000000000000171ede64904551eeDF3C6C9788' as Address

// ─── Types ──────────────────────────────────────────────────
export interface Mandate {
  bankAccount: string
  amountNGN: bigint
  orderRef: string
  deadline: bigint
}

export interface CompactInput {
  arbiter: Address
  lockTag: `0x${string}`
  token: Address
  amount: string
  mandate: Mandate
  expires?: number
}

export interface SignedCompact {
  sponsorSignature: `0x${string}`
  allocatorSignature: `0x${string}`
  sponsor: Address
  nonce: number
  expires: number
  witness: `0x${string}`
  witnessTypestring: string
  id: bigint
  allocatedAmount: bigint
  claimants: Array<{ claimant: bigint; amount: bigint }>
}

// ─── Helper: derive resource lock ID from lockTag + token ───
export function deriveLockId(lockTag: `0x${string}`, token: Address): bigint {
  // lockTag is bytes12, token is address (bytes20)
  // id = (lockTag as uint96) << 160 | token
  const lockTagBig = BigInt(lockTag)
  const tokenBig = BigInt(token)
  return (lockTagBig << BigInt(160)) | tokenBig
}

// ─── Helper: compute witness hash ───────────────────────────
export function computeWitnessHash(mandate: Mandate): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'bankAccount', type: 'string' },
        { name: 'amountNGN', type: 'uint96' },
        { name: 'orderRef', type: 'string' },
        { name: 'deadline', type: 'uint32' }
      ],
      [
        mandate.bankAccount,
        mandate.amountNGN,
        mandate.orderRef,
        Number(mandate.deadline)
      ]
    )
  )
}

// ─── Hook ───────────────────────────────────────────────────
export function useSignCompact(backendUrl: string = 'http://localhost:3001') {
  const { address: sponsor } = useAccount()
  const { signTypedDataAsync, data: sponsorSig, isPending: signing } = useSignTypedData()

  const signCompact = async (input: CompactInput): Promise<SignedCompact> => {
    if (!sponsor) throw new Error('Wallet not connected')

    const { arbiter, lockTag, token, amount, mandate, expires } = input
    const deadline = expires || Math.floor(Date.now() / 1000) + 3600

    // Build the compact message
    const compactMessage = {
      arbiter,
      sponsor,
      nonce: BigInt(0), // placeholder — backend provides real nonce
      expires: BigInt(deadline),
      lockTag,
      token,
      amount: parseUnits(amount, 6),
      mandate: {
        bankAccount: mandate.bankAccount,
        amountNGN: mandate.amountNGN,
        orderRef: mandate.orderRef,
        deadline: Number(mandate.deadline || BigInt(deadline))
      }
    }

    // ── Step 1: Sponsor signs with wallet ────────────────────
    const sponsorSignature = await signTypedDataAsync({
      account: sponsor,
      domain: COMPACT_DOMAIN,
      types: COMPACT_TYPES,
      primaryType: 'Compact',
      message: compactMessage
    })

    // ── Step 2: Get allocator signature from backend ─────────
    const allocatorRes = await fetch(`${backendUrl}/sign-compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arbiter,
        sponsor,
        lockTag,
        token,
        amount,
        mandate: {
          bankAccount: mandate.bankAccount,
          amountNGN: mandate.amountNGN.toString(),
          orderRef: mandate.orderRef,
          deadline: Number(mandate.deadline || deadline)
        },
        expires: deadline
      })
    })

    if (!allocatorRes.ok) {
      const err = await allocatorRes.json().catch(() => ({}))
      throw new Error(err.error || `Allocator signing failed: ${allocatorRes.status}`)
    }

    const allocatorData = await allocatorRes.json()
    const allocatorSignature = allocatorData.allocatorSignature as `0x${string}`
    const nonce = allocatorData.nonce as number
    const finalExpires = allocatorData.expires as number

    // ── Step 3: Build Claim-ready payload ────────────────────
    const lockId = deriveLockId(lockTag, token)
    const witness = computeWitnessHash(mandate)
    const witnessTypestring = 'Mandate mandate)Mandate(string bankAccount,uint96 amountNGN,string orderRef,uint32 deadline)'
    const parsedAmount = parseUnits(amount, 6)

    // claimant = lockTag + recipient (arbiter in this case, since arbiter receives)
    const claimantValue = (BigInt(lockTag) << BigInt(160)) | BigInt(arbiter)

    return {
      sponsorSignature,
      allocatorSignature,
      sponsor,
      nonce,
      expires: finalExpires,
      witness,
      witnessTypestring,
      id: lockId,
      allocatedAmount: parsedAmount,
      claimants: [{ claimant: claimantValue, amount: parsedAmount }]
    }
  }

  return {
    signCompact,
    sponsorSignature: sponsorSig,
    isLoading: signing,
    sponsor
  }
}
