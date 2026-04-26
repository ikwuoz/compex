export const offrampArbiterAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_owner', type: 'address', internalType: 'address' },
      { name: '_compact', type: 'address', internalType: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'compact',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'contract ITheCompactClaims' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'settleOfframp',
    inputs: [
      {
        name: 'claim',
        type: 'tuple',
        internalType: 'struct Claim',
        components: [
          { name: 'allocatorData',     type: 'bytes',    internalType: 'bytes' },
          { name: 'sponsorSignature',  type: 'bytes',    internalType: 'bytes' },
          { name: 'sponsor',           type: 'address',  internalType: 'address' },
          { name: 'nonce',             type: 'uint256',  internalType: 'uint256' },
          { name: 'expires',           type: 'uint256',  internalType: 'uint256' },
          { name: 'witness',           type: 'bytes32',  internalType: 'bytes32' },
          { name: 'witnessTypestring', type: 'string',   internalType: 'string' },
          { name: 'id',               type: 'uint256',  internalType: 'uint256' },
          { name: 'allocatedAmount',   type: 'uint256',  internalType: 'uint256' },
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
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'settled',
    inputs: [{ name: '', type: 'bytes32', internalType: 'bytes32' }],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'view',
  },
] as const
