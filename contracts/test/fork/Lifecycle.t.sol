// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {BondingCurve} from "src/BondingCurve.sol";
import {LaunchToken} from "src/LaunchToken.sol";
import {Router} from "src/Router.sol";
import {V3Migrator} from "src/V3Migrator.sol";
import {LPFeeVault} from "src/LPFeeVault.sol";
import {CreatorVault} from "src/CreatorVault.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Factory} from "src/interfaces/external/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";
import {IWETH9} from "src/interfaces/external/IWETH9.sol";
import {EarlyBuyCapExceeded, NotTrading, NotReady} from "src/errors/Errors.sol";

import {TestConstants} from "test/harness/TestConstants.sol";
import {PoolGriefer} from "test/harness/PoolGriefer.sol";

/// @title Gate-3 fork tests — full lifecycle against live Robinhood Chain (chain ID 4663)
///        (spec §10 gate 3; contracts.md §6 "Gate 3 — fork tests"; plan M1-12)
/// @notice Run: `FOUNDRY_PROFILE=fork ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
///         forge test`. Skips cleanly when the env var is unset (the default-profile suite keeps
///         its two skips). Uses the PRODUCTION contracts end to end — real {Router} (not the unit
///         TestRouter), real {V3Migrator}/{LPFeeVault} — against the REAL §12.28 Uniswap V3
///         Factory/NPM deployments and the REAL canonical WETH `0x0Bd7…AD73`, all read from
///         `tools/m0/out/constants.json` `external` (never invented; contracts.md §6 gate 3).
///
/// @dev Implementation decisions recorded (per the research→decide→record→verify loop):
///
///      1. **Pinned fork block, env-overridable.** `vm.createSelectFork(url, PIN)` with
///         `ROBINHOOD_FORK_BLOCK` override (0 = latest). A pinned height makes the run
///         deterministic AND lets Foundry's RPC cache absorb repeat runs — essential against the
///         rate-limited public endpoint (Foundry Book: fork state at a pinned block is cached;
///         "latest" re-fetches every run). The pin is a chain HEIGHT recorded at authoring time,
///         not a market metric (§2 concerns prices/volumes, not block heights).
///
///      2. **Real-ArbSys smoke goes through `vm.rpc("eth_call", …)`, not a direct call.**
///         Arbitrum precompiles are implemented by ArbOS in the node, NOT as EVM bytecode:
///         `eth_getCode(0x…64)` on 4663 returns the 1-byte stub `0xfe` (INVALID) — verified via
///         cast 2026-07-11 — so a direct in-fork call executes the fetched stub in revm and
///         reverts (docs.arbitrum.io/build-decentralized-apps/precompiles/reference: precompiles
///         are node-level). The only genuine "real precompile path" a fork test can exercise is an
///         `eth_call` served by the live ArbOS node, which `vm.rpc` sends to the active fork's
///         endpoint. The test additionally pins the `0xfe` stub fact so the suite fails loudly if
///         the chain ever starts exposing executable code there (at which point direct-call
///         coverage should be added). This is also why production contract logic must never rely
///         on calling ArbSys working under local simulation — mocks in unit tests, `vm.rpc` here.
///
///      3. **Treasury is a fresh test address, not the Safe.** `external.treasurySafe` in the M0
///         constants is deliberately the zero address (open item O-6) — asserted below so this
///         substitution self-destructs the day the real Safe lands and the fixture must be
///         reconsidered. A fresh codeless address gives wei-exact receipt accounting.
///
///      4. **Stage-4 pollution numbers reuse the locally-proven shapes** from
///         `test/unit/MigratorArbBackKill.t.sol` (recoverable token-leg grief: 900k-token band at
///         target+400..+2400, price pushed ~7% off) — those exact magnitudes were validated
///         against the REAL vendored v3-core bytecode in gate 2, so stage 5 exercises the arb-back
///         against real tick math with a known-recoverable scenario (§6.3.2 liveness + defense).
contract LifecycleForkTest is Test {
    // ─────────────────────────────── chain facts ───────────────────────────────

    /// @notice Canonical WETH on Robinhood Chain (spec §2 chain facts; CLAUDE.md).
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    uint256 internal constant CHAIN_ID = 4663;

    /// @dev Default pin (decision #1): 4663 height observed 2026-07-11 while authoring this suite.
    ///      Override with ROBINHOOD_FORK_BLOCK (0 = latest).
    uint256 internal constant DEFAULT_FORK_BLOCK = 7_210_863;

    /// @dev ArbSys precompile address and `arbBlockNumber()` selector (decision #2).
    address internal constant ARB_SYS = address(100);
    bytes4 internal constant ARB_BLOCK_NUMBER_SEL = 0xa3b1b31d;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    // ────────────────────────────── event topics ───────────────────────────────

    bytes32 internal constant TOKEN_CREATED_TOPIC =
        keccak256("TokenCreated(address,address,address,string,string,bytes32,string,address)");
    bytes32 internal constant GRADUATED_TOPIC =
        keccak256("Graduated(address,address,uint256,uint128,uint256,uint256,uint256,address,uint256,uint256,uint256)");

    // ─────────────────────────────────── state ─────────────────────────────────

    bool internal forked;
    uint256 internal forkBlock;

    // constants.json `external` (stage 0)
    address internal v3FactoryAddr;
    address internal npmAddr;

    // deployed stack (stage 1)
    CurveFactory internal factory;
    Router internal router;
    V3Migrator internal migrator;
    LPFeeVault internal vault;

    // subject (stage 2)
    LaunchToken internal token;
    BondingCurve internal curve;
    address internal pool;
    bool internal tokenIs0;

    address internal treasury = makeAddr("forkTreasury");
    address internal safeOwner = makeAddr("forkSafeOwner");
    address internal creator = makeAddr("forkCreator");
    address internal alice = makeAddr("forkAlice");
    address internal bob = makeAddr("forkBob");
    address internal grad = makeAddr("forkGraduator");
    address internal collector = makeAddr("forkCollector");

    /// @dev ABOVE the F-1 freeze threshold (~`MIGRATION_SLIPPAGE_BPS` of `GRADUATION_ETH` ≈ 0.08 ETH):
    ///      pre-fix a curve donation this large made the migrator's WETH `amount1Min` (anchored to the
    ///      donation-inflated `wethForMint`) unmeetable → `NPM.mint` "Price slippage check" → frozen
    ///      curve. This exercises the F-1 fix against the REAL vendored V3 on the live-chain fork; the
    ///      surplus must still surface as WETH dust to the treasury (`_stage5_graduate` assertions).
    uint256 internal constant ETH_DONATION = 0.25 ether;
    bytes32 internal constant META_HASH = keccak256("robbed-fork-meta");

    function setUp() public {
        string memory url = vm.envOr("ROBINHOOD_RPC_URL", string(""));
        if (bytes(url).length == 0) return; // env-gated: tests below skip cleanly

        uint256 pin = vm.envOr("ROBINHOOD_FORK_BLOCK", DEFAULT_FORK_BLOCK);
        if (pin == 0) vm.createSelectFork(url);
        else vm.createSelectFork(url, pin);
        require(block.chainid == CHAIN_ID, "gate 3: ROBINHOOD_RPC_URL is not chain 4663");
        forkBlock = pin;
        forked = true;
    }

    // ═══════════════════════════ GATE-3 LIFECYCLE ══════════════════════════════
    // create → trade → pollute → graduate (arb-back vs real tick math) → V3 swaps → collect,
    // against the real V3 Factory/NPM and real WETH 0x0Bd7…AD73 (contracts.md §6 gate 3).

    function test_fork_fullLifecycle() public {
        if (!forked) vm.skip(true);

        _stage0_configAndRuntimeAsserts();
        _stage1_deployStack();
        _stage2_createAndAssertPreSeed();
        _stage3_tradeSequence();
        _stage4_pollutePool();
        _stage5_graduate();
        _stage6_generateV3Fees();
        _stage7_collectToTreasury();
    }

    // ═══════════════ GATE-3 §12.63: HOSTILE CREATOR NEVER FREEZES SELLS ═════════════
    // Live-chain mirror of _tmT1_sellClearsWhileTreasuryReverts, for the Phase-2 creator leg.

    /// @notice Deploys a creator-fee-enabled stack (creatorFeeBps = 50, the ratified §12.63 testnet
    ///         placeholder) + a CreatorVault, creates a token whose creator address is then etched
    ///         with reverting bytecode (the same technique the treasury TM-T1 fork test uses), and
    ///         proves against the REAL chain that: a buy and a sell both clear (fees accrue
    ///         in-contract, no creator/vault call on the trade path); `sweepCreatorFees()` always
    ///         lands the escrow in the vault; and the hostile creator's own `claim` reverts in
    ///         isolation (retriable) — freezing nothing but its own revenue. Uses the real §12.28 V3
    ///         pool-init at create and the real ArbSys/timestamp clock.
    function test_fork_hostileCreatorNeverFreezesSells() public {
        if (!forked) vm.skip(true);
        _stage0_configAndRuntimeAsserts();

        // Parallel creator-fee stack (mirrors _stage1 with a live creator leg + CreatorVault).
        LPFeeVault lpVault = new LPFeeVault(npmAddr, treasury);
        CurveFactory f = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner, WETH, 50));
        V3Migrator m =
            new V3Migrator(TestConstants.migratorInit(address(f), v3FactoryAddr, npmAddr, WETH, address(lpVault)));
        Router rtr = new Router(ICurveFactory(address(f)));
        CreatorVault cVault = new CreatorVault(address(f));
        vm.startPrank(safeOwner);
        f.setMigrator(address(m));
        f.setRouter(address(rtr));
        f.setCreatorVault(address(cVault));
        vm.stopPrank();

        // Create with a plain creator address, then etch reverting code onto it (TM-T1 technique).
        address hostile = makeAddr("forkHostileCreator");
        uint256 creationFee = f.creationFee();
        vm.deal(hostile, creationFee);
        vm.prank(hostile);
        (address t, address c,) =
            rtr.createToken{value: creationFee}("HostileC", "HC", keccak256("hc-meta"), "ipfs://hc", 0, block.timestamp);
        LaunchToken tk = LaunchToken(t);
        BondingCurve cv = BondingCurve(payable(c));
        assertEq(cv.creator(), hostile, "creator not set to the hostile address");
        assertEq(cv.CREATOR_FEE_BPS(), 50, "creator leg not live on the fork");

        vm.etch(hostile, hex"60006000fd"); // PUSH1 0x00 PUSH1 0x00 REVERT — reverts on any call
        vm.warp(uint256(cv.EARLY_WINDOW_END())); // past the anti-sniper window (real-chain clock)

        // A BUY clears; both fee legs accrue in-contract (no creator/vault push on the trade path).
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        uint256 bought = rtr.buy{value: 1 ether}(t, alice, 0, block.timestamp);
        assertGt(bought, 0, "12.63 fork: buy frozen by a hostile creator");
        assertGt(cv.accruedCreatorFees(), 0, "12.63 fork: creator leg did not accrue in-contract");

        // A SELL clears — the decisive property.
        uint256 amt = tk.balanceOf(alice);
        uint256 aliceBefore = alice.balance;
        vm.startPrank(alice);
        tk.approve(address(rtr), amt);
        uint256 out = rtr.sell(t, amt, alice, 0, block.timestamp);
        vm.stopPrank();
        assertGt(out, 0, "12.63 fork: SELL FROZEN by a hostile creator (spec 6.5/12.63 violation)");
        assertEq(alice.balance - aliceBefore, out, "12.63 fork: seller not paid under a hostile creator");

        // sweepCreatorFees ALWAYS lands the escrow in the vault (the deposit is a non-reverting
        // accumulate), even though the creator reverts on receive.
        uint256 escrow = cv.accruedCreatorFees();
        assertGt(escrow, 0, "no creator escrow to sweep");
        assertEq(cv.sweepCreatorFees(), escrow, "sweep != escrow");
        assertEq(cVault.balanceOf(hostile), escrow, "vault not credited the hostile creator");
        assertEq(cv.accruedCreatorFees(), 0, "escrow not cleared after sweep");

        // The creator's OWN claim reverts (isolated, retriable) — froze nothing but its own revenue.
        vm.expectRevert();
        cVault.claim(hostile);
        assertEq(cVault.balanceOf(hostile), escrow, "claim revert must preserve the vault balance");
    }

    // ── Stage 0: config from tools/m0/out/constants.json + §12.28 runtime asserts ──

    function _stage0_configAndRuntimeAsserts() internal {
        string memory json = vm.readFile("../tools/m0/out/constants.json");

        // `external` addresses — registry-sourced (§12.28), never invented (contracts.md O-4).
        assertEq(vm.parseJsonAddress(json, ".external.weth"), WETH, "constants.json WETH != canonical 0x0Bd7..AD73");
        v3FactoryAddr = vm.parseJsonAddress(json, ".external.v3Factory");
        npmAddr = vm.parseJsonAddress(json, ".external.positionManager");
        assertTrue(v3FactoryAddr != address(0) && npmAddr != address(0), "V3 externals unset");
        // O-6 tripwire (decision #3): the test's stand-in treasury is only legitimate while the
        // real Safe is unset in the constants. When this fails, wire the fixture to the Safe.
        assertEq(vm.parseJsonAddress(json, ".external.treasurySafe"), address(0), "O-6 resolved: revisit treasury");

        // Drift tripwire: TestConstants mirrors constants.json (single-file diff rule) — a re-run
        // of the M0 notebook must be reflected there or this gate fails loudly.
        assertEq(vm.parseJsonUint(json, ".curve.virtualEthWei"), TestConstants.VIRTUAL_ETH_0, "M0 drift: vE0");
        assertEq(vm.parseJsonUint(json, ".curve.graduationEthWei"), TestConstants.GRADUATION_ETH, "M0 drift: G");
        assertEq(vm.parseJsonUint(json, ".fees.tradeFeeBps"), TestConstants.TRADE_FEE_BPS, "M0 drift: fee bps");
        assertEq(
            vm.parseJsonUint(json, ".v3.sqrtPriceX96Token0"),
            uint256(TestConstants.SQRT_PRICE_TOKEN0_X96),
            "M0 drift: sqrtP0"
        );
        assertEq(
            vm.parseJsonUint(json, ".antiSniper.maxEarlyBuyWei"),
            uint256(TestConstants.MAX_EARLY_BUY_WEI),
            "M0 drift: early cap"
        );

        // V3 runtime sanity assertions (contracts.md §7.2, spec §12.28) against the LIVE chain:
        // fail closed if the registry addresses are wrong for 4663.
        assertEq(IUniswapV3Factory(v3FactoryAddr).feeAmountTickSpacing(10_000), 200, "live V3: 1% tier spacing != 200");
        assertEq(INonfungiblePositionManager(npmAddr).factory(), v3FactoryAddr, "live NPM.factory() mismatch");
        assertEq(INonfungiblePositionManager(npmAddr).WETH9(), WETH, "live NPM.WETH9() != canonical WETH");
        assertTrue(WETH.code.length > 0, "canonical WETH has no code on fork");
    }

    // ── Stage 1: deploy the production stack (deploy order contracts.md §7.2) ──

    function _stage1_deployStack() internal {
        vault = new LPFeeVault(npmAddr, treasury);
        factory = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner)); // WETH = canonical
        migrator =
            new V3Migrator(TestConstants.migratorInit(address(factory), v3FactoryAddr, npmAddr, WETH, address(vault)));
        router = new Router(ICurveFactory(address(factory))); // PRODUCTION router — deadline+pause surface

        vm.startPrank(safeOwner);
        factory.setMigrator(address(migrator));
        factory.setRouter(address(router));
        vm.stopPrank();
    }

    // ── Stage 2: create — TokenCreated + pre-seed defense on the REAL pool (§6.3.2) ──

    function _stage2_createAndAssertPreSeed() internal {
        uint256 creationFee = factory.creationFee();
        uint256 treasuryEthBefore = treasury.balance;
        vm.deal(creator, creationFee);

        vm.recordLogs();
        vm.prank(creator);
        (address t, address c,) = router.createToken{value: creationFee}(
            "Subject", "SUBJ", META_HASH, "ipfs://robbed-fork", 0, block.timestamp
        );
        token = LaunchToken(t);
        curve = BondingCurve(payable(c));
        tokenIs0 = t < WETH;

        // TokenCreated(…, metadataHash, metadataUri, pool) emitted by the factory (spec §12.15).
        Vm.Log memory created = _findLog(address(factory), TOKEN_CREATED_TOPIC);
        assertEq(address(uint160(uint256(created.topics[1]))), t, "TokenCreated.token");
        assertEq(address(uint160(uint256(created.topics[2]))), c, "TokenCreated.curve");
        assertEq(address(uint160(uint256(created.topics[3]))), creator, "TokenCreated.creator");
        (,, bytes32 emittedHash,, address emittedPool) =
            abi.decode(created.data, (string, string, bytes32, string, address));
        assertEq(emittedHash, META_HASH, "TokenCreated.metadataHash");
        assertEq(token.metadataHash(), META_HASH, "token.metadataHash commitment");

        // Pool exists on the REAL v3Factory and is initialized at the deterministic graduation
        // price for this ordering (pre-seed defense, spec §6.3.2).
        pool = IUniswapV3Factory(v3FactoryAddr).getPool(t, WETH, migrator.FEE_TIER());
        assertTrue(pool != address(0), "pool not created on real V3 factory");
        assertEq(emittedPool, pool, "TokenCreated.pool");
        (uint160 sqrtP, int24 tick,,,,,) = IUniswapV3Pool(pool).slot0();
        assertEq(sqrtP, _targetSqrt(), "pool not initialized at target sqrtPrice");
        assertEq(tick, _targetTick(), "pool tick != M0 graduation tick");

        // Creation fee → treasury (create path, not a trade path).
        assertEq(treasury.balance - treasuryEthBefore, creationFee, "creation fee receipt");
    }

    // ── Stage 3: trades via the production Router — anti-sniper, fees, k, reserves ──

    function _stage3_tradeSequence() internal {
        // Anti-sniper window is OPEN at creation (timestamp-based, spec §12.18 — the live chain's
        // clock; never a block-height opcode): an over-cap gross buy must revert.
        uint256 cap = uint256(curve.MAX_EARLY_BUY());
        vm.deal(alice, cap + 2 ether);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(EarlyBuyCapExceeded.selector, cap + 1, cap));
        router.buy{value: cap + 1}(address(token), alice, 0, block.timestamp);

        // At-cap buy inside the window succeeds.
        (uint256 vE0, uint256 vT0,,) = curve.reserves();
        uint256 feesBefore = curve.accruedFees();
        vm.prank(alice);
        uint256 aliceOut = router.buy{value: cap}(address(token), alice, 0, block.timestamp);
        assertGt(aliceOut, 0, "in-window at-cap buy failed");
        assertEq(curve.accruedFees() - feesBefore, (cap * curve.TRADE_FEE_BPS()) / 10_000, "buy fee exact");

        // Past the window: cap lifted.
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        vm.deal(bob, 2 ether);
        vm.prank(bob);
        uint256 bobOut = router.buy{value: 1 ether}(address(token), bob, 0, block.timestamp);
        assertEq(token.balanceOf(bob), bobOut, "buy recipient credit");

        // Sell half of bob's tokens back — never pausable, fee accrues in-contract (§6.5/§12.25).
        (uint256 quotedEth, uint256 quotedFee) = router.quoteSell(address(token), bobOut / 2);
        feesBefore = curve.accruedFees();
        uint256 bobEthBefore = bob.balance;
        vm.startPrank(bob);
        token.approve(address(router), bobOut / 2);
        uint256 ethOut = router.sell(address(token), bobOut / 2, bob, quotedEth, block.timestamp);
        vm.stopPrank();
        assertEq(ethOut, quotedEth, "sell quote parity");
        assertEq(bob.balance - bobEthBefore, ethOut, "sell proceeds paid");
        assertEq(curve.accruedFees() - feesBefore, quotedFee, "sell fee exact");

        _tmT1_sellClearsWhileTreasuryReverts();

        // k non-decreasing across the sequence (gate-2 invariant 1, re-checked on fork).
        (uint256 vE, uint256 vT,, uint256 realToken) = curve.reserves();
        assertGe(vE * vT, vE0 * vT0, "k decreased across fork trade sequence");
        assertGt(realToken, 0, "curve sold out prematurely");

        // Curve solvency snapshot: balance covers reserves + fee escrow (§12.25).
        (,, uint256 realEth,) = curve.reserves();
        assertGe(address(curve).balance, realEth + curve.accruedFees(), "solvency violated");
    }

    // ── TM-T1 (§12.25): a hostile/reverting treasury can never freeze a curve sell ──

    /// @notice Live-conditions proof of the no-pause-authority guarantee's treasury leg (CLAUDE.md
    ///         hard rule; threat-model TM-T1): trade fees accrue in-contract and are NEVER pushed to
    ///         the treasury on any trade path (§12.25), so a treasury pointed at a reverting contract
    ///         — an owner/compromised-signer griefing vector — cannot block exits. We etch code that
    ///         reverts on ANY call at the live treasury address, then a curve SELL must still clear,
    ///         crediting the seller and accruing the fee in-contract; a BUY likewise clears. The
    ///         codeless treasury is restored so the later graduation/sweep pushes succeed. Proven by
    ///         construction in BondingCurve.sell (no treasury call, no pause read) — this exercises it
    ///         against the real chain fork.
    function _tmT1_sellClearsWhileTreasuryReverts() internal {
        // PUSH1 0x00 PUSH1 0x00 REVERT — reverts on every call, with or without value.
        vm.etch(treasury, hex"60006000fd");

        // A SELL clears while the treasury reverts.
        uint256 sellAmt = token.balanceOf(bob);
        require(sellAmt > 0, "TM-T1: bob has no tokens to sell");
        (uint256 qEth, uint256 qFee) = router.quoteSell(address(token), sellAmt);
        uint256 feesBefore = curve.accruedFees();
        uint256 bobEthBefore = bob.balance;
        vm.startPrank(bob);
        token.approve(address(router), sellAmt);
        uint256 out = router.sell(address(token), sellAmt, bob, qEth, block.timestamp);
        vm.stopPrank();
        assertEq(out, qEth, "TM-T1: sell did not clear against a reverting treasury");
        assertEq(bob.balance - bobEthBefore, out, "TM-T1: seller not paid");
        assertEq(curve.accruedFees() - feesBefore, qFee, "TM-T1: sell fee not accrued in-contract");

        // A BUY also clears (buy fee accrues in-contract too; no push, so the reverting treasury is
        // irrelevant to the trade path). NOTE: hold the value in a uint256 local — a bare
        // `0.05 ether * TRADE_FEE_BPS()` computes in the literal's narrow mobile type and overflows.
        uint256 buyValue = 0.05 ether;
        uint256 expectedBuyFee = (buyValue * uint256(curve.TRADE_FEE_BPS())) / 10_000;
        vm.deal(bob, buyValue);
        feesBefore = curve.accruedFees();
        vm.prank(bob);
        uint256 bought = router.buy{value: buyValue}(address(token), bob, 0, block.timestamp);
        assertGt(bought, 0, "TM-T1: buy did not clear against a reverting treasury");
        assertEq(curve.accruedFees() - feesBefore, expectedBuyFee, "TM-T1: buy fee accrued in-contract");

        // A permissionless sweep to the STILL-reverting treasury reverts, but the escrow is retriable
        // (CEI restores accruedFees) — the frozen party is the treasury's own revenue, never the
        // trader's exit. Then restore a codeless treasury so graduation + the eventual sweep land.
        vm.prank(collector);
        vm.expectRevert(); // _sendEth bubbles the treasury revert (EthTransferFailed)
        curve.sweepFees();
        assertGt(curve.accruedFees(), 0, "TM-T1: escrow must remain after a failed sweep (retriable)");

        vm.etch(treasury, ""); // restore codeless treasury for the rest of the lifecycle
    }

    // ── Stage 4: pollute the REAL pool — donation + hostile band + price-limited swap ──

    function _stage4_pollutePool() internal {
        PoolGriefer g = new PoolGriefer(pool, address(token), WETH, npmAddr);
        vm.deal(address(g), 100 ether);
        vm.prank(address(g));
        IWETH9(WETH).deposit{value: 50 ether}();
        // Fund the griefer with curve tokens (money-losing griefing, like the gate-2 harness).
        vm.deal(address(g), address(g).balance + 0.1 ether);
        vm.prank(address(g));
        router.buy{value: 0.1 ether}(address(token), address(g), 0, block.timestamp);
        require(token.balanceOf(address(g)) >= 900_000e18, "griefer under-funded");

        // (a) donations — inert in V3, must not skew the mint (§6.3.2 fuzz row 6's fork echo).
        g.grief_donate(address(token), 1000e18);
        g.grief_donate(WETH, 0.005 ether);

        // (b) attacker liquidity band on the token-overpriced side of target (locally-proven
        //     recoverable shape — decision #4), then (c) a price-limited swap ~7% off target.
        int24 tt = _targetTick();
        if (tokenIs0) g.grief_mint(tt + 400, tt + 2400, 900_000e18, 0);
        else g.grief_mint(tt - 2400, tt - 400, 0, 900_000e18);
        uint160 target = _targetSqrt();
        if (tokenIs0) g.grief_swap(false, 40 ether, uint160((uint256(target) * 107) / 100));
        else g.grief_swap(true, 40 ether, uint160((uint256(target) * 93) / 100));

        // The grief must actually be hostile: off target beyond tolerance, else stage 5 is vacuous.
        (, int24 tick,,,,,) = IUniswapV3Pool(pool).slot0();
        assertGt(_absDiff(tick, tt), uint256(uint24(migrator.TOLERANCE_TICKS())), "grief did not move the pool");

        // ETH donation straight to the curve — swept into graduation (post-grad zero value).
        (bool ok,) = address(curve).call{value: ETH_DONATION}("");
        assertTrue(ok, "curve ETH donation refused");
    }

    // ── Stage 5: graduate — clamp+refund, permissionless, arb-back vs REAL tick math ──

    function _stage5_graduate() internal {
        // Clamped final buy: overshoot the remaining capacity and assert the exact refund.
        uint256 gross = _grossToGraduate() + 1 ether;
        (,, uint256 acceptedEthGross, uint256 refund) = router.quoteBuy(address(token), gross);
        assertGt(refund, 0, "clamp quote returned no refund");
        vm.deal(alice, gross);
        uint256 aliceBefore = alice.balance;
        vm.prank(alice);
        router.buy{value: gross}(address(token), alice, 0, block.timestamp);
        assertEq(aliceBefore - alice.balance, acceptedEthGross, "clamp refund not returned to payer");
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not ReadyToGraduate");

        // §12.12 two-way lock: both directions revert pending permissionless graduate().
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(NotTrading.selector);
        router.buy{value: 0.1 ether}(address(token), bob, 0, block.timestamp);
        vm.startPrank(bob);
        token.approve(address(router), 1e18);
        vm.expectRevert(NotTrading.selector);
        router.sell(address(token), 1e18, bob, 0, block.timestamp);
        vm.stopPrank();

        uint256 treasuryEthBefore = treasury.balance;
        uint256 treasuryWethBefore = IERC20(WETH).balanceOf(treasury);
        uint256 gradEthBefore = grad.balance;

        // Permissionless graduate() from a third address; caller reward asserted.
        vm.recordLogs();
        vm.prank(grad);
        curve.graduate();
        // §12.26/§12.34 gas evidence — graduate()+V3 migration through the WORST-CASE arb-back loop
        // (stage 4 polluted the pool), the conservative upper bound the caller reward must cover.
        uint256 graduateGasPolluted = vm.lastCallGas().gasTotalUsed;
        console2.log("[fork][gas] graduate()+V3 migration (WITH arb-back, polluted pool):", graduateGasPolluted);
        assertEq(grad.balance - gradEthBefore, curve.CALLER_REWARD(), "caller reward not paid");
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "phase not Graduated");

        // Arb-back landed inside tolerance against REAL tick math before minting (§6.3.2).
        (, int24 tick,,,,,) = IUniswapV3Pool(pool).slot0();
        int24 tol = migrator.TOLERANCE_TICKS();
        assertTrue(tick >= _targetTick() - tol && tick <= _targetTick() + tol, "minted outside tolerance");
        assertGt(IUniswapV3Pool(pool).liquidity(), 0, "no liquidity in range post-mint");

        // Graduated event → LP NFT custody, fee-first, dust split (§6.3, §12.13).
        Vm.Log memory gl = _findLog(address(migrator), GRADUATED_TOPIC);
        assertEq(address(uint160(uint256(gl.topics[1]))), address(token), "Graduated.token");
        assertEq(address(uint160(uint256(gl.topics[2]))), pool, "Graduated.pool");
        uint256 tokenId = uint256(gl.topics[3]);
        (, uint256 wethInPos,, uint256 gradFee,,, uint256 tokensBurned, uint256 wethDust) =
            abi.decode(gl.data, (uint128, uint256, uint256, uint256, address, uint256, uint256, uint256));
        gradTokenId = tokenId;

        assertEq(INonfungiblePositionManager(npmAddr).ownerOf(tokenId), address(vault), "LP NFT not in vault");
        assertEq(gradFee, curve.GRADUATION_FEE(), "graduation fee mismatch");
        assertEq(IERC20(WETH).balanceOf(treasury) - treasuryWethBefore, gradFee + wethDust, "treasury WETH: fee + dust");
        assertGe(wethDust, ETH_DONATION, "curve ETH donation did not surface as WETH dust");
        assertEq(token.balanceOf(DEAD), tokensBurned, "token dust not burned to dEaD");
        assertGt(wethInPos, 0, "no WETH in LP position");

        // Post-graduation curve holds zero value beyond the still-claimable fee escrow (§12.25):
        assertEq(token.balanceOf(address(curve)), 0, "curve retained tokens");
        assertEq(address(curve).balance, curve.accruedFees(), "curve ETH beyond fee escrow");
        uint256 fees = curve.accruedFees();
        vm.prank(collector); // sweepFees is permissionless and not phase-gated
        uint256 swept = curve.sweepFees();
        assertEq(swept, fees, "sweep amount");
        assertEq(address(curve).balance, 0, "curve not zero-value after sweep");
        assertEq(treasury.balance - treasuryEthBefore, fees, "treasury fee receipt (ETH leg)");
        // Migrator is stateless-per-token: retains nothing.
        assertEq(token.balanceOf(address(migrator)), 0, "migrator retained tokens");
        assertEq(IERC20(WETH).balanceOf(address(migrator)), 0, "migrator retained WETH");

        // Graduation fires exactly once (gate-2 invariant 4, re-checked on fork).
        vm.expectRevert(NotReady.selector);
        vm.prank(grad);
        curve.graduate();
    }

    uint256 internal gradTokenId;

    // ── Stage 6: accrue 1%-tier fees on the vault's LP position via real pool swaps ──

    function _stage6_generateV3Fees() internal {
        PoolGriefer swapper = new PoolGriefer(pool, address(token), WETH, npmAddr);
        vm.deal(address(swapper), 5 ether);
        vm.prank(address(swapper));
        IWETH9(WETH).deposit{value: 4 ether}();

        // WETH → token, then token → WETH (both fee legs accrue to the full-range position).
        (uint160 sqrtP,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (tokenIs0) {
            swapper.grief_swap(false, 1 ether, uint160((uint256(sqrtP) * 102) / 100));
            swapper.grief_swap(true, int256(token.balanceOf(address(swapper))), uint160((uint256(sqrtP) * 99) / 100));
        } else {
            swapper.grief_swap(true, 1 ether, uint160((uint256(sqrtP) * 98) / 100));
            swapper.grief_swap(false, int256(token.balanceOf(address(swapper))), uint160((uint256(sqrtP) * 101) / 100));
        }
    }

    // ── Stage 7: permissionless collect() → fees land at the fixed treasury (§6.3.4) ──

    function _stage7_collectToTreasury() internal {
        uint256 treasuryWethBefore = IERC20(WETH).balanceOf(treasury);
        uint256 treasuryTokenBefore = token.balanceOf(treasury);

        vm.prank(collector); // arbitrary caller — pays gas, cannot redirect funds
        (uint256 amount0, uint256 amount1) = vault.collect(gradTokenId);

        (uint256 wethFees, uint256 tokenFees) = tokenIs0 ? (amount1, amount0) : (amount0, amount1);
        assertGt(wethFees, 0, "no WETH fees accrued to the LP position");
        assertGt(tokenFees, 0, "no token fees accrued to the LP position");
        assertEq(IERC20(WETH).balanceOf(treasury) - treasuryWethBefore, wethFees, "treasury WETH fee delta");
        assertEq(token.balanceOf(treasury) - treasuryTokenBefore, tokenFees, "treasury token fee delta");
    }

    // ═════════════════════════ REAL-GAS MEASUREMENT (§12.26/§12.34) ═════════════════════════
    // The M1 re-validation obligation the M0 constants carry (graduationFeeModel.status +
    // reviewRequired callerReward row): the cost-based graduation fee and the ≥10×-graduate()-gas
    // caller-reward floor must be re-measured against REAL gas. Testnet is faucet-limited, so this
    // is the live-conditions measurement, taken through the real §12.28 V3 factory/NPM on a fork of
    // 4663 at the LATEST block. It emits the numbers via console2 (`forge test -vv`); tools/m0 folds
    // them (plus a fresh live `eth_gasPrice`) into constants.json — no bytecode changes.

    /// @notice Self-contained CLEAN-path gas: create → representative buy → clamped fill →
    ///         graduate()+V3 migration with the pre-seed pool still exactly at target (no arb-back,
    ///         the typical case). This is the cost basis the §12.26 graduation fee is sized against;
    ///         the polluted (arb-back) upper bound is logged by {test_fork_fullLifecycle}.
    function test_fork_lifecycleGas() public {
        if (!forked) vm.skip(true);
        _stage0_configAndRuntimeAsserts();
        _stage1_deployStack();

        // create()
        uint256 creationFee = factory.creationFee();
        vm.deal(creator, creationFee);
        vm.prank(creator);
        (address t, address c,) = router.createToken{value: creationFee}(
            "GasSubject", "GAS", META_HASH, "ipfs://robbed-gas", 0, block.timestamp
        );
        uint256 createGas = vm.lastCallGas().gasTotalUsed;
        token = LaunchToken(t);
        curve = BondingCurve(payable(c));
        tokenIs0 = t < WETH;
        pool = IUniswapV3Factory(v3FactoryAddr).getPool(t, WETH, migrator.FEE_TIER());

        // A representative post-window buy (anti-sniper cap lifted).
        vm.warp(uint256(curve.EARLY_WINDOW_END()));
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        router.buy{value: 1 ether}(address(token), alice, 0, block.timestamp);
        uint256 buyGas = vm.lastCallGas().gasTotalUsed;

        // A representative sell (never pausable path).
        uint256 half = token.balanceOf(alice) / 2;
        vm.startPrank(alice);
        token.approve(address(router), half);
        router.sell(address(token), half, alice, 0, block.timestamp);
        vm.stopPrank();
        uint256 sellGas = vm.lastCallGas().gasTotalUsed;

        // Clamped fill to graduation — pool untouched, so graduate() runs the no-arb path.
        uint256 gross = _grossToGraduate() + 1 ether;
        vm.deal(bob, gross);
        vm.prank(bob);
        router.buy{value: gross}(address(token), bob, 0, block.timestamp);
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.ReadyToGraduate), "not ReadyToGraduate");

        vm.prank(grad);
        curve.graduate();
        uint256 graduateGasClean = vm.lastCallGas().gasTotalUsed;
        assertEq(uint8(curve.phase()), uint8(IBondingCurve.Phase.Graduated), "not Graduated");

        console2.log("[fork][gas] create():", createGas);
        console2.log("[fork][gas] buy():", buyGas);
        console2.log("[fork][gas] sell():", sellGas);
        console2.log("[fork][gas] graduate()+V3 migration (CLEAN, no arb-back):", graduateGasClean);
        console2.log(
            "[fork][gas] full lifecycle create+buy+sell+graduate:", createGas + buyGas + sellGas + graduateGasClean
        );
        // forkBlock: the pinned height, or 0 when ROBINHOOD_FORK_BLOCK=0 selected LATEST (never
        // read via block.number — that is an L1 estimate on Orbit, §2).
        console2.log("[fork][gas] fork block pin (0 = latest):", forkBlock);

        // Sanity floors: the clean migration is a real, non-trivial cost (guards a silent regression
        // that would under-size the fee/reward re-derivation), and comfortably under the block limit.
        assertGt(graduateGasClean, 200_000, "clean graduate() gas implausibly low");
        assertLt(graduateGasClean, 6_000_000, "clean graduate() gas implausibly high");
    }

    // ═══════════════════════════ REAL-ARBSYS SMOKE ═════════════════════════════

    /// @notice Real-ArbSys smoke (contracts.md §6 gate 3): `arbBlockNumber()` served by the LIVE
    ///         ArbOS node via `vm.rpc` — non-zero, ≥ the pinned fork height, and monotonic. See
    ///         decision #2 for why a direct in-fork call cannot exercise the real precompile.
    function test_fork_arbSysSmoke() public {
        if (!forked) vm.skip(true);

        // The precompile is node-implemented: on-chain "code" is the 1-byte INVALID stub. If this
        // ever changes, revisit decision #2 and add direct-call coverage.
        assertEq(ARB_SYS.code, hex"fe", "ArbSys code stub changed - revisit the vm.rpc approach");

        uint256 first = _arbBlockNumberLive();
        assertGt(first, 0, "gate 3: arbBlockNumber() must be non-zero on the live chain");
        // On an Orbit chain arbBlockNumber IS the L2 height, so live-latest ≥ our pinned height —
        // ties the precompile's semantics to the chain the fork was taken from (spec §2).
        if (forkBlock != 0) assertGe(first, forkBlock, "arbBlockNumber below the pinned fork height");

        uint256 second = _arbBlockNumberLive();
        assertGe(second, first, "arbBlockNumber not monotonic across live reads");
    }

    /// @dev eth_call to the ArbSys precompile, executed by the live node (the REAL ArbOS path).
    function _arbBlockNumberLive() internal returns (uint256) {
        bytes memory ret = vm.rpc(
            "eth_call", "[{\"to\":\"0x0000000000000000000000000000000000000064\",\"data\":\"0xa3b1b31d\"},\"latest\"]"
        );
        return abi.decode(ret, (uint256));
    }

    // ─────────────────────────────── helpers ───────────────────────────────────

    function _targetTick() internal view returns (int24) {
        return tokenIs0 ? migrator.TARGET_TICK_TOKEN0() : migrator.TARGET_TICK_TOKEN1();
    }

    function _targetSqrt() internal view returns (uint160) {
        return tokenIs0 ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
    }

    /// @dev Gross ETH needed to land net reserves exactly on GRADUATION_ETH from the current state.
    function _grossToGraduate() internal view returns (uint256) {
        (,, uint256 realEth,) = curve.reserves();
        uint256 remaining = curve.GRADUATION_ETH() - realEth;
        return Math.ceilDiv(remaining * 10_000, 10_000 - curve.TRADE_FEE_BPS());
    }

    function _absDiff(int24 a, int24 b) internal pure returns (uint256) {
        return a >= b ? uint256(uint24(a - b)) : uint256(uint24(b - a));
    }

    /// @dev First recorded log from `emitter` with `topic0`; reverts the test if absent.
    function _findLog(address emitter, bytes32 topic0) internal view returns (Vm.Log memory) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic0) {
                return logs[i];
            }
        }
        revert("expected log not found");
        // solhint-disable-previous-line reason-string
    }
}
