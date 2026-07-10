// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Script, console2} from "forge-std/Script.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {V3Migrator} from "src/V3Migrator.sol";
import {Router} from "src/Router.sol";
import {LPFeeVault} from "src/LPFeeVault.sol";
import {BondingCurve} from "src/BondingCurve.sol";

import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";
import {IUniswapV3Factory} from "src/interfaces/external/IUniswapV3Factory.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";

import {V3Assertions} from "./lib/V3Assertions.sol";

import {MockWETH9} from "test/mocks/MockWETH9.sol";

/// @title Deploy — ROBBED_ deploy script + constants loader + canary smoke (M1-14)
/// @notice One script drives every environment (contracts.md §7.2): it reads EVERY market-dependent
///         parameter from `tools/m0/out/constants.json` (spec §2/§6.4 — nothing inlined), runs the
///         §12.28 V3 runtime sanity assertions + the absolute canonical-WETH require (F-2), deploys
///         the six-contract topology in §7.2 order (1) LPFeeVault → (2) CurveFactory →
///         (3) V3Migrator → (4) Router → (5) one-time setters → (6) canary create+buy, writes a
///         self-describing deploy artifact (`deployments/<chainId>.json`) for the addresses codegen,
///         and (live only) hands ownership to the treasury Safe (Ownable2Step step 7).
///
/// @dev  ── Two modes, auto-selected by `block.chainid` (no env flag needed so the bare
///          `forge script … --broadcast` verify command works out of the box):
///        - LIVE (`block.chainid == 4663`, real chain or fork): the four V3 addresses + WETH come
///          from `constants.json.external.*`; `require(weth == 0x0Bd7…AD73)` (F-2) and non-zero
///          treasury Safe (O-6 fail-closed) are enforced.
///        - LOCAL smoke (any other chain id, e.g. anvil 31337): the canonical §12.28 addresses have
///          NO code on a fresh anvil, so we deploy the REAL precompiled Uniswap V3 core+periphery
///          bytecode + a MockWETH9 locally (the M1-10 {V3Fixture} pattern) and point the stack at
///          them — so `V3Assertions.assertV3Wiring` runs against a genuinely live local V3 and the
///          canary exercises the real pool-init math. The F-2 canonical-WETH require is skipped
///          locally BY DESIGN (the mock is not `0x0Bd7…AD73`); every OTHER assertion still runs.
///
///       ── Design decisions (owned by hoodpad-contracts; recorded here + in the final report):
///        1. Deploy artifact is written by the SCRIPT via `vm.serialize*`/`vm.writeJson`, NOT parsed
///           by the codegen from `broadcast/…/run-latest.json`. Options weighed: (a) parse the
///           broadcast receipt — rejected: the six contracts include a CREATE2 curve + CREATE token
///           minted by the factory (not top-level txs), so name→address mapping is fragile; (b) a
///           self-describing artifact — chosen: the script already holds every typed address, so it
///           emits an authoritative, flat, deterministic JSON. Simulation and on-chain nonces match,
///           so the recorded addresses equal the broadcast addresses. Basis: Foundry JSON cheatcodes
///           (getfoundry.sh/cheatcodes — `serialize*`/`writeJson`).
///        2. `block.chainid`, not an env flag, selects mode — matches the exact task verify command
///           (`forge script … --rpc-url http://localhost:8545 --broadcast`, no extra flags). 4663 is
///           the real chain AND the fork profile, so live/local split cleanly.
///        3. Local-only signer fallback to the PUBLIC anvil account-0 key when `DEPLOYER_PRIVATE_KEY`
///           is unset — never on a live chain (there we `revert MissingDeployerKey`). Keeps the bare
///           smoke command keyless while never risking a real deploy without an explicit key.
contract Deploy is Script {
    /// @notice Canonical WETH9 on chain 4663 (CLAUDE.md / spec §12.28). The ONLY address literal
    ///         allowed in the codebase; asserted equal to `constants.json.external.weth` on live.
    address internal constant CANONICAL_WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    /// @notice The production chain id (spec §2). Live vs local-smoke discriminator.
    uint256 internal constant LIVE_CHAIN_ID = 4663;

    /// @notice The 1% V3 fee tier used for graduation pools (spec §12.1) — canary pool lookup.
    uint24 internal constant FEE_TIER = 10_000;

    /// @notice PUBLIC, well-known anvil account-0 private key (printed by `anvil` on boot; NOT a
    ///         secret). Local-smoke signer fallback only — never used when `block.chainid == 4663`.
    uint256 internal constant ANVIL_ACCOUNT0_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    /// @notice NPM token-URI descriptor stand-in for the LOCAL periphery deploy (URI only; the
    ///         graduation/mint path never reads it). Mirrors {V3Fixture}.
    address internal constant NPM_DESCRIPTOR = 0x000000000000000000000000000000000000bEEF;

    // ── deploy-tooling custom errors (never revert strings — spec §6.7) ──
    error MissingDeployerKey();
    error TreasurySafeUnset();
    error WethMismatch(address expected, address actual);
    error SupplySplitMismatch(uint256 sum);
    error GraduationUnfundable();
    error CanaryNoTokensOut();
    error CanaryPoolUninitialized(address pool);
    error CanaryPriceMismatch(uint160 expected, uint160 actual);
    error CreateFailed();

    // ── resolved environment (script contract state → keeps run() off the stack) ──
    bool internal live;
    address internal deployer;
    address internal treasury;
    address internal weth;
    address internal v3Factory;
    address internal npm;
    address internal swapRouter02;
    address internal quoterV2;

    // ── deployed ROBBED_ topology ──
    LPFeeVault internal vault;
    CurveFactory internal factory;
    V3Migrator internal migrator;
    Router internal router;
    address internal canaryToken;
    address internal canaryCurve;

    // ── the raw constants.json blob (loaded once) ──
    string internal cj;

    function run() external {
        // 0. Resolve signer + mode (pre-broadcast; no state writes on chain here).
        live = block.chainid == LIVE_CHAIN_ID;
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (pk == 0) {
            if (live) revert MissingDeployerKey();
            pk = ANVIL_ACCOUNT0_PK; // local-only public fallback (decision #3)
        }
        deployer = vm.addr(pk);

        // 1. Load the M0 constants + resolve external addresses (WETH/V3/treasury) per mode.
        string memory path = vm.envOr("ROBBED_CONSTANTS", string("../tools/m0/out/constants.json"));
        cj = vm.readFile(path);
        _consistencyChecks(); // fail-closed on a malformed/incoherent constants file BEFORE spend

        vm.startBroadcast(pk);

        _resolveExternals(); // live: read+assert §12.28; local: deploy real V3 + MockWETH9

        // 2. §12.28 V3 runtime sanity (both modes) + F-2 canonical-WETH (live only).
        V3Assertions.assertV3Wiring(v3Factory, npm, weth);
        if (live && weth != CANONICAL_WETH) revert WethMismatch(CANONICAL_WETH, weth);

        // 3. Deploy topology in contracts.md §7.2 order.
        _deployTopology();

        // 4. Canary create + tiny buy — proves the wired stack works end-to-end (§7.2 step 6).
        _canary();

        // 5. Ownership handoff (live only): Ownable2Step — not live until the Safe accepts (§7.2 #7).
        if (live) {
            factory.transferOwnership(treasury);
            console2.log("[deploy] ownership transfer initiated -> Safe (must acceptOwnership):", treasury);
        }

        vm.stopBroadcast();

        // 6. Emit the deploy artifact the addresses codegen consumes (architecture.md §4).
        _writeArtifact();

        _logVerifyHints();
    }

    // ──────────────────────────── constants loader ─────────────────────────────

    /// @dev Loader-level consistency assertions mirroring the invariants `constants.json` documents
    ///      (reviewRequired / derivation): the supply split reconstructs the fixed 1e27 total
    ///      (spec §6.4), and graduation stays fundable at the fee ceilings (contracts.md F-3). The
    ///      factory constructor re-checks both by construction; doing it here fails a bad constants
    ///      file loudly, pre-broadcast, with a deploy-specific error.
    function _consistencyChecks() internal view {
        uint256 curveSupply = vm.parseJsonUint(cj, ".curve.curveSupplyWei");
        uint256 lpTranche = vm.parseJsonUint(cj, ".curve.lpTrancheWei");
        if (curveSupply + lpTranche != 1_000_000_000e18) revert SupplySplitMismatch(curveSupply + lpTranche);

        uint256 graduationEth = vm.parseJsonUint(cj, ".curve.graduationEthWei");
        uint256 maxGraduationFee = vm.parseJsonUint(cj, ".fees.maxGraduationFeeWei");
        uint256 maxCallerReward = vm.parseJsonUint(cj, ".fees.maxCallerRewardWei");
        if (maxCallerReward + maxGraduationFee >= graduationEth) revert GraduationUnfundable();
    }

    /// @dev Build the factory init struct straight from `constants.json` (nothing inlined — §6.4).
    function _factoryInit() internal view returns (CurveFactory.FactoryInit memory p) {
        p.weth = weth;
        p.treasury = treasury;
        p.initialOwner = deployer; // deployer wires setters; live handoff to Safe at the end
        p.virtualEth0 = vm.parseJsonUint(cj, ".curve.virtualEthWei");
        p.virtualToken0 = vm.parseJsonUint(cj, ".curve.virtualTokenWei");
        p.curveSupply = vm.parseJsonUint(cj, ".curve.curveSupplyWei");
        p.lpTranche = vm.parseJsonUint(cj, ".curve.lpTrancheWei");
        p.graduationEth = vm.parseJsonUint(cj, ".curve.graduationEthWei");
        p.tradeFeeBps = uint16(vm.parseJsonUint(cj, ".fees.tradeFeeBps"));
        p.creationFee = vm.parseJsonUint(cj, ".fees.creationFeeWei");
        p.maxCreationFee = vm.parseJsonUint(cj, ".fees.maxCreationFeeWei");
        p.graduationFee = vm.parseJsonUint(cj, ".fees.graduationFeeWei");
        p.maxGraduationFee = vm.parseJsonUint(cj, ".fees.maxGraduationFeeWei");
        p.callerReward = vm.parseJsonUint(cj, ".fees.callerRewardWei");
        p.maxCallerReward = vm.parseJsonUint(cj, ".fees.maxCallerRewardWei");
        p.earlyWindowSeconds = uint64(vm.parseJsonUint(cj, ".antiSniper.windowSeconds"));
        p.maxEarlyBuyWei = uint128(vm.parseJsonUint(cj, ".antiSniper.maxEarlyBuyWei"));
        p.perTokenEthCap = uint128(vm.parseJsonUint(cj, ".beta.perTokenEthCapWei"));
        p.globalEthCap = uint128(vm.parseJsonUint(cj, ".beta.globalEthCapWei"));
    }

    /// @dev Build the migrator init struct from `constants.json.v3` + resolved addresses.
    function _migratorInit() internal view returns (V3Migrator.MigratorInit memory p) {
        p.factory = address(factory);
        p.v3Factory = v3Factory;
        p.positionManager = npm;
        p.weth = weth;
        p.vault = address(vault);
        p.sqrtPriceToken0X96 = uint160(vm.parseJsonUint(cj, ".v3.sqrtPriceX96Token0"));
        p.sqrtPriceToken1X96 = uint160(vm.parseJsonUint(cj, ".v3.sqrtPriceX96Token1"));
        p.targetTickToken0 = int24(vm.parseJsonInt(cj, ".v3.targetTickToken0"));
        p.targetTickToken1 = int24(vm.parseJsonInt(cj, ".v3.targetTickToken1"));
        p.toleranceTicks = int24(vm.parseJsonInt(cj, ".v3.toleranceTicks"));
        p.maxArbIterations = uint8(vm.parseJsonUint(cj, ".v3.maxArbIterations"));
        p.migrationSlippageBps = uint16(vm.parseJsonUint(cj, ".v3.migrationSlippageBps"));
    }

    // ──────────────────────────── external addresses ───────────────────────────

    /// @dev Resolve WETH + the four V3 externals + treasury. LIVE reads `constants.json.external.*`
    ///      and enforces the O-6 non-zero-Safe guard; LOCAL deploys real V3 core+periphery bytecode
    ///      + MockWETH9 and uses the deployer as the (dev EOA) treasury.
    function _resolveExternals() internal {
        swapRouter02 = vm.parseJsonAddress(cj, ".external.swapRouter02");
        quoterV2 = vm.parseJsonAddress(cj, ".external.quoterV2");

        if (live) {
            weth = vm.parseJsonAddress(cj, ".external.weth");
            v3Factory = vm.parseJsonAddress(cj, ".external.v3Factory");
            npm = vm.parseJsonAddress(cj, ".external.positionManager");
            treasury = vm.parseJsonAddress(cj, ".external.treasurySafe");
            if (treasury == address(0)) revert TreasurySafeUnset(); // O-6 fail-closed (spec §13)
        } else {
            weth = address(new MockWETH9());
            (v3Factory, npm) = _deployLocalV3(weth);
            treasury = deployer; // dev EOA can receive the creation-fee ETH push in the canary
        }
    }

    /// @dev Deploy the official PRECOMPILED UniswapV3Factory + NonfungiblePositionManager (0.7.6
    ///      bytecode) via `vm.getCode` — the M1-10 {V3Fixture} pattern. The core factory constructor
    ///      pre-enables the 1% tier (10000→200) so `assertV3Wiring` passes against this local V3.
    function _deployLocalV3(address weth_) internal returns (address f, address n) {
        f = _create(vm.getCode("test/vendor/uniswap/UniswapV3Factory.json"));
        bytes memory npmInit = abi.encodePacked(
            vm.getCode("test/vendor/uniswap/NonfungiblePositionManager.json"), abi.encode(f, weth_, NPM_DESCRIPTOR)
        );
        n = _create(npmInit);
    }

    function _create(bytes memory code) internal returns (address addr) {
        assembly {
            addr := create(0, add(code, 0x20), mload(code))
        }
        if (addr == address(0)) revert CreateFailed();
    }

    // ──────────────────────────── deploy topology ──────────────────────────────

    /// @dev §7.2 order: (1) vault (treasury frozen forever) → (2) factory → (3) migrator →
    ///      (4) router → (5) one-time setters. Topology is immutable after the setters (spec §6).
    function _deployTopology() internal {
        vault = new LPFeeVault(npm, treasury); // 1
        factory = new CurveFactory(_factoryInit()); // 2
        migrator = new V3Migrator(_migratorInit()); // 3
        router = new Router(ICurveFactory(address(factory))); // 4
        factory.setMigrator(address(migrator)); // 5
        factory.setRouter(address(router));
    }

    // ─────────────────────────────── canary smoke ──────────────────────────────

    /// @dev Create a canary launch through the real Router path (+ a tiny initial buy) and assert
    ///      (a) tokens were minted to the buyer and (b) the V3 pool was pre-initialized at the
    ///      deterministic graduation price for the correct token ordering (spec §6.3.2). Proves the
    ///      whole wired stack — factory CREATE2, token mint, pool pre-seed, curve buy — is live.
    function _canary() internal {
        uint256 creationFee = factory.creationFee();
        uint256 tinyBuy = 0.001 ether; // « maxEarlyBuyWei; anti-sniper stays satisfied
        // Deadline must be FUTURE-DATED, not `block.timestamp`: under `--broadcast` the calldata is
        // encoded during simulation (timestamp T0) then mined a few blocks later (T1 > T0), so a
        // `block.timestamp` deadline would trip `Router.checkDeadline` (DeadlineExpired) on-chain
        // while passing in simulation. A 1-hour horizon covers the sim→broadcast gap.
        uint256 deadline = block.timestamp + 1 hours;
        (address token, address curve, uint256 tokensOut) = router.createToken{value: creationFee + tinyBuy}(
            "ROBBED_ Canary", "CNRY", keccak256("robbed-canary-metadata"), "ipfs://robbed-canary", 0, deadline
        );
        canaryToken = token;
        canaryCurve = curve;
        if (tokensOut == 0) revert CanaryNoTokensOut();

        // Pool pre-initialized at the target graduation price (§6.3.2 pre-seed defence).
        address pool = IUniswapV3Factory(v3Factory).getPool(token, weth, FEE_TIER);
        (uint160 sqrtP,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (sqrtP == 0) revert CanaryPoolUninitialized(pool);
        uint160 expected = token < weth ? migrator.SQRT_PRICE_TOKEN0_X96() : migrator.SQRT_PRICE_TOKEN1_X96();
        if (sqrtP != expected) revert CanaryPriceMismatch(expected, sqrtP);

        (,, uint256 realEth,) = IBondingCurve(curve).reserves();
        console2.log("[deploy] canary token:", token);
        console2.log("[deploy] canary curve:", curve);
        console2.log("[deploy] canary tokensOut (wei):", tokensOut);
        console2.log("[deploy] canary curve realEth (wei):", realEth);
        console2.log("[deploy] canary pool initialized at target sqrtPriceX96:", uint256(sqrtP));
    }

    // ───────────────────────────── deploy artifact ─────────────────────────────

    /// @dev Flat, self-describing per-chain artifact → `deployments/<chainId>.json`. Flat (not
    ///      nested) so both the codegen and a human diff read cleanly; the codegen restructures it
    ///      into the `robbed{}` / `external{}` shape of the generated shared module.
    function _writeArtifact() internal {
        string memory k = "robbed-deploy";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeString(k, "mode", live ? "live" : "local");
        vm.serializeUint(k, "deployedAt", block.timestamp);
        vm.serializeAddress(k, "curveFactory", address(factory));
        vm.serializeAddress(k, "router", address(router));
        vm.serializeAddress(k, "v3Migrator", address(migrator));
        vm.serializeAddress(k, "lpFeeVault", address(vault));
        vm.serializeAddress(k, "treasury", treasury);
        vm.serializeAddress(k, "canaryToken", canaryToken);
        vm.serializeAddress(k, "canaryCurve", canaryCurve);
        vm.serializeAddress(k, "weth", weth);
        vm.serializeAddress(k, "v3Factory", v3Factory);
        vm.serializeAddress(k, "positionManager", npm);
        vm.serializeAddress(k, "swapRouter02", swapRouter02);
        string memory out = vm.serializeAddress(k, "quoterV2", quoterV2);

        string memory outPath = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.createDir("deployments", true); // mkdir -p: `vm.writeJson` will not create the dir itself
        vm.writeJson(out, outPath);
        console2.log("[deploy] wrote artifact ->", outPath);
    }

    /// @dev Blockscout verification is env-gated (M1-2 / Phase-T, O-5); print the exact command per
    ///      contracts.md §7.2 step 8 rather than run it here (verification needs a public repo +
    ///      settled bytecode). Documented, not executed.
    function _logVerifyHints() internal view {
        if (!live) return;
        console2.log("[deploy] verify (contracts.md section 7.2 step 8):");
        console2.log(
            "  forge verify-contract <addr> <Contract> --verifier blockscout"
            " --verifier-url https://robinhoodchain.blockscout.com/api --chain-id 4663"
        );
    }
}
