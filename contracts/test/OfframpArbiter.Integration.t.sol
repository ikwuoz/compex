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
    // Plain Compact typehash (no witness)
    bytes32 internal constant COMPACT_TYPEHASH = keccak256(
        "Compact(address arbiter,address sponsor,uint256 nonce,uint256 expires,bytes12 lockTag,address token,uint256 amount)"
    );

    // Mandate witness matches the fields in our backend mandate object
    bytes32 internal constant MANDATE_TYPEHASH =
        keccak256("Mandate(string bankAccount,uint96 amountNGN,string orderRef,uint32 deadline)");

    // Compact typehash extended with Mandate witness
    bytes32 internal constant COMPACT_WITH_MANDATE_TYPEHASH = keccak256(
        "Compact(address arbiter,address sponsor,uint256 nonce,uint256 expires,bytes12 lockTag,address token,uint256 amount,Mandate mandate)Mandate(string bankAccount,uint96 amountNGN,string orderRef,uint32 deadline)"
    );

    // The witnessTypestring stored in Claim.witnessTypestring (Mandate fields only, no wrapper)
    string internal constant MANDATE_WITNESS_TYPESTRING =
        "string bankAccount,uint96 amountNGN,string orderRef,uint32 deadline";

    OfframpArbiter public arbiter;
    TheCompact public theCompact;
    SimpleAllocator public allocator;

    address public oracle;
    address public lp;
    address public sponsor;
    uint256 public sponsorPrivateKey;
    uint256 public allocatorPrivateKey;
    bytes12 public lockTag;

    function setUp() public {
        oracle = makeAddr("oracle");
        lp = makeAddr("lp");
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
        vm.label(lp, "lp");
        vm.label(sponsor, "sponsor");
    }

    function _createLockTag(ResetPeriod resetPeriod, Scope scope, uint96 allocatorId) internal pure returns (bytes12) {
        return bytes12(bytes32((uint256(scope) << 255) | (uint256(resetPeriod) << 252) | (uint256(allocatorId) << 160)));
    }

    // Extract lockTag and token from the ERC6909 token id and hash the plain Compact struct.
    function _claimHash(
        address arbiterAddr,
        address sponsorAddr,
        uint256 nonce,
        uint256 expires,
        uint256 id,
        uint256 amount
    ) internal pure returns (bytes32) {
        bytes12 lt = bytes12(bytes32(id));
        address token = address(uint160(id));
        return keccak256(abi.encode(COMPACT_TYPEHASH, arbiterAddr, sponsorAddr, nonce, expires, lt, token, amount));
    }

    // Hash a Compact that includes a Mandate witness.
    function _claimHashWithMandate(
        address arbiterAddr,
        address sponsorAddr,
        uint256 nonce,
        uint256 expires,
        uint256 id,
        uint256 amount,
        bytes32 mandateHash
    ) internal pure returns (bytes32) {
        bytes12 lt = bytes12(bytes32(id));
        address token = address(uint160(id));
        return keccak256(
            abi.encode(
                COMPACT_WITH_MANDATE_TYPEHASH, arbiterAddr, sponsorAddr, nonce, expires, lt, token, amount, mandateHash
            )
        );
    }

    // Hash a Mandate struct (used as claim.witness).
    function _mandateHash(string memory bankAccount, uint96 amountNGN, string memory orderRef, uint32 deadline)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(MANDATE_TYPEHASH, keccak256(bytes(bankAccount)), amountNGN, keccak256(bytes(orderRef)), deadline)
        );
    }

    function _signDigest(uint256 privateKey, bytes32 digest) internal pure returns (bytes memory) {
        (bytes32 r, bytes32 vs) = vm.signCompact(privateKey, digest);
        return abi.encodePacked(r, vs);
    }

    // Build a signed Claim (no witness). Claimant is `lp`.
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
        claimants[0] = Component({claimant: uint256(uint160(lp)), amount: amount});
        c.claimants = claimants;

        _signClaim(c, id, amount);
    }

    struct MandateArgs {
        string bankAccount;
        uint96 amountNGN;
        string orderRef;
        uint32 deadline;
    }

    // Build a signed Claim with a Mandate witness. Claimant is `lp`.
    function _buildSignedClaimWithMandate(uint256 nonce, uint256 amount, uint256 expires, MandateArgs memory m)
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
        c.witness = _mandateHash(m.bankAccount, m.amountNGN, m.orderRef, m.deadline);
        c.witnessTypestring = MANDATE_WITNESS_TYPESTRING;

        Component[] memory claimants = new Component[](1);
        claimants[0] = Component({claimant: uint256(uint160(lp)), amount: amount});
        c.claimants = claimants;

        _signClaim(c, id, amount);
    }

    function _signClaim(Claim memory c, uint256 id, uint256 amount) internal view {
        bytes32 ch = bytes32(0) == c.witness
            ? _claimHash(address(arbiter), c.sponsor, c.nonce, c.expires, id, amount)
            : _claimHashWithMandate(address(arbiter), c.sponsor, c.nonce, c.expires, id, amount, c.witness);

        bytes32 digest = keccak256(abi.encodePacked(bytes2(0x1901), theCompact.DOMAIN_SEPARATOR(), ch));
        c.sponsorSignature = _signDigest(sponsorPrivateKey, digest);
        c.allocatorData = _signDigest(allocatorPrivateKey, digest);
    }

    function test_FullFlow_OracleSettlesValidClaim() public {
        uint256 amount = 1 ether;
        (Claim memory c, uint256 id) = _buildSignedClaim(777, amount, block.timestamp + 1 hours);
        uint256 lpBefore = lp.balance;

        vm.prank(oracle);
        arbiter.settleOfframp(c);

        assertTrue(arbiter.settled(keccak256(abi.encode(c.nonce))));
        assertEq(lp.balance, lpBefore + amount, "lp did not receive funds");
        assertEq(theCompact.balanceOf(sponsor, id), 0, "compact balance not cleared");
    }

    // The production flow: sponsor signs over a Mandate witness encoding the
    // bank account, NGN amount, order reference, and payment deadline.
    function test_FullFlow_WithMandateWitness() public {
        uint256 amount = 2 ether;
        (Claim memory c, uint256 id) = _buildSignedClaimWithMandate(
            42,
            amount,
            block.timestamp + 1 hours,
            MandateArgs("0123456789", 3_000_000, "REF-001", uint32(block.timestamp + 30 minutes))
        );
        uint256 lpBefore = lp.balance;

        vm.prank(oracle);
        arbiter.settleOfframp(c);

        assertTrue(arbiter.settled(keccak256(abi.encode(c.nonce))));
        assertEq(lp.balance, lpBefore + amount, "lp did not receive funds");
        assertEq(theCompact.balanceOf(sponsor, id), 0, "compact balance not cleared");
    }

    // Split settlement: two LPs each receive half of the locked amount.
    function test_SplitSettlement_TwoLPs() public {
        uint256 amount = 2 ether;
        address lp2 = makeAddr("lp2");

        vm.prank(sponsor);
        uint256 id = theCompact.depositNative{value: amount}(lockTag, sponsor);

        Claim memory c;
        c.nonce = 555;
        c.sponsor = sponsor;
        c.id = id;
        c.allocatedAmount = amount;
        c.expires = block.timestamp + 1 hours;

        Component[] memory claimants = new Component[](2);
        claimants[0] = Component({claimant: uint256(uint160(lp)), amount: 1 ether});
        claimants[1] = Component({claimant: uint256(uint160(lp2)), amount: 1 ether});
        c.claimants = claimants;

        _signClaim(c, id, amount);

        uint256 lp1Before = lp.balance;
        uint256 lp2Before = lp2.balance;

        vm.prank(oracle);
        arbiter.settleOfframp(c);

        assertEq(lp.balance, lp1Before + 1 ether, "lp1 wrong balance");
        assertEq(lp2.balance, lp2Before + 1 ether, "lp2 wrong balance");
        assertEq(theCompact.balanceOf(sponsor, id), 0, "compact balance not cleared");
    }

    function test_Revert_UserCannotSettleClaim() public {
        (Claim memory c,) = _buildSignedClaim(888, 1 ether, block.timestamp + 1 hours);

        vm.prank(lp);
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

    // TheCompact should reject a claim whose sponsor signature is invalid.
    function test_Revert_InvalidSponsorSignature() public {
        (Claim memory c,) = _buildSignedClaim(222, 1 ether, block.timestamp + 1 hours);
        c.sponsorSignature = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2)));

        vm.prank(oracle);
        vm.expectRevert();
        arbiter.settleOfframp(c);
    }

    // TheCompact/SimpleAllocator should reject a claim whose allocator data is invalid.
    function test_Revert_InvalidAllocatorSignature() public {
        (Claim memory c,) = _buildSignedClaim(333, 1 ether, block.timestamp + 1 hours);
        c.allocatorData = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2)));

        vm.prank(oracle);
        vm.expectRevert();
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
