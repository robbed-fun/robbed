// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {Router} from "src/Router.sol";
import {V3Migrator} from "src/V3Migrator.sol";
import {LPFeeVault} from "src/LPFeeVault.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Factory} from "src/interfaces/external/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";

import {TestConstants} from "test/harness/TestConstants.sol";

/// @title Gate-3 F-1 fork regression — a 10×G curve donation must graduate through the REAL V3
///        stack (finding F-1, HIGH, PoC-confirmed 2026-07-13; spec §6.3.2, §10 gate 3, §12.13)
/// @notice Companion to test/fork/Lifecycle.t.sol (whose stage-4 donation, now 0.25 ETH > the ~1%
///         freeze threshold, exercises F-1 under combined pool griefing): this suite isolates the
///         EXTREME donation magnitude the audit called out — 10× GRADUATION_ETH (~79 ETH) sent to
///         the curve's ungated `receive()` on a PRISTINE at-target pool — and proves against the
///         real §12.28 NonfungiblePositionManager that graduation succeeds and every donated wei
///         surfaces as treasury WETH dust (wei-exact conservation). Pre-fix, ANY donation above
///         ~`MIGRATION_SLIPPAGE_BPS` of G froze the curve forever in `ReadyToGraduate` (§12.12):
///         the mint's WETH amount-min anchored to the donation-inflated `wethForMint` and the real
///         NPM reverted "Price slippage check" on every retry.
/// @dev Run under the fork profile: `FOUNDRY_PROFILE=fork ROBINHOOD_RPC_URL=… forge test`.
///      Skips cleanly when the env var is unset. Kept to a SINGLE extra lifecycle (one create +
///      one clamped fill + one graduation) to respect the rate-limited public RPC — the magnitude
///      scan (2%, 10%, 10×G + [1 wei, 10×G] fuzz) lives in the local
///      test/unit/MigratorDonationFreeze.t.sol suite against the vendored V3 bytecode.
contract DonationFreezeForkTest is Test {
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    uint256 internal constant CHAIN_ID = 4663;
    uint256 internal constant DEFAULT_FORK_BLOCK = 7_210_863; // same pin as Lifecycle.t.sol

    bytes32 internal constant GRADUATED_TOPIC =
        keccak256("Graduated(address,address,uint256,uint128,uint256,uint256,uint256,address,uint256,uint256,uint256)");

    bool internal forked;

    CurveFactory internal factory;
    Router internal router;
    V3Migrator internal migrator;
    LPFeeVault internal vault;

    address internal treasury = makeAddr("f1ForkTreasury");
    address internal safeOwner = makeAddr("f1ForkSafeOwner");
    address internal creator = makeAddr("f1ForkCreator");
    address internal buyer = makeAddr("f1ForkBuyer");
    address internal donor = makeAddr("f1ForkDonor");
    address internal grad = makeAddr("f1ForkGraduator");

    function setUp() public {
        string memory url = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(url).length == 0) return; // env-gated: skips cleanly
        uint256 pin = vm.envOr("ROBINHOOD_FORK_BLOCK", DEFAULT_FORK_BLOCK);
        if (pin == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, pin);
        require(block.chainid == CHAIN_ID, "gate 3: ROBINHOOD_RPC_URL is not chain 4663");
        forked = true;
    }

    function test_fork_F1_donation10xG_graduates_donationToDust() public {
        if (!forked) vm.skip(true);

        // Externals from the canonical M0 constants (never invented — §12.28 / contracts.md O-4).
        string memory json = vm.readFile("../tools/m0/out/constants.json");
        address v3FactoryAddr = vm.parseJsonAddress(json, ".external.v3Factory");
        address npmAddr = vm.parseJsonAddress(json, ".external.positionManager");
        assertEq(vm.parseJsonAddress(json, ".external.weth"), WETH, "constants WETH != canonical");

        // Production stack (contracts.md §7.2 order), same shape as Lifecycle._stage1.
        vault = new LPFeeVault(npmAddr, treasury);
        factory = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner));
        migrator =
            new V3Migrator(TestConstants.migratorInit(address(factory), v3FactoryAddr, npmAddr, WETH, address(vault)));
        router = new Router(ICurveFactory(address(factory)));
        vm.startPrank(safeOwner);
        factory.setMigrator(address(migrator));
        factory.setRouter(address(router));
        vm.stopPrank();

        // Create + clamped fill to ReadyToGraduate (pool stays pristine at the target price).
        uint256 creationFee = factory.creationFee();
        vm.deal(creator, creationFee);
        vm.prank(creator);
        (address t, address c,) = router.createToken{value: creationFee}(
            "F1 Donation", "F1D", keccak256("f1-fork-meta"), "ipfs://f1-fork", 0, block.timestamp
        );
        LaunchToken token = LaunchToken(t);
        BondingCurve curve = BondingCurve(payable(c));
        address pool = IUniswapV3Factory(v3FactoryAddr).getPool(t, WETH, migrator.FEE_TIER());

        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        uint256 gross = Math.ceilDiv(curve.GRADUATION_ETH() * 10_000, 10_000 - curve.TRADE_FEE_BPS()) + 1e15;
        vm.deal(buyer, gross);
        vm.prank(buyer);
        router.buy{value: gross}(address(token), buyer, 0, block.timestamp);
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not ReadyToGraduate");

        // THE F-1 VECTOR at audit-called-out magnitude: 10×G straight into the curve's receive().
        uint256 donation = curve.GRADUATION_ETH() * 10;
        vm.deal(donor, donation);
        vm.prank(donor);
        (bool ok,) = c.call{value: donation}("");
        assertTrue(ok, "curve donation refused");

        uint256 treasuryWethBefore = IERC20(WETH).balanceOf(treasury);
        vm.recordLogs();
        vm.prank(grad);
        curve.graduate(); // pre-fix: real-NPM "Price slippage check" revert — the permanent freeze

        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "F-1 fork: did not graduate");
        assertGt(IUniswapV3Pool(pool).liquidity(), 0, "F-1 fork: no liquidity minted");

        // Wei-exact split of the raise + donation (real-NPM leg of the unit suite's conservation).
        (uint256 wethInPos, uint256 gradFee, uint256 wethDust) = _decodeGraduated();
        assertEq(
            gradFee + wethInPos + wethDust,
            curve.GRADUATION_ETH() + donation - curve.CALLER_REWARD(),
            "F-1 fork: WETH conservation broken"
        );
        assertGe(wethDust, donation, "F-1 fork: donation did not surface as WETH dust");
        assertEq(
            IERC20(WETH).balanceOf(treasury) - treasuryWethBefore,
            gradFee + wethDust,
            "F-1 fork: treasury WETH receipt != fee + dust"
        );
        assertEq(IERC20(WETH).balanceOf(address(migrator)), 0, "F-1 fork: migrator retained WETH");
        assertEq(token.balanceOf(address(migrator)), 0, "F-1 fork: migrator retained tokens");
    }

    /// @dev (wethInPosition, gradFee, wethDust) from the migrator's Graduated log.
    function _decodeGraduated() internal returns (uint256 wethInPos, uint256 gradFee, uint256 wethDust) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(migrator) && logs[i].topics.length == 4
                    && logs[i].topics[0] == GRADUATED_TOPIC
            ) {
                (, wethInPos,, gradFee,,,, wethDust) = abi.decode(
                    logs[i].data, (uint128, uint256, uint256, uint256, address, uint256, uint256, uint256)
                );
                return (wethInPos, gradFee, wethDust);
            }
        }
        revert("no Graduated log");
        // solhint-disable-previous-line reason-string
    }
}
