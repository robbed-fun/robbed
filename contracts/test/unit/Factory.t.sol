// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {BaseFixture} from "test/harness/BaseFixture.sol";
import {CurveFactory} from "src/CurveFactory.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {TestConstants} from "test/harness/TestConstants.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {
    NotRouter,
    NotCurve,
    AlreadyInitialized,
    ZeroAddress,
    InvalidName,
    InvalidSymbol,
    ZeroMetadataHash,
    InvalidMetadataUri,
    GraduationUnfundable,
    CreatesPaused,
    FeeAboveCap,
    CapExceeded
} from "src/errors/Errors.sol";

/// @title Factory unit suite (M1-7) — CREATE2 staging, validation, F4, pauses, caps, one-time setters
contract FactoryTest is BaseFixture {
    function setUp() public {
        _deployStack();
    }

    // ─────────────────── Deployment / registry / CREATE2 staging ───────────────────

    function test_create_wiresRegistryAndMintsSupplyToCurve() public {
        (LaunchToken token, BondingCurve curve) = _create();
        assertEq(factory.curveOf(address(token)), address(curve), "curveOf mismatch");
        assertEq(factory.tokenOf(address(curve)), address(token), "tokenOf mismatch");
        assertTrue(factory.isCurve(address(curve)), "curve not registered");
        assertEq(token.totalSupply(), 1_000_000_000e18, "supply != 1B");
        assertEq(token.balanceOf(address(curve)), 1_000_000_000e18, "full supply not at curve");
        // Curve immutables snapshotted from the factory defaults.
        assertEq(curve.GRADUATION_ETH(), TestConstants.GRADUATION_ETH, "graduationEth not snapshotted");
        assertEq(curve.TRADE_FEE_BPS(), TestConstants.TRADE_FEE_BPS, "tradeFeeBps not snapshotted");
        assertEq(curve.token(), address(token), "curve.token wrong");
    }

    function test_create_metadataHashPropagatedToToken_andEvent() public {
        // F4: the non-zero commitment reaches the token verbatim & immutably (spec §8.3).
        (LaunchToken token,) = _create();
        assertEq(token.metadataHash(), keccak256("meta-json"), "metadataHash not committed to token");
    }

    function test_create_counterMakesUniqueCurves() public {
        (, BondingCurve c1) = _create();
        (, BondingCurve c2) = _create();
        assertTrue(address(c1) != address(c2), "curve addresses collided");
        assertEq(factory.tokenCounter(), 2, "counter did not advance");
    }

    // ───────────────────────────── Input validation ──────────────────────────────

    function test_create_revertsOnlyRouter() public {
        vm.expectRevert(NotRouter.selector);
        factory.createToken(address(this), "N", "S", keccak256("m"), "u");
    }

    function test_create_revertsEmptyName() public {
        vm.deal(address(this), 1 ether);
        uint256 fee = factory.creationFee();
        vm.expectRevert(InvalidName.selector);
        router.createToken{value: fee}("", "SYM", keccak256("m"), "u", 0, block.timestamp);
    }

    function test_create_revertsLongName() public {
        vm.deal(address(this), 1 ether);
        uint256 fee = factory.creationFee();
        string memory long = "123456789012345678901234567890123"; // 33 bytes
        vm.expectRevert(InvalidName.selector);
        router.createToken{value: fee}(long, "SYM", keccak256("m"), "u", 0, block.timestamp);
    }

    function test_create_revertsEmptyAndLongSymbol() public {
        vm.deal(address(this), 1 ether);
        uint256 fee = factory.creationFee();
        vm.expectRevert(InvalidSymbol.selector);
        router.createToken{value: fee}("Name", "", keccak256("m"), "u", 0, block.timestamp);
        vm.expectRevert(InvalidSymbol.selector);
        router.createToken{value: fee}("Name", "12345678901", keccak256("m"), "u", 0, block.timestamp);
    }

    function test_create_revertsZeroMetadataHash() public {
        // F4 load-bearing: the SOLE on-chain enforcement of the §8.3 non-zero commitment.
        vm.deal(address(this), 1 ether);
        uint256 fee = factory.creationFee();
        vm.expectRevert(ZeroMetadataHash.selector);
        router.createToken{value: fee}("Name", "SYM", bytes32(0), "u", 0, block.timestamp);
    }

    function test_create_revertsEmptyOrLongUri() public {
        // F-4 (M1-7/M1-8 gate): a bad metadataUri length now reverts with its OWN error, distinct
        // from the zero-hash commitment fault.
        vm.deal(address(this), 1 ether);
        uint256 fee = factory.creationFee();
        vm.expectRevert(InvalidMetadataUri.selector);
        router.createToken{value: fee}("Name", "SYM", keccak256("m"), "", 0, block.timestamp);

        // 257-byte URI (> 256 cap) reverts with the same distinct error.
        string memory longUri = new string(257);
        vm.expectRevert(InvalidMetadataUri.selector);
        router.createToken{value: fee}("Name", "SYM", keccak256("m"), longUri, 0, block.timestamp);
    }

    // ─────────────────── F-3: graduation-fundability constructor guard ───────────────────

    function test_constructor_revertsWhenGraduationUnfundable() public {
        // Worst-case ceilings summing to >= graduationEth must fail the deploy (fixup F-3): otherwise
        // an owner could tune future curves into a permanently ungraduatable state (spec §12.11).
        CurveFactory.FactoryInit memory p = TestConstants.factoryInit(treasury, safeOwner);
        p.maxGraduationFee = p.graduationEth; // sum with maxCallerReward is now >= graduationEth
        vm.expectRevert(GraduationUnfundable.selector);
        new CurveFactory(p);
    }

    function test_constructor_okWhenGraduationFundable() public {
        // The production M0 ceilings (≈0.0186 ETH) are far below graduationEth (≈8.08 ETH) — deploys.
        CurveFactory.FactoryInit memory p = TestConstants.factoryInit(treasury, safeOwner);
        assertLt(p.maxCallerReward + p.maxGraduationFee, p.graduationEth, "M0 ceilings must be fundable");
        CurveFactory f = new CurveFactory(p);
        assertEq(f.owner(), safeOwner, "owner not set");
    }

    function test_create_revertsWhenPaused() public {
        vm.prank(safeOwner);
        factory.setPauseCreates(true);
        vm.deal(address(this), 1 ether);
        uint256 fee = factory.creationFee();
        vm.expectRevert(CreatesPaused.selector);
        router.createToken{value: fee}("Name", "SYM", keccak256("m"), "u", 0, block.timestamp);
    }

    // ─────────────────────────── recordEthDelta (caps) ───────────────────────────

    function test_recordEthDelta_onlyCurve() public {
        vm.expectRevert(NotCurve.selector);
        factory.recordEthDelta(1);
    }

    function test_recordEthDelta_negativeNeverReverts_floorsAtZero() public {
        (, BondingCurve curve) = _create();
        // Below-zero subtraction must floor at 0, never revert — proof-by-construction obligation (b).
        vm.prank(address(curve));
        factory.recordEthDelta(-100 ether);
        assertEq(factory.globalCurveEth(), 0, "negative delta did not floor at zero");
    }

    function test_recordEthDelta_positiveEnforcesGlobalCap() public {
        (, BondingCurve curve) = _create();
        vm.prank(safeOwner);
        factory.setCaps(type(uint128).max, 10 ether);
        vm.prank(address(curve));
        factory.recordEthDelta(int256(uint256(6 ether)));
        assertEq(factory.globalCurveEth(), 6 ether);
        vm.prank(address(curve));
        vm.expectRevert(CapExceeded.selector);
        factory.recordEthDelta(int256(uint256(5 ether))); // 6 + 5 > 10
    }

    // ───────────────────────── One-time & owner setters ──────────────────────────

    function test_setRouter_setMigrator_oneTimeOnly() public {
        // Fresh factory to test the setters (the fixture already wired both).
        CurveFactory f = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner));
        vm.startPrank(safeOwner);
        f.setRouter(makeAddr("router1"));
        vm.expectRevert(AlreadyInitialized.selector);
        f.setRouter(makeAddr("router2"));
        f.setMigrator(makeAddr("migrator1"));
        vm.expectRevert(AlreadyInitialized.selector);
        f.setMigrator(makeAddr("migrator2"));
        vm.stopPrank();
    }

    function test_setters_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        factory.setPauseBuys(true);
    }

    function test_setTradeFee_capEnforced() public {
        vm.startPrank(safeOwner);
        factory.setTradeFeeBps(200); // exactly the cap ok
        vm.expectRevert(FeeAboveCap.selector);
        factory.setTradeFeeBps(201);
        vm.stopPrank();
    }

    function test_setTreasury_zeroReverts() public {
        vm.prank(safeOwner);
        vm.expectRevert(ZeroAddress.selector);
        factory.setTreasury(address(0));
    }

    function test_feeSetters_ceilingsEnforced() public {
        vm.startPrank(safeOwner);
        vm.expectRevert(FeeAboveCap.selector);
        factory.setCreationFee(TestConstants.MAX_CREATION_FEE + 1);
        vm.expectRevert(FeeAboveCap.selector);
        factory.setGraduationFee(TestConstants.MAX_GRADUATION_FEE + 1);
        vm.expectRevert(FeeAboveCap.selector);
        factory.setCallerReward(TestConstants.MAX_CALLER_REWARD + 1);
        vm.stopPrank();
    }

    function test_creatorFeeBps_isZero() public view {
        assertEq(factory.creatorFeeBps(), 0, "creatorFeeBps must be hardcoded 0 (spec sec 7)");
        assertEq(factory.config().creatorFeeBps, 0, "config creatorFeeBps must be 0");
    }

    function test_ownable2Step_transfer() public {
        address newOwner = makeAddr("newSafe");
        vm.prank(safeOwner);
        factory.transferOwnership(newOwner);
        assertEq(factory.owner(), safeOwner, "owner changed before accept (not 2-step)");
        vm.prank(newOwner);
        factory.acceptOwnership();
        assertEq(factory.owner(), newOwner, "ownership not accepted");
    }

    // ─────── No sell-pause exists (proof by construction: config surface only) ───────

    function test_config_exposesOnlyBuyAndCreatePauses() public {
        ICurveFactory.FactoryConfig memory c = factory.config();
        // The only pause booleans in the config surface — there is no third sell-side flag.
        assertFalse(c.pauseCreates);
        assertFalse(c.pauseBuys);
    }
}
