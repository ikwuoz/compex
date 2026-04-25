const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../dev.env') });

const express = require('express');
const { createPublicClient, createWalletClient, http, parseAbi, keccak256, encodeAbiParameters, parseUnits } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { baseSepolia } = require('viem/chains');

const app = express();
app.use(express.json());

// ─── Configuration ──────────────────────────────────────────
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://sepolia.base.org';
const ARBITER_CONTRACT_ADDRESS = process.env.ARBITER_ADDRESS || '0x0000000000000000000000000000000000000000';
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY;
const ALLOCATOR_ID = process.env.ALLOCATOR_ID; // uint96 allocator ID from The Compact

if (!ORACLE_PRIVATE_KEY) {
  throw new Error('ORACLE_PRIVATE_KEY environment variable is required');
}

// ─── Viem Setup ─────────────────────────────────────────────
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_RPC_URL)
});

const account = privateKeyToAccount(ORACLE_PRIVATE_KEY);

const walletClient = createWalletClient({
  chain: baseSepolia,
  transport: http(BASE_RPC_URL),
  account
});

// ─── Contract ABIs ──────────────────────────────────────────
const arbiterAbi = parseAbi([
  'function settleOfframp((address recipient, uint96 amount, address token, uint32 nonce, uint256 chainId) calldata) external'
]);

const arbiterContract = {
  address: ARBITER_CONTRACT_ADDRESS,
  abi: arbiterAbi
};

// ─── EIP-712 Domain for The Compact ─────────────────────────
const COMPACT_DOMAIN = {
  name: 'TheCompact',
  version: '0',
  chainId: 8453,
  verifyingContract: '0x00000000000000171ede64904551eeDF3C6C9788'
};

// ─── EIP-712 Types ──────────────────────────────────────────
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
};

// ─── Nonce tracking (in-memory; use Redis/DB in production) ──
const usedNonces = new Set();
let lastNonce = 0;

function getNextNonce() {
  lastNonce += 1;
  return lastNonce;
}

// ─── POST /sign-compact ─────────────────────────────────────
// Signs a Compact as the ALLOCATOR using the oracle key
app.post('/sign-compact', async (req, res) => {
  try {
    const { arbiter, sponsor, lockTag, token, amount, mandate, expires } = req.body;

    if (!arbiter || !sponsor || !lockTag || !token || !amount || !mandate) {
      return res.status(400).json({ error: 'Missing required compact fields' });
    }

    const nonce = getNextNonce();
    const deadline = expires || Math.floor(Date.now() / 1000) + 3600;

    const compact = {
      arbiter,
      sponsor,
      nonce: BigInt(nonce),
      expires: BigInt(deadline),
      lockTag,
      token,
      amount: parseUnits(amount, 6),
      mandate: {
        bankAccount: mandate.bankAccount,
        amountNGN: BigInt(mandate.amountNGN),
        orderRef: mandate.orderRef,
        deadline: BigInt(mandate.deadline || deadline)
      }
    };

    // Sign as allocator using viem's signTypedData
    const allocatorSignature = await walletClient.signTypedData({
      domain: COMPACT_DOMAIN,
      types: COMPACT_TYPES,
      primaryType: 'Compact',
      message: compact
    });

    res.json({
      success: true,
      allocatorSignature,
      nonce,
      expires: deadline,
      compact,
      allocatorAddress: account.address
    });

  } catch (error) {
    console.error('Sign compact error:', error);
    res.status(500).json({
      error: 'Failed to sign compact',
      message: error.message
    });
  }
});

// ─── POST /confirm-receipt ──────────────────────────────────
// Oracle settles offramp onchain after confirming NGN payment
app.post('/confirm-receipt', async (req, res) => {
  try {
    const { claimPayload } = req.body;

    if (!claimPayload) {
      return res.status(400).json({ error: 'claimPayload is required' });
    }

    // TODO: validate order exists and LP marked payment as sent

    const txHash = await walletClient.writeContract({
      ...arbiterContract,
      functionName: 'settleOfframp',
      args: [claimPayload]
    });

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    res.json({
      success: true,
      txHash,
      explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`
    });

  } catch (error) {
    console.error('Settlement error:', error);
    res.status(500).json({
      error: 'Failed to process settlement',
      message: error.message
    });
  }
});

// ─── GET /health ────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    allocatorAddress: account.address,
    allocatorId: ALLOCATOR_ID || null,
    arbiterAddress: ARBITER_CONTRACT_ADDRESS,
    chain: 'base-sepolia',
    chainId: 8453
  });
});

// ─── Start Server ───────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Compex backend running on port ${PORT}`);
  console.log(`   Oracle/Allocator: ${account.address}`);
  console.log(`   Arbiter contract: ${ARBITER_CONTRACT_ADDRESS}`);
  console.log(`   Network: Base Sepolia`);
});
