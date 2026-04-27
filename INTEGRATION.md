# Compex + The Compact Integration

P2P crypto-to-fiat offramp on Base using The Compact for trustless USDC locking.

## Architecture

```
┌─────────────┐  1. sign compact   ┌──────────────────┐
│   Sponsor   │ ─────────────────→ │  Compex Backend  │
│  (wagmi UI) │                    │  (order mgmt +   │
└─────────────┘                    │   Smallocator)   │
       │                           └──────────────────┘
       │                                    │
       │  POST /orders                      │ allocatorData
       │  (sponsorSignature + mandate)      │ from Smallocator
       │                                    │
       ▼                                    ▼
┌──────────────────────────────────────────────────────┐
│                   LP Dashboard                        │
│  GET /orders → pick open order → PATCH /lock         │
└──────────────────────────────────────────────────────┘
                           │
              LP sends NGN to sponsor's bank
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│              Compex Backend (oracle)                  │
│  POST /confirm-receipt → CompexOracle.settle()       │
└──────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│  CompexOracle → OfframpArbiter → TheCompact.claim()  │
│  USDC released from resource lock → LP address       │
└──────────────────────────────────────────────────────┘
```

## Order State Machine

```
open → locked → settled
```

| State | Trigger | Who |
|-------|---------|-----|
| `open` | `POST /orders` | Sponsor |
| `locked` | `PATCH /orders/:id/lock` | LP |
| `settled` | `POST /confirm-receipt` | Oracle (backend) |

## Deployed Contracts (Base Sepolia)

| Contract | Address |
|----------|---------|
| `CompexOracle` | `0xFdA547973c86fd6F185eF6b50d5B3A6ecCE9FF8b` |
| `OfframpArbiter` | `0x4acEaEeA1EbC1C4B86a3Efe4525Cd4F6443E0CCF` |
| `TheCompact` | `0x00000000000000171ede64904551eeDF3C6C9788` |

## Setup

### 1. Environment

Copy `dev.env` and fill in values:

```env
ORACLE_PRIVATE_KEY=0x...        # EOA that owns CompexOracle
ARBITER_ADDRESS=0x...           # OfframpArbiter address
ORACLE_CONTRACT=0x...           # CompexOracle address
SMALLOCATOR_URL=http://...      # Smallocator endpoint
BASE_RPC_URL=https://sepolia.base.org
PORT=3002
```

### 2. Run Backend

```bash
cd backend
npm install
npm start
```

### 3. Deploy Contracts

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia.base.org \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### 4. Register as Allocator (one-time)

```bash
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "__registerAllocator(address,bytes)" \
  $ORACLE_CONTRACT "0x" \
  --rpc-url https://sepolia.base.org \
  --private-key $ORACLE_PRIVATE_KEY
```

### 5. Build lockTag for Frontend

```typescript
const allocatorId = BigInt('0xYOUR_ALLOCATOR_ID')
const scope = 1n        // multichain
const resetPeriod = 0n  // ten minutes
const lockTag = `0x${((scope << 255n) | (resetPeriod << 252n) | (allocatorId << 160n))
  .toString(16).padStart(24, '0')}`
```

## API

### `POST /orders`

Sponsor submits a signed compact to create an order.

```json
{
  "sponsor": "0x...",
  "token": "0xUSDC",
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

### `GET /orders`

Returns all open (unlocked) orders visible to LPs.

### `PATCH /orders/:id/lock`

LP claims an order before sending NGN.

```json
{ "lpAddress": "0x..." }
```

### `POST /confirm-receipt`

Oracle confirms NGN was received and triggers on-chain settlement.

```json
{ "orderId": "uuid" }
```

**Response:**
```json
{
  "success": true,
  "txHash": "0x...",
  "explorerUrl": "https://sepolia.basescan.org/tx/0x..."
}
```

### `GET /health`

```json
{ "status": "ok", "oracle": "0x...", "arbiter": "0x...", "chain": "base" }
```

## Escape Hatch

If an order expires without settlement the sponsor can force-withdraw:

```bash
# Enable forced withdrawal (starts reset period timer)
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "enableForcedWithdrawal(uint256)" $LOCK_ID \
  --rpc-url https://sepolia.base.org --private-key $SPONSOR_KEY

# After reset period, withdraw
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "forcedWithdrawal(uint256,address,uint256)" $LOCK_ID $RECIPIENT $AMOUNT \
  --rpc-url https://sepolia.base.org --private-key $SPONSOR_KEY
```

## Files

| Path | Purpose |
|------|---------|
| `contracts/src/OfframpArbiter.sol` | Arbiter — verifies nonce, calls TheCompact.claim() |
| `contracts/src/CompexOracle.sol` | Oracle contract — owned by backend EOA, calls settleOfframp |
| `contracts/script/Deploy.s.sol` | Deploys Oracle + Arbiter |
| `backend/lib/orders.js` | In-memory order store (open → locked → settled) |
| `backend/lib/settlement.js` | Smallocator + viem settlement logic |
| `backend/index.js` | Express API |
| `ui/app/hooks/useSignCompact.ts` | Sponsor-side EIP-712 signing hook |
| `ui/app/abis/offrampArbiter.ts` | Typed ABI for OfframpArbiter |
