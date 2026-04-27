// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/CompexOracle.sol";
import "../src/OfframpArbiter.sol";
import {Claim} from "the-compact/src/types/Claims.sol";
import {Component} from "the-compact/src/types/Components.sol";

contract MockArbiter {
    bool public settled;
    uint256 public lastNonce;

    function settleOfframp(Claim calldata claim) external {
        settled = true;
        lastNonce = claim.nonce;
    }
}

contract CompexOracleTest is Test {
    CompexOracle public oracle;
    MockArbiter public arbiter;

    address public owner = makeAddr("owner");
    address public stranger = makeAddr("stranger");

    function setUp() public {
        oracle = new CompexOracle(owner);
        arbiter = new MockArbiter();
    }

    function test_ConstructorSetsOwner() public {
        assertEq(oracle.owner(), owner);
    }

    function test_Settle_ForwardsClaimToArbiter() public {
        Claim memory claim;
        claim.nonce = 42;

        vm.prank(owner);
        oracle.settle(IOfframpArbiter(address(arbiter)), claim);

        assertTrue(arbiter.settled());
        assertEq(arbiter.lastNonce(), 42);
    }

    function test_Settle_RevertsForNonOwner() public {
        Claim memory claim;

        vm.prank(stranger);
        vm.expectRevert("not owner");
        oracle.settle(IOfframpArbiter(address(arbiter)), claim);
    }

    function test_TransferOwnership_UpdatesOwner() public {
        vm.prank(owner);
        oracle.transferOwnership(stranger);

        assertEq(oracle.owner(), stranger);
    }

    function test_TransferOwnership_EmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit CompexOracle.OwnershipTransferred(owner, stranger);
        oracle.transferOwnership(stranger);
    }

    function test_TransferOwnership_RevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert("not owner");
        oracle.transferOwnership(stranger);
    }

    function test_TransferOwnership_RevertsForZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert("zero address");
        oracle.transferOwnership(address(0));
    }

    function test_TransferOwnership_NewOwnerCanSettle() public {
        vm.prank(owner);
        oracle.transferOwnership(stranger);

        Claim memory claim;
        claim.nonce = 99;

        vm.prank(stranger);
        oracle.settle(IOfframpArbiter(address(arbiter)), claim);

        assertTrue(arbiter.settled());
    }

    function test_TransferOwnership_PreviousOwnerCannotSettle() public {
        vm.prank(owner);
        oracle.transferOwnership(stranger);

        vm.prank(owner);
        vm.expectRevert("not owner");
        oracle.settle(
            IOfframpArbiter(address(arbiter)),
            Claim({
                allocatorData: "",
                sponsorSignature: "",
                sponsor: address(0),
                nonce: 0,
                expires: 0,
                witness: bytes32(0),
                witnessTypestring: "",
                id: 0,
                allocatedAmount: 0,
                claimants: new Component[](0)
            })
        );
    }

    function test_Integration_OracleOwnsArbiter() public {
        vm.etch(0x00000000000000171ede64904551eeDF3C6C9788, address(new MockCompact()).code);
        OfframpArbiter realArbiter = new OfframpArbiter(address(oracle));

        assertEq(realArbiter.owner(), address(oracle));

        Claim memory claim;
        claim.nonce = 7;

        vm.prank(owner);
        oracle.settle(IOfframpArbiter(address(realArbiter)), claim);

        assertTrue(realArbiter.settled(keccak256(abi.encode(uint256(7)))));
    }

    function test_Integration_ReplayProtection() public {
        vm.etch(0x00000000000000171ede64904551eeDF3C6C9788, address(new MockCompact()).code);
        OfframpArbiter realArbiter = new OfframpArbiter(address(oracle));

        Claim memory claim;
        claim.nonce = 7;

        vm.prank(owner);
        oracle.settle(IOfframpArbiter(address(realArbiter)), claim);

        vm.prank(owner);
        vm.expectRevert("already settled");
        oracle.settle(IOfframpArbiter(address(realArbiter)), claim);
    }

    function test_Integration_OwnershipHandoff() public {
        vm.etch(0x00000000000000171ede64904551eeDF3C6C9788, address(new MockCompact()).code);
        OfframpArbiter realArbiter = new OfframpArbiter(address(oracle));

        vm.prank(owner);
        oracle.transferOwnership(stranger);

        Claim memory claim;
        claim.nonce = 55;

        vm.prank(stranger);
        oracle.settle(IOfframpArbiter(address(realArbiter)), claim);
        assertTrue(realArbiter.settled(keccak256(abi.encode(uint256(55)))));

        vm.prank(owner);
        vm.expectRevert("not owner");
        oracle.settle(IOfframpArbiter(address(realArbiter)), claim);
    }

    function test_Integration_DirectArbiterCallReverts() public {
        vm.etch(0x00000000000000171ede64904551eeDF3C6C9788, address(new MockCompact()).code);
        OfframpArbiter realArbiter = new OfframpArbiter(address(oracle));

        Claim memory claim;
        claim.nonce = 1;

        vm.prank(owner);
        vm.expectRevert("not oracle");
        realArbiter.settleOfframp(claim);
    }
}

contract MockCompact {
    function claim(Claim calldata) external pure returns (bytes32) {
        return bytes32(0);
    }
}
