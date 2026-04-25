# Compex + The Compact Integration

Minimal backend-signer approach — no Smallocator server needed.

## Architecture

```
┌─────────────┐   EIP-712 sign   ┌──────────────┐
│   User      │ ───────────────→ │   Compex     │
│  (sponsor)  │                  │   Backend    │
└─────────────┘                  │  (allocator) │
       │                         └──────────────┘
       │                                │
       │  1. POST /sign-compact         │ 2. sign as allocator
       │  ─────────────────────────→    │
       │                                │
       │←──────────────────────────     │
       │  { allocatorSignature }        │
       │                                │
       │  3. sign as sponsor (wagmi)    │
       │                                │
       │  4. build Claim struct         │
       │  5. call TheCompact.claim()    │
       │                         or     │
       │  5. store for later            │
       │                                │
       ▼                                ▼
┌─────────────────────────────────────────────┐
│              The Compact                     │
│    verifies sponsorSig + allocatorSig        │
│    releases USDC to arbiter                  │
└─────────────────────────────────────────────┘
```

## Setup

### 1. Register Your Oracle as Allocator (one-time)

Your oracle key doubles as the allocator key. Register it on The Compact:

```bash
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "__registerAllocator(address,bytes)" \
  0xYOUR_ORACLE_ADDRESS "0x" \
  --rpc-url https://sepolia.base.org \
  --private-key $PRIVATE_KEY
```

Or use Foundry cast:
```bash
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "__registerAllocator(address,bytes)" \
  $ORACLE_ADDRESS "0x" \
  --rpc-url https://sepolia.base.org \
  --private-key $PRIVATE_KEY
```

### 2. Get Your Allocator ID

After registration, query The Compact for your `allocatorId`:

```bash
cast call 0x00000000000000171ede64904551eeDF3C6C9788 \
  "getLockDetails(uint256)" \
  0xYOUR_LOCK_ID \
  --rpc-url https://sepolia.base.org
```

Or from the backend health endpoint once running:
```bash
curl http://localhost:3001/health
```

### 3. Environment Variables

Create `.env` in `/backend`:

```env
ORACLE_PRIVATE_KEY=0x...
ARBITER_ADDRESS=0x...
ALLOCATOR_ID=...
BASE_RPC_URL=https://sepolia.base.org
PORT=3001
```

### 4. Derive lockTag for Frontend

```typescript
// lockTag = bytes12 packing: scope + resetPeriod + allocatorId
// scope: 1 = multichain, 0 = single-chain
// resetPeriod: 0 = ten minutes, 1 = one hour, etc.

const allocatorId = BigInt('0xYOUR_ALLOCATOR_ID')
const scope = 1n       // multichain
const resetPeriod = 0n // ten minutes
const lockTag = `0x${((scope << 255n) | (resetPeriod << 252n) | (allocatorId << 160n)).toString(16).padStart(24, '0')}`
```

## API Endpoints

### `POST /sign-compact`

Signs a Compact as the allocator (your oracle key).

**Request:**
```json
{
  "arbiter": "0x...",
  "sponsor": "0x...",
  "lockTag": "0x...",
  "token": "0x...",
  "amount": "100",
  "mandate": {
    "bankAccount": "0123456789",
    "amountNGN": "150000",
    "orderRef": "REF-001",
    "deadline": 1732520000
  },
  "expires": 1732520000
}
```

**Response:**
```json
{
  "success": true,
  "allocatorSignature": "0x...",
  "nonce": 1,
  "expires": 1732520000,
  "compact": { ... },
  "allocatorAddress": "0x..."
}
```

### `POST /confirm-receipt`

Oracle settles offramp after confirming NGN payment.

**Request:**
```json
{
  "claimPayload": {
    "recipient": "0x...",
    "amount": "100000000",
    "token": "0x...",
    "nonce": 1,
    "chainId": 8453
  }
}
```

### `GET /health`

Returns allocator status.

## Frontend Usage

```tsx
import { useSignCompact } from '@/app/hooks/useSignCompact'

function OfframpForm() {
  const { signCompact, isLoading } = useSignCompact()

  const handleOfframp = async () => {
    const signed = await signCompact({
      arbiter: '0xARBITER',
      lockTag: '0xLOCKTAG',
      token: '0xUSDC_ON_BASE',
      amount: '100',
      mandate: {
        bankAccount: '0123456789',
        amountNGN: 150000n,
        orderRef: 'REF-001',
        deadline: BigInt(Math.floor(Date.now() / 1000) + 3600)
      }
    })

    // signed.sponsorSignature     — user's wallet signature
    // signed.allocatorSignature   — backend oracle signature
    // signed.id                   — resource lock ID
    // signed.claimants            — arbiter + amount

    // Now register/submit claim to The Compact contract...
  }
}
```

## Files

| File | Purpose |
|------|---------|
| `backend/index.js` | Express server with `/sign-compact` + `/confirm-receipt` |
| `ui/app/hooks/useSignCompact.ts` | React hook for dual signing (sponsor + allocator) |
| `contracts/src/OfframpArbiter.sol` | Arbiter contract that calls The Compact |
