// Trimmed to the functions and events the UI needs.
// Full ABI lives in contracts/out/TheCompact.sol/TheCompact.json.
export const theCompactAbi = [
  {
    type: 'function',
    name: 'DOMAIN_SEPARATOR',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [
      { name: 'owner', type: 'address', internalType: 'address' },
      { name: 'id',    type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: 'amount', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'depositNative',
    inputs: [
      { name: 'lockTag',   type: 'bytes12',  internalType: 'bytes12' },
      { name: 'recipient', type: 'address',  internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'depositERC20',
    inputs: [
      { name: 'token',     type: 'address',  internalType: 'address' },
      { name: 'lockTag',   type: 'bytes12',  internalType: 'bytes12' },
      { name: 'amount',    type: 'uint256',  internalType: 'uint256' },
      { name: 'recipient', type: 'address',  internalType: 'address' },
    ],
    outputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [
      {
        name: 'claimPayload',
        type: 'tuple',
        internalType: 'struct Claim',
        components: [
          { name: 'allocatorData',     type: 'bytes',   internalType: 'bytes' },
          { name: 'sponsorSignature',  type: 'bytes',   internalType: 'bytes' },
          { name: 'sponsor',           type: 'address', internalType: 'address' },
          { name: 'nonce',             type: 'uint256', internalType: 'uint256' },
          { name: 'expires',           type: 'uint256', internalType: 'uint256' },
          { name: 'witness',           type: 'bytes32', internalType: 'bytes32' },
          { name: 'witnessTypestring', type: 'string',  internalType: 'string' },
          { name: 'id',               type: 'uint256', internalType: 'uint256' },
          { name: 'allocatedAmount',   type: 'uint256', internalType: 'uint256' },
          {
            name: 'claimants',
            type: 'tuple[]',
            internalType: 'struct Component[]',
            components: [
              { name: 'claimant', type: 'uint256', internalType: 'uint256' },
              { name: 'amount',   type: 'uint256', internalType: 'uint256' },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: 'claimHash', type: 'bytes32', internalType: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'enableForcedWithdrawal',
    inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'forcedWithdrawal',
    inputs: [
      { name: 'id',        type: 'uint256', internalType: 'uint256' },
      { name: 'recipient', type: 'address', internalType: 'address' },
      { name: 'amount',    type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'nonpayable',
  },
  // ── events ──────────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'Claim',
    inputs: [
      { name: 'sponsor',   type: 'address', indexed: true,  internalType: 'address' },
      { name: 'allocator', type: 'address', indexed: true,  internalType: 'address' },
      { name: 'arbiter',   type: 'address', indexed: true,  internalType: 'address' },
      { name: 'claimHash', type: 'bytes32', indexed: false, internalType: 'bytes32' },
      { name: 'nonce',     type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'by',     type: 'address', indexed: false, internalType: 'address' },
      { name: 'from',   type: 'address', indexed: true,  internalType: 'address' },
      { name: 'to',     type: 'address', indexed: true,  internalType: 'address' },
      { name: 'id',     type: 'uint256', indexed: true,  internalType: 'uint256' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ForcedWithdrawalStatusUpdated',
    inputs: [
      { name: 'account',        type: 'address', indexed: true,  internalType: 'address' },
      { name: 'id',             type: 'uint256', indexed: true,  internalType: 'uint256' },
      { name: 'activating',     type: 'bool',    indexed: false, internalType: 'bool' },
      { name: 'withdrawableAt', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
] as const
