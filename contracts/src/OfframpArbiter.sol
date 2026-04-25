// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import { Claim } from "the-compact/src/types/Claims.sol";

interface ITheCompactClaims {
    function claim(Claim calldata) external returns (bytes32);
}

contract OfframpArbiter {
    ITheCompactClaims constant COMPACT = 
        ITheCompactClaims(0x00000000000000171ede64904551eeDF3C6C9788);
    
    // owner = your backend oracle key
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }

    mapping(bytes32 => bool) public settled;

    // arbiter calls this after confirming NGN payment
    function settleOfframp(Claim calldata claim) external {
        require(msg.sender == owner, "not oracle");
        require(!settled[keccak256(abi.encode(claim.nonce))], "already settled");
        settled[keccak256(abi.encode(claim.nonce))] = true;
        COMPACT.claim(claim);
    }
}