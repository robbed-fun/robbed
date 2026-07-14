// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";
import {ILaunchToken} from "../../src/interfaces/ILaunchToken.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title LaunchToken unit tests (M1-5) —, contracts.md
/// @notice Proves the owned invariants: fixed 1B supply minted once to the curve; ownerless (no
///         `Ownable`); `metadataHash` immutable; no `mint`/`burn` selectors exist; EIP-2612 permit
///         works; 18 decimals; no transfer tax/hook. These back the M1-5 "Definition of done".
contract LaunchTokenTest is Test {
    LaunchToken internal token;

    address internal constant CURVE = address(0xC0FFEE);
    string internal constant NAME = "Hood Token";
    string internal constant SYMBOL = "HOOD";
    bytes32 internal constant META = keccak256("canonical-metadata-json");

    uint256 internal constant EXPECTED_SUPPLY = 1_000_000_000e18;

    // EIP-2612 typehash (mirrors OZ ERC20Permit).
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        token = new LaunchToken(NAME, SYMBOL, META, CURVE);
    }

    // ─────────────────────────── Fixed supply, minted to curve ──────────────────────────

    function test_TotalSupplyIsFixed1B() public view {
        assertEq(token.totalSupply(), EXPECTED_SUPPLY, "totalSupply must be 1,000,000,000e18");
        assertEq(token.TOTAL_SUPPLY(), EXPECTED_SUPPLY, "TOTAL_SUPPLY getter must match");
    }

    function test_EntireSupplyMintedToCurve() public view {
        assertEq(token.balanceOf(CURVE), EXPECTED_SUPPLY, "full supply must land at the curve");
        assertEq(token.balanceOf(address(this)), 0, "deployer holds nothing");
    }

    function test_Decimals18() public view {
        assertEq(token.decimals(), 18, "18 decimals");
    }

    function test_NameAndSymbol() public view {
        assertEq(token.name(), NAME);
        assertEq(token.symbol(), SYMBOL);
    }

    // ─────────────────────────────── metadataHash immutable ─────────────────────────────

    function test_MetadataHashStored() public view {
        assertEq(token.metadataHash(), META, "metadataHash must equal constructor arg");
    }

    function test_MetadataHashVariesPerToken() public {
        bytes32 other = keccak256("different-json");
        LaunchToken t2 = new LaunchToken(NAME, SYMBOL, other, CURVE);
        assertEq(t2.metadataHash(), other);
        assertTrue(t2.metadataHash() != token.metadataHash());
    }

    /// @dev No setter for metadataHash can exist: probe a plausible selector and require it absent.
    function test_NoMetadataHashSetter() public {
        (bool ok,) = address(token).call(abi.encodeWithSignature("setMetadataHash(bytes32)", bytes32(0)));
        assertFalse(ok, "no setMetadataHash may exist");
    }

    // ───────────────────────────── Ownerless (no Ownable) ───────────────────────────────

    function test_HasNoOwner() public {
        (bool ok,) = address(token).call(abi.encodeWithSignature("owner()"));
        assertFalse(ok, "LaunchToken must not expose owner() - ownerless by construction");
    }

    function test_HasNoAdminSelectors() public {
        // A representative set of privileged selectors that must NOT exist on an ownerless token.
        string[6] memory sigs = [
            "transferOwnership(address)",
            "renounceOwnership()",
            "setBlacklist(address,bool)",
            "pause()",
            "setFee(uint256)",
            "setTaxRate(uint256)"
        ];
        for (uint256 i; i < sigs.length; ++i) {
            (bool ok,) = address(token).call(abi.encodeWithSignature(sigs[i]));
            assertFalse(ok, "privileged selector must be absent");
        }
    }

    // ───────────────────────────── No mint / no burn ────────────────────────────────────

    function test_NoMintSelectors() public {
        (bool a,) = address(token).call(abi.encodeWithSignature("mint(address,uint256)", CURVE, 1));
        (bool b,) = address(token).call(abi.encodeWithSignature("mint(uint256)", 1));
        assertFalse(a, "mint(address,uint256) must be absent");
        assertFalse(b, "mint(uint256) must be absent");
    }

    function test_NoBurnSelectors() public {
        (bool a,) = address(token).call(abi.encodeWithSignature("burn(uint256)", 1));
        (bool b,) = address(token).call(abi.encodeWithSignature("burn(address,uint256)", CURVE, 1));
        (bool c,) = address(token).call(abi.encodeWithSignature("burnFrom(address,uint256)", CURVE, 1));
        assertFalse(a, "burn(uint256) must be absent");
        assertFalse(b, "burn(address,uint256) must be absent");
        assertFalse(c, "burnFrom(address,uint256) must be absent");
    }

    /// @dev Supply is invariant across ordinary token movement (no mint on transfer, no reflection).
    function test_SupplyConstantAcrossTransfers() public {
        address alice = makeAddr("alice");
        vm.prank(CURVE);
        token.transfer(alice, 100e18);
        assertEq(token.totalSupply(), EXPECTED_SUPPLY, "supply unchanged by transfer");
        assertEq(token.balanceOf(alice), 100e18, "no tax: full amount received");
        assertEq(token.balanceOf(CURVE), EXPECTED_SUPPLY - 100e18, "no tax on sender leg");
    }

    // ─────────────────────────────────── EIP-2612 permit ────────────────────────────────

    function test_PermitSetsAllowanceAndSpends() public {
        uint256 pk = 0xA11CE;
        address owner = vm.addr(pk);
        address spender = makeAddr("spender");
        uint256 value = 500e18;
        uint256 deadline = block.timestamp + 1 hours;

        // Fund the permit owner so the subsequent transferFrom is meaningful.
        vm.prank(CURVE);
        token.transfer(owner, value);

        uint256 nonceBefore = token.nonces(owner);
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonceBefore, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        token.permit(owner, spender, value, deadline, v, r, s);

        assertEq(token.allowance(owner, spender), value, "permit must set allowance");
        assertEq(token.nonces(owner), nonceBefore + 1, "nonce must increment");

        vm.prank(spender);
        token.transferFrom(owner, spender, value);
        assertEq(token.balanceOf(spender), value, "spender must be able to pull the permitted amount");
    }

    function test_PermitRejectsExpiredDeadline() public {
        uint256 pk = 0xB0B;
        address owner = vm.addr(pk);
        address spender = makeAddr("spender2");
        uint256 deadline = block.timestamp - 1; // already expired

        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, uint256(1e18), token.nonces(owner), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);

        vm.expectRevert(); // OZ ERC2612ExpiredSignature
        token.permit(owner, spender, 1e18, deadline, v, r, s);
    }

    // ───────────────────────── Interface conformance (frozen ABI) ────────────────────────

    function test_ImplementsILaunchToken() public view {
        ILaunchToken t = ILaunchToken(address(token));
        assertEq(t.metadataHash(), META);
        assertEq(t.TOTAL_SUPPLY(), EXPECTED_SUPPLY);
        // IERC20 surface reachable through the frozen interface.
        assertEq(IERC20(address(t)).totalSupply(), EXPECTED_SUPPLY);
    }
}
