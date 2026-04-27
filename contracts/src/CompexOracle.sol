// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import {Claim} from "the-compact/src/types/Claims.sol";

interface IOfframpArbiter {
    function settleOfframp(Claim calldata claim) external;
}

contract CompexOracle {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(address _owner) {
        owner = _owner;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function settle(IOfframpArbiter arbiter, Claim calldata claim) external onlyOwner {
        arbiter.settleOfframp(claim);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
