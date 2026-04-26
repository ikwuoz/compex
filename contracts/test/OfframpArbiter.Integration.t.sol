// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "forge-std/Test.sol";
import "../src/OfframpArbiter.sol";
import {Claim} from "the-compact/src/types/Claims.sol";
import {Component} from "the-compact/src/types/Components.sol";
import {TheCompact} from "the-compact/src/TheCompact.sol";
import {SimpleAllocator} from "the-compact/src/examples/allocator/SimpleAllocator.sol";
import {ResetPeriod} from "the-compact/src/types/ResetPeriod.sol";
import {Scope} from "the-compact/src/types/Scope.sol";

contract OfframpArbiterIntegrationTest is Test {
    bytes32 internal constant COMPACT_TYPEHASH = keccak256(
        "Compact(address arbiter,address sponsor,uint256 nonce,uint256 expires,bytes12 lockTag,address token,uint256 amount)"
    );

    OfframpArbiter public arbiter;
    TheCompact public theCompact;
    SimpleAllocator public allocator;

    address public oracle;
    address public user;
    address public sponsor;
    uint256 public sponsorPrivateKey;
    uint256 public allocatorPrivateKey;
    bytes12 public lockTag;

    function setUp() public {
        oracle = makeAddr("oracle");
        user = makeAddr("user");
        (sponsor, sponsorPrivateKey) = makeAddrAndKey("sponsor");
        (address allocatorSigner, uint256 signerPrivateKey) = makeAddrAndKey("allocator-signer");
        allocatorPrivateKey = signerPrivateKey;

        theCompact = new TheCompact();
        allocator = new SimpleAllocator(allocatorSigner, address(theCompact));

        vm.prank(address(allocator));
        uint96 allocatorId = theCompact.__registerAllocator(address(allocator), "");
        lockTag = _createLockTag(ResetPeriod.TenMinutes, Scope.Multichain, allocatorId);

        arbiter = new OfframpArbiter(oracle, address(theCompact));

        vm.deal(sponsor, 20 ether);

        vm.label(address(theCompact), "theCompact");
        vm.label(address(allocator), "allocator");
        vm.label(oracle, "oracle");
        vm.label(user, "user");
        vm.label(sponsor, "sponsor");
    }

    function _createLockTag(ResetPeriod resetPeriod, Scope scope, uint96 allocatorId) internal pure returns (bytes12) {
        return bytes12(bytes32((uint256(scope) << 255) | (uint256(resetPeriod) << 252) | (uint256(allocatorId) << 160)));
    }

    function _createClaimHash(
        address arbiterAddress,
        address sponsorAddress,
        uint256 nonce,
        uint256 expires,
        uint256 id,
        uint256 amount
    ) internal pure returns (bytes32) {
        bytes12 localLockTag = bytes12(bytes32(id));
        address token = address(uint160(id));
        return keccak256(
            abi.encode(COMPACT_TYPEHASH, arbiterAddress, sponsorAddress, nonce, expires, localLockTag, token, amount)
        );
    }

    function _signDigest(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory signature) {
        (bytes32 r, bytes32 vs) = vm.signCompact(privateKey, digest);
        return abi.encodePacked(r, vs);
    }

    function _buildSignedClaim(uint256 nonce, uint256 amount, uint256 expires)
        internal
        returns (Claim memory c, uint256 id)
    {
        vm.prank(sponsor);
        id = theCompact.depositNative{value: amount}(lockTag, sponsor);

        c.nonce = nonce;
        c.sponsor = sponsor;
        c.id = id;
        c.allocatedAmount = amount;
        c.expires = expires;

        Component[] memory claimants = new Component[](1);
        claimants[0] = Component({claimant: uint256(uint160(user)), amount: amount});
        c.claimants = claimants;

        bytes32 claimHash = _createClaimHash(address(arbiter), sponsor, nonce, expires, id, amount);
        bytes32 digest = keccak256(abi.encodePacked(bytes2(0x1901), theCompact.DOMAIN_SEPARATOR(), claimHash));

        c.sponsorSignature = _signDigest(sponsorPrivateKey, digest);
        c.allocatorData = _signDigest(allocatorPrivateKey, digest);
    }

    function test_FullFlow_OracleSettlesValidClaim() public {
        (Claim memory c, uint256 id) = _buildSignedClaim(777, 1 ether, block.timestamp + 1 hours);
        uint256 userBalanceBefore = user.balance;

        vm.prank(oracle);
        arbiter.settleOfframp(c);

        assertTrue(arbiter.settled(keccak256(abi.encode(c.nonce))));
        assertEq(user.balance, userBalanceBefore + 1 ether);
        assertEq(theCompact.balanceOf(sponsor, id), 0);
    }

    function test_Revert_UserCannotSettleClaim() public {
        (Claim memory c,) = _buildSignedClaim(888, 1 ether, block.timestamp + 1 hours);

        vm.prank(user);
        vm.expectRevert("not oracle");
        arbiter.settleOfframp(c);
    }

    function test_Revert_DuplicateNonceCannotBeSettled() public {
        (Claim memory c,) = _buildSignedClaim(999, 1 ether, block.timestamp + 1 hours);

        vm.prank(oracle);
        arbiter.settleOfframp(c);

        vm.prank(oracle);
        vm.expectRevert("already settled");
        arbiter.settleOfframp(c);
    }

    function test_Revert_ExpiredClaim() public {
        (Claim memory c,) = _buildSignedClaim(111, 1 ether, block.timestamp - 1);

        vm.prank(oracle);
        vm.expectRevert("expired");
        arbiter.settleOfframp(c);
    }

    function testFuzz_NonceDoubleSpend(uint256 nonce) public {
        (Claim memory c,) = _buildSignedClaim(nonce, 1 ether, block.timestamp + 1 hours);

        vm.prank(oracle);
        arbiter.settleOfframp(c);

        vm.prank(oracle);
        vm.expectRevert("already settled");
        arbiter.settleOfframp(c);
    }
}
