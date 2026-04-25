// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/OfframpArbiter.sol";
import { Claim } from "the-compact/src/types/Claims.sol";

contract OfframpArbiterIntegrationTest is Test {
    OfframpArbiter public arbiter;
    address public oracle = makeAddr("oracle");
    address public user = makeAddr("user");

    function setUp() public {
        // Deploy mock compact
        address mockCompact = address(this);
        vm.etch(0x00000000000000171ede64904551eeDF3C6C9788, mockCompact.code);

        arbiter = new OfframpArbiter(oracle);
        vm.label(oracle, "oracle");
        vm.label(user, "user");
    }

    // Mock COMPACT.claim
    function claim(Claim calldata) external pure returns (bytes32) {
        return bytes32(0);
    }

    function test_FullFlow_OracleSettlesValidClaim() public {
        // Build valid Claim
        Claim memory claim;
        claim.nonce = 777;
        claim.sponsor = user;
        claim.id = 1234;
        claim.allocatedAmount = 100e6;

        // Oracle submits settlement
        vm.prank(oracle);
        arbiter.settleOfframp(claim);

        // Verify nonce is marked as settled
        bytes32 key = keccak256(abi.encode(claim.nonce));
        assertTrue(arbiter.settled(key));
    }

    function test_Revert_UserCannotSettleClaim() public {
        Claim memory claim;
        claim.nonce = 888;

        // Try to settle from regular user address
        vm.prank(user);
        vm.expectRevert("not oracle");
        arbiter.settleOfframp(claim);
    }

    function test_Revert_DuplicateNonceCannotBeSettled() public {
        Claim memory claim;
        claim.nonce = 999;

        // First settlement succeeds
        vm.prank(oracle);
        arbiter.settleOfframp(claim);

        // Second settlement with same nonce reverts
        vm.prank(oracle);
        vm.expectRevert("already settled");
        arbiter.settleOfframp(claim);
    }
}
