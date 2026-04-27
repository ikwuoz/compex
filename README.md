# Compex

Peer-to-peer crypto-to-fiat offramp built on [The Compact](https://github.com/Uniswap/the-compact) by Uniswap.

A user holding USDC on Base locks it into The Compact. A liquidity provider sends Nigerian Naira via bank transfer. Once payment is confirmed, the arbiter contract releases USDC directly to the LP's wallet — atomically, with no custodian.

```
User locks USDC → LP sends NGN → Oracle confirms → USDC released to LP
```

## How it works

| Step | Actor | Action |
|------|-------|--------|
| 1 | Sponsor | Calls `depositERC20AndRegisterViaPermit2` on The Compact — deposits USDC and registers the compact (with Mandate witness) in one Permit2 signature |
| 2 | LP | Sees the order on the board, locks it in |
| 3 | LP | Sends NGN via bank transfer using the order reference |
| 4 | Sponsor | Taps "I received NGN" in the app |
| 5 | Backend | Calls Smallocator for `allocatorData`, assembles the full `Claim`, calls `OfframpArbiter.settleOfframp()` |
| 6 | Contract | Calls `ITheCompactClaims.claim()` — The Compact verifies sponsor sig + allocator sig, transfers USDC to LP |

The Mandate witness (`bankAccount`, `amountNGN`, `orderRef`, `deadline`) is embedded in the EIP-712 compact and verified on-chain by The Compact.

## Architecture

```
contracts/   Foundry — OfframpArbiter.sol (the only custom contract)
backend/     Express — POST /confirm-receipt, order state
ui/          Next.js + wagmi + viem — deposit, LP board, confirm screens
allocator    Smallocator — Uniswap's reference allocator (external, port 3001)
```

## Key addresses

| Name | Value |
|------|-------|
| The Compact | `0x00000000000000171ede64904551eeDF3C6C9788` |
| USDC on Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Chain | Base (8453) |

## Repo structure

```
compex/
├── contracts/          Foundry project
│   ├── src/
│   │   └── OfframpArbiter.sol
│   ├── test/
│   │   ├── OfframpArbiter.t.sol          unit tests (mock compact)
│   │   └── OfframpArbiter.Integration.t.sol  integration tests (real TheCompact)
│   └── script/
│       └── OfframpArbiter.s.sol
├── backend/
│   ├── index.js        Express server
│   └── package.json
├── ui/
│   ├── app/
│   │   ├── hooks/useSignCompact.ts
│   │   └── page.tsx
│   └── package.json
└── dev.env             local env (gitignored)
```

## Setup

### Prerequisites

- [Foundry](https://getfoundry.sh)
- Node.js 18+
- [Smallocator](https://github.com/Uniswap/smallocator) running on port 3001

### 1. Clone and install

```bash
git clone https://github.com/ikwuoz/compex
cd compex
git submodule update --init --recursive

cd backend && npm install
cd ../ui && npm install
```

### 2. Configure environment

Copy and fill in `dev.env` at the repo root:

```env
ORACLE_PRIVATE_KEY=0x...       # oracle key — also the OfframpArbiter owner
ARBITER_ADDRESS=0x...          # deployed OfframpArbiter address
ALLOCATOR_ID=...               # uint96 ID from The Compact after registering Smallocator
BASE_RPC_URL=https://mainnet.base.org
PORT=3001
```

### 3. Register Smallocator as allocator (one-time)

```bash
cast send 0x00000000000000171ede64904551eeDF3C6C9788 \
  "__registerAllocator(address,bytes)" \
  $SMALLOCATOR_ADDRESS "0x" \
  --rpc-url $BASE_RPC_URL \
  --private-key $ORACLE_PRIVATE_KEY
```

### 4. Deploy OfframpArbiter

```bash
cd contracts
forge script script/OfframpArbiter.s.sol --rpc-url $BASE_RPC_URL \
  --private-key $ORACLE_PRIVATE_KEY --broadcast
```

### 5. Run

```bash
# backend
cd backend && node index.js

# frontend
cd ui && npm run dev
```

## Contracts

### OfframpArbiter

```solidity
function settleOfframp(Claim calldata claim) external
```

- Only callable by the oracle (owner)
- Checks `block.timestamp <= claim.expires`
- Guards against nonce reuse
- Calls `ITheCompactClaims.claim()` to release USDC to the LP

### Tests

```bash
cd contracts
forge test
```

9 tests: 4 unit (mock compact) + 5 integration (real TheCompact with SimpleAllocator, native ETH deposits, full EIP-712 signing).

## Escape hatch

If the allocator becomes unresponsive the user can force-withdraw their USDC without allocator permission:

```bash
# enable withdrawal (starts reset period timer)
cast send $COMPACT "enableForcedWithdrawal(uint256)" $LOCK_ID ...

# after reset period elapses
cast send $COMPACT "forcedWithdrawal(uint256,address,uint256)" $LOCK_ID $RECIPIENT $AMOUNT ...
```

## Trust model

- **User trusts**: the oracle to honestly confirm NGN receipt before calling `settleOfframp`
- **LP trusts**: the allocator (Smallocator) to not authorize double-spending between NGN send and settlement
- **Neither party** can run with the money — the escape hatch recovers funds if the oracle goes dark
