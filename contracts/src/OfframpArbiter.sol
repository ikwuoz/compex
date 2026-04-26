// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Claim} from "the-compact/src/types/Claims.sol";

interface ITheCompactClaims {
    function claim(Claim calldata) external returns (bytes32);
}

contract OfframpArbiter {
    event OfframpSettled(
        bytes32 indexed claimHash,
        address indexed sponsor,
        uint256 indexed nonce,
        uint256 settledAt
    );
    ITheCompactClaims constant COMPACT =
        ITheCompactClaims(0x00000000000000171ede64904551eeDF3C6C9788);

    // owner = your backend oracle key
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }

    mapping(bytes32 => bool) public settledClaims;

    // arbiter calls this after confirming NGN payment
    function settleOfframp(Claim calldata claim) external {
        require(msg.sender == owner, "not oracle");
        bytes32 claimHash = keccak256(abi.encode(claim));
        require(!settledClaims[claimHash], "already settled");
        settledClaims[claimHash] = true;
        COMPACT.claim(claim);
        emit OfframpSettled(
            claimHash,
            claim.sponsor,
            claim.nonce,
            block.timestamp
        );
    }

    // view helper to compute claim hash (for backend correlation)
    function getClaimHash(
        Claim calldata claim
    ) external pure returns (bytes32) {
        return keccak256(abi.encode(claim));
    }
}
