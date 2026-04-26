// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/OfframpArbiter.sol";
import {Claim} from "the-compact/src/types/Claims.sol";

contract MockCompact {
    function claim(Claim calldata) external pure returns (bytes32) {
        return bytes32(0);
    }
}

contract OfframpArbiterTest is Test {
    OfframpArbiter public arbiter;
    MockCompact public mockCompact;

    address public owner = address(0x01);
    address public stranger = address(0x02);

    function setUp() public {
        mockCompact = new MockCompact();

        // Override COMPACT constant address
        vm.etch(
            0x00000000000000171ede64904551eeDF3C6C9788,
            address(mockCompact).code
        );

        vm.startPrank(owner);
        arbiter = new OfframpArbiter(owner, 0x00000000000000171ede64904551eeDF3C6C9788);
        vm.stopPrank();
    }

    function test_ConstructorSetsOwner() public {
        assertEq(arbiter.owner(), owner);
    }

    function test_SettleOfframpOnlyOwner() public {
        Claim memory claim;
        claim.nonce = 1;

        vm.startPrank(stranger);
        vm.expectRevert("not oracle");
        arbiter.settleOfframp(claim);
        vm.stopPrank();
    }

    function test_SettleOfframpMarksSettled() public {
        Claim memory claim;
        claim.nonce = 123;
        claim.expires = block.timestamp + 1 hours;

        vm.startPrank(owner);
        arbiter.settleOfframp(claim);
        vm.stopPrank();

        bytes32 claimHash = keccak256(abi.encode(claim));
        assertTrue(arbiter.settledClaims(claimHash));
    }

    function test_CannotSettleSameNonceTwice() public {
        Claim memory claim;
        claim.nonce = 456;
        claim.expires = block.timestamp + 1 hours;

        vm.startPrank(owner);
        arbiter.settleOfframp(claim);

        vm.expectRevert("already settled");
        arbiter.settleOfframp(claim);
        vm.stopPrank();
    }
}
