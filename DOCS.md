# Compex — Developer Documentation

Compex is a peer-to-peer crypto-to-fiat offramp on Base. A user (sponsor) locks USDC on-chain; a liquidity provider (LP) sends NGN via bank transfer; once payment is confirmed, the USDC is released to the LP — atomically, with no custodian.

---

## Table of Contents

1. [How it Works](#how-it-works)
2. [Architecture](#architecture)
3. [Key Concepts](#key-concepts)
4. [Smart Contracts](#smart-contracts)
5. [Backend API](#backend-api)
6. [Frontend Integration](#frontend-integration)
7. [Order Lifecycle](#order-lifecycle)
8. [Environment Setup](#environment-setup)
9. [Deployed Addresses](#deployed-addresses)
10. [Trust Model & Security](#trust-model--security)
11. [Escape Hatch](#escape-hatch)

---

## How it Works

```
Sponsor locks USDC in TheCompact
        ↓
Sponsor signs a compact (EIP-712) and posts an order to the backend
        ↓
LP sees the order, locks it, sends NGN to sponsor's bank account
        ↓
Sponsor confirms NGN received
        ↓
Backend oracle calls CompexOracle → OfframpArbiter → TheCompact.claim()
        ↓
USDC released directly to LP's wallet
```

No USDC ever passes through Compex. The contracts only release funds when both the sponsor's signature and the allocator's signature are valid.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Sponsor (UI)                          │
│  wagmi + viem — deposits USDC, signs EIP-712 compact     │
└────────────────────────────┬─────────────────────────────┘
                             │ POST /orders
                             ↓
┌──────────────────────────────────────────────────────────┐
│                  Compex Backend (Express)                  │
│  Order store (open → locked → settled)                   │
│  Calls Smallocator for allocatorData                     │
│  Oracle EOA owns CompexOracle contract                   │
└──────┬───────────────────────────────────────────────────┘
       │ POST /confirm-receipt → on-chain settlement
       ↓
┌──────────────────────────────────────────────────────────┐
│  CompexOracle → OfframpArbiter → TheCompact.claim()      │
│  USDC transferred from vault → LP wallet                 │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                     LP Dashboard                          │
│  GET /orders → pick order → PATCH /lock → send NGN      │
└──────────────────────────────────────────────────────────┘
```

### Components

| Component | Purpose |
|-----------|---------|
| **TheCompact** | Uniswap's ERC-6909 vault — holds USDC until a valid claim is submitted |
| **Smallocator** | Uniswap's reference allocator — co-signs claims to prevent double-spending |
| **OfframpArbiter** | Custom contract — enforces oracle-only access and nonce replay protection before calling TheCompact |
| **CompexOracle** | Owned by the backend EOA — forwards settle calls to the arbiter; enables key rotation without redeployment |
| **Backend** | Express API — manages order state, coordinates Smallocator, triggers on-chain settlement |
| **UI** | Next.js + wagmi — sponsor deposits USDC, signs compact, LP views and locks orders |

---

## Key Concepts

### TheCompact

TheCompact is an ERC-6909 token vault. When a sponsor deposits USDC, they receive a **resource lock** — a token ID that encodes:
- which ERC-20 token is locked (USDC)
- which allocator is authorised to co-sign releases
- a reset period (how long before force-withdrawal is possible)

The USDC stays in the vault until `claim()` is called with valid signatures from both the sponsor and the allocator.

### Resource Lock ID

The lock ID is a `uint256` packed as:

```
lockTag (bytes12) ++ token address (bytes20)
= (lockTag << 160) | token
```

The `lockTag` itself is packed as:

```
scope (1 bit) ++ resetPeriod (3 bits) ++ allocatorId (88 bits) ++ zeros (160 bits)
```

### Compact (EIP-712)

The compact is the EIP-712 message the sponsor signs. It authorises a specific release of their locked USDC. Fields:

| Field | Type | Description |
|-------|------|-------------|
| `arbiter` | `address` | Contract that verifies the claim (OfframpArbiter) |
| `sponsor` | `address` | The user locking USDC |
| `nonce` | `uint256` | Unique per-order, prevents replay |
| `expires` | `uint256` | Unix timestamp — after this the sponsor can force-withdraw |
| `lockTag` | `bytes12` | Encodes allocator + reset period + scope |
| `token` | `address` | USDC contract address |
| `amount` | `uint256` | Amount in USDC base units (6 decimals) |
| `mandate` | `Mandate` | Witness struct with payment details |

### Mandate Witness

The `Mandate` struct is embedded as an EIP-712 witness inside the compact. This binds the bank account and NGN amount to the on-chain signature — the LP cannot change payment terms after the order is posted.

```solidity
Mandate {
  string  bankAccount  // LP sends NGN here
  uint96  amountNGN    // exact NGN amount
  string  orderRef     // payment reference
  uint32  deadline     // latest time for NGN transfer
}
```

Witness hash:
```ts
keccak256(abi.encode(MANDATE_TYPEHASH, keccak256(bankAccount), amountNGN, keccak256(orderRef), deadline))
```

### Allocator (Smallocator)

Smallocator is Uniswap's reference allocator. It co-signs every claim to:
- confirm the resource lock is valid
- ensure the nonce has not been used before (prevents double-spending between the time NGN is sent and USDC is claimed)

The backend requests `allocatorData` from Smallocator by POSTing the compact details to `POST /compact`.

---

## Smart Contracts

### CompexOracle

```solidity
contract CompexOracle {
    address public owner;

    function settle(IOfframpArbiter arbiter, Claim calldata claim) external onlyOwner;
    function transferOwnership(address newOwner) external onlyOwner;
}
```

The backend EOA owns this contract. It forwards `settle` calls to the arbiter. The indirection exists so that if the oracle key is ever rotated, only `transferOwnership` needs to be called — the arbiter and its address stay the same.

**Deployed:** `0xFdA547973c86fd6F185eF6b50d5B3A6ecCE9FF8b`

### OfframpArbiter

```solidity
contract OfframpArbiter {
    address public owner;                          // CompexOracle
    ITheCompactClaims public immutable compact;    // TheCompact
    mapping(bytes32 => bool) public settled;

    function settleOfframp(Claim calldata claim) external;
}
```

`settleOfframp` does three things:
1. Reverts if `msg.sender != owner` (only the oracle can call it)
2. Reverts if the nonce has already been settled (replay protection)
3. Calls `compact.claim(claim)` — TheCompact verifies both signatures and transfers USDC

**Deployed:** `0x4acEaEeA1EbC1C4B86a3Efe4525Cd4F6443E0CCF`

### Claim Struct

Both contracts pass this struct from TheCompact:

```solidity
struct Claim {
    bytes    allocatorData;       // Smallocator signature
    bytes    sponsorSignature;    // sponsor EIP-712 signature
    address  sponsor;
    uint256  nonce;
    uint256  expires;
    bytes32  witness;             // keccak256 of Mandate struct
    string   witnessTypestring;   // EIP-712 type string for Mandate fields
    uint256  id;                  // resource lock ID
    uint256  allocatedAmount;
    Component[] claimants;        // [{claimant: lpAddress as uint256, amount}]
}
```

### Test Coverage

```bash
cd contracts && forge test
```

| Suite | Tests | What it covers |
|-------|-------|----------------|
| `OfframpArbiter.t.sol` | 4 | Unit tests with mock compact — owner check, nonce replay, settled mapping |
| `OfframpArbiter.Integration.t.sol` | 9 | Real TheCompact + SimpleAllocator — full EIP-712 signing, split settlement, invalid signatures, expired claims, fuzz on nonce double-spend |
| `CompexOracle.t.sol` | 13 | Oracle unit tests + 4 integration tests through the full oracle → arbiter → compact chain |

---

## Backend API

Base URL: `http://localhost:3001` (configurable via `PORT`)

### `POST /orders`

Sponsor submits a signed compact to open an order.

**Request body:**

```json
{
  "sponsor": "0x...",
  "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amount": "100000000",
  "nonce": 1,
  "expires": 1750000000,
  "id": "0x...",
  "allocatedAmount": "100000000",
  "witness": "0x...",
  "witnessTypestring": "string bankAccount,uint96 amountNGN,string orderRef,uint32 deadline",
  "sponsorSignature": "0x...",
  "mandate": {
    "bankAccount": "0123456789",
    "amountNGN": "150000",
    "orderRef": "REF-001",
    "deadline": 1750000000
  }
}
```

**Response:** `201` — the created order object with `id` and `status: "open"`.

---

### `GET /orders`

Returns all open (unlocked) orders. LPs poll this to see what's available.

**Response:** array of order objects.

---

### `PATCH /orders/:id/lock`

LP claims an order before sending NGN.

**Request body:**
```json
{ "lpAddress": "0x..." }
```

**Response:** the updated order with `status: "locked"`.

---

### `POST /confirm-receipt`

Sponsor confirms NGN was received. Triggers on-chain settlement.

**Request body:**
```json
{ "orderId": "uuid" }
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "explorerUrl": "https://basescan.org/tx/0x..."
}
```

Internally:
1. Fetches `allocatorData` from Smallocator
2. Builds the full `Claim` struct
3. Calls `CompexOracle.settle()` via the oracle wallet
4. Waits for transaction receipt
5. Marks order as `settled`

---

### `GET /health`

```json
{ "status": "ok", "oracle": "0x...", "arbiter": "0x...", "chain": "base" }
```

---

## Frontend Integration

The frontend is built with Next.js + wagmi + viem.

### What the frontend does

1. Connects the sponsor's wallet
2. Deposits USDC into TheCompact via `depositERC20AndRegisterViaPermit2`
3. Signs the EIP-712 compact (sponsor signature)
4. POSTs the order to the backend

### `useSignCompact` hook

Location: `ui/app/hooks/useSignCompact.ts`

```ts
const { signCompact } = useSignCompact('http://localhost:3001')

const result = await signCompact({
  arbiter: '0x4acEaEeA1EbC1C4B86a3Efe4525Cd4F6443E0CCF',
  lockTag: '0x...',
  token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '100',         // human-readable USDC
  mandate: {
    bankAccount: '0123456789',
    amountNGN: 150000n,
    orderRef: 'REF-001',
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600)
  }
})
```

The hook:
1. Signs the compact with the connected wallet (`useSignTypedData`)
2. Requests `allocatorData` from the backend (`POST /sign-compact`)
3. Returns the full payload ready to POST to `/orders`

### Building the lockTag

```ts
const allocatorId = BigInt('YOUR_ALLOCATOR_ID')   // from __registerAllocator
const scope = 1n       // 1 = multichain
const resetPeriod = 0n // 0 = TenMinutes

const lockTag = `0x${(
  (scope << 255n) | (resetPeriod << 252n) | (allocatorId << 160n)
).toString(16).padStart(24, '0')}`
```

### EIP-712 Domain

```ts
{
  name: 'TheCompact',
  version: '0',
  chainId: 8453,
  verifyingContract: '0x00000000000000171ede64904551eeDF3C6C9788'
}
```

### ABIs

Pre-typed ABIs are available in `ui/app/abis/`:

```ts
import { offrampArbiterAbi } from '@/app/abis'
```

---

## Order Lifecycle

```
open → locked → settled
```

| State | Triggered by | Endpoint |
|-------|-------------|----------|
| `open` | Sponsor posts a signed compact | `POST /orders` |
| `locked` | LP picks the order | `PATCH /orders/:id/lock` |
| `settled` | Sponsor confirms NGN received, oracle settles on-chain | `POST /confirm-receipt` |

Orders are stored in memory. A restart clears all state — persistence is out of scope for the current version.

---

## Environment Setup

### Prerequisites

- [Foundry](https://getfoundry.sh) — contract compilation and testing
- Node.js 18+
- [Smallocator](https://github.com/uniswap/smallocator) — allocator service, runs on port 3001

### 1. Clone

```bash
git clone https://github.com/ikwuoz/compex
cd compex
git submodule update --init --recursive
```

### 2. Install dependencies

```bash
cd backend && npm install
cd ../ui && npm install
```

### 3. Configure environment

Copy `dev.env` and fill in values:

```env
ORACLE_PRIVATE_KEY=0x...        # EOA that owns CompexOracle
ARBITER_ADDRESS=0x...           # OfframpArbiter address
ORACLE_CONTRACT=0x...           # CompexOracle address
SMALLOCATOR_URL=http://localhost:3001
BASE_RPC_URL=https://mainnet.base.org
PORT=3001
```

### 4. Register allocator (one-time, Base Sepolia)

```bash
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "__registerAllocator(address,bytes)" \
  $SMALLOCATOR_ADDRESS "0x" \
  --rpc-url $BASE_RPC_URL \
  --private-key $ORACLE_PRIVATE_KEY
```

### 5. Deploy contracts

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $BASE_RPC_URL \
  --private-key $ORACLE_PRIVATE_KEY \
  --broadcast
```

### 6. Run

```bash
# backend
cd backend && node index.js

# frontend
cd ui && npm run dev
```

### 7. Run tests

```bash
cd contracts && forge test -v
cd backend && npm test
```

---

## Deployed Addresses

### Base Sepolia (testnet)

| Contract | Address |
|----------|---------|
| `CompexOracle` | `0xFdA547973c86fd6F185eF6b50d5B3A6ecCE9FF8b` |
| `OfframpArbiter` | `0x4acEaEeA1EbC1C4B86a3Efe4525Cd4F6443E0CCF` |
| `TheCompact` | `0x00000000000000171ede64904551eeDF3C6C9788` |
| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

## Trust Model & Security

| Who | Trusts what |
|-----|------------|
| **Sponsor** | The oracle will call `settle` only after NGN is confirmed received — this is an off-chain trust assumption |
| **LP** | The allocator (Smallocator) will not co-sign a duplicate claim — enforced cryptographically |
| **Neither** | Can run with the money — USDC is locked in TheCompact, not with Compex |

### Key rotation

The oracle key can be rotated without redeploying the arbiter:

```bash
cast send $ORACLE_CONTRACT \
  "transferOwnership(address)" $NEW_ORACLE_EOA \
  --private-key $OLD_ORACLE_PRIVATE_KEY \
  --rpc-url $BASE_RPC_URL
```

### Nonce replay protection

`OfframpArbiter` tracks every settled nonce in a `mapping(bytes32 => bool)`. A second `settleOfframp` call with the same nonce reverts with `"already settled"`.

---

## Escape Hatch

If an order expires without settlement (oracle goes dark, LP ghosts), the sponsor can recover their USDC without any Compex involvement:

```bash
# Step 1: enable forced withdrawal — starts the reset period timer
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "enableForcedWithdrawal(uint256)" $LOCK_ID \
  --rpc-url $BASE_RPC_URL --private-key $SPONSOR_KEY

# Step 2: after the reset period (10 min by default), withdraw
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "forcedWithdrawal(uint256,address,uint256)" $LOCK_ID $SPONSOR_ADDRESS $AMOUNT \
  --rpc-url $BASE_RPC_URL --private-key $SPONSOR_KEY
```

The reset period is encoded in the `lockTag` at deposit time. With `ResetPeriod.TenMinutes`, the sponsor can withdraw 10 minutes after enabling.

---

## File Reference

| Path | Purpose |
|------|---------|
| `contracts/src/CompexOracle.sol` | Oracle contract — owned by backend EOA, calls arbiter |
| `contracts/src/OfframpArbiter.sol` | Arbiter — nonce guard + calls TheCompact.claim() |
| `contracts/script/Deploy.s.sol` | Deploys CompexOracle then OfframpArbiter |
| `contracts/test/CompexOracle.t.sol` | 13 tests for oracle — unit + integration |
| `contracts/test/OfframpArbiter.t.sol` | 4 unit tests with mock compact |
| `contracts/test/OfframpArbiter.Integration.t.sol` | 9 integration tests with real TheCompact |
| `backend/index.js` | Express API + `createApp` factory |
| `backend/lib/orders.js` | In-memory order store |
| `backend/lib/settlement.js` | Smallocator + viem settlement logic |
| `ui/app/hooks/useSignCompact.ts` | EIP-712 signing hook for sponsors |
| `ui/app/abis/offrampArbiter.ts` | Typed ABI for wagmi/viem |
| `dev.env` | Local environment config |
