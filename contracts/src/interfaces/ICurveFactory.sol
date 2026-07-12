// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ICurveFactory — token+curve deployer, global config, hard caps, beta TVL caps
///        (spec §6, §6.4, §6.6, §10 gate 7; contracts.md §2.2)
/// @notice The only contract with an owner (Ownable2Step; owner = Gnosis Safe treasury). The owner
///         can never touch live-curve economics, token supply, or the LPFeeVault (spec §6.6).
///         Pause flags are granular: `pauseCreates`, `pauseBuys` — **no sell-side pause flag exists**
///         (spec §6.5).
/// @dev FROZEN interface (tests-as-spec phase); one ratified ADDITIVE extension since freeze:
///      `CurveDefaults` + `curveDefaults()` (spec §12.38/§12.39 seam; LAUNCH-2), a pure view that
///      changes no existing signature. Config mutability model (contracts.md §2.2):
///      curve economics are snapshotted into each curve at creation (owner changes affect future
///      launches only); `treasury`, `pauseBuys` and the beta caps are read live (operational,
///      never block sells, never alter economics).
interface ICurveFactory {
    // ────────────────────────────────── Types ──────────────────────────────────

    /// @notice Staged deployment parameters read by BondingCurve's constructor via
    ///         `ICurveFactory(msg.sender).curveParameters()` — the CREATE2 init-code hash stays
    ///         constant because the curve takes no constructor args (contracts.md §2.2 pattern
    ///         step 1/3). Written then deleted within `createToken` (plain storage staging).
    struct CurveParameters {
        address token; // LaunchToken deployed one step earlier
        address router; // trade-path gate (onlyRouter)
        address migrator; // graduation executor
        uint256 virtualEth0; // initial virtual ETH reserves (M0 constants.json curve.virtualEthWei)
        uint256 virtualToken0; // initial virtual token reserves (curve.virtualTokenWei)
        uint256 curveSupply; // tokens sellable on the curve, ≈793.1M e18 (curve.curveSupplyWei)
        uint256 lpTranche; // LP tranche, ≈206.9M e18 (curve.lpTrancheWei)
        uint256 graduationEth; // net-of-fee real-reserve threshold (spec §12.11)
        uint16 tradeFeeBps; // snapshot, ≤ MAX_TRADE_FEE_BPS (spec §6.4)
        uint16 creatorFeeBps; // ALWAYS 0 in v1 — designed-in, disabled, no fee-path read (spec §7)
        uint256 graduationFee; // flat, → treasury first at migration (spec §6.3 step 1)
        uint256 callerReward; // permissionless graduate() incentive (spec §6.2)
        uint64 earlyWindowSeconds; // anti-sniper timestamp window (spec §12.18)
        uint128 maxEarlyBuyWei; // per-tx gross ETH cap inside the window (spec §6.5)
    }

    /// @notice Immutable factory-level curve-shape defaults — the five M0 `constants.json`
    ///         economics snapshotted into every FUTURE curve at creation (spec §12.38/§12.39
    ///         seam; contracts.md §2.2). Returned by {curveDefaults} so pre-create consumers
    ///         (the Create-page starting-price / graduation / initial-buy preview — LAUNCH-2;
    ///         the indexer startup cache) can read the shape BEFORE any curve exists.
    /// @dev Distinct from (a) {CurveParameters} — the deploy-transient staging struct, all-zero
    ///      outside `createToken` — and (b) the per-curve public immutables (§12.40d), which only
    ///      exist after a curve deploys. All five fields are `immutable` on the factory: a new
    ///      curve shape = a new factory version (spec §6), so this view can never change.
    struct CurveDefaults {
        uint256 virtualEth0; // initial virtual ETH reserves (curve.virtualEthWei)
        uint256 virtualToken0; // initial virtual token reserves (curve.virtualTokenWei)
        uint256 curveSupply; // tokens sellable on the curve, ≈793.1M e18
        uint256 lpTranche; // LP tranche minted at graduation, ≈206.9M e18
        uint256 graduationEth; // net-of-fee real-reserve graduation threshold (spec §12.11)
    }

    /// @notice Live config snapshot for Router/UI (contracts.md §2.2 `config()`).
    /// @dev Field set derived from the §2.2 storage table (owner-settable values + pause flags +
    ///      beta caps); exact struct shape was not itemized in contracts.md — flagged in the
    ///      tests-as-spec report for architect ratification.
    struct FactoryConfig {
        address treasury; // Gnosis Safe, fee destination (read live)
        uint16 tradeFeeBps; // default for future curves, ≤200
        uint16 creatorFeeBps; // always 0 (spec §7)
        uint256 creationFee; // flat, → treasury (spec §6.4)
        uint256 graduationFee; // default for future curves
        uint256 callerReward; // default for future curves
        uint64 earlyWindowSeconds; // default for future curves
        uint128 maxEarlyBuyWei; // default for future curves
        bool pauseCreates; // blocks Router.createToken only
        bool pauseBuys; // blocks Router.buy + atomic initial buy only — NEVER sells
        uint128 perTokenEthCap; // beta cap, buy-side only (spec §10 gate 7)
        uint128 globalEthCap; // beta cap, buy-side only
    }

    // ────────────────────────────────── Events ─────────────────────────────────

    /// @notice Canonical creation event — cross-service contract shape ratified in spec §12.15.
    ///         Carries `metadataUri` (event-only, not stored on-chain; integrity commitment is
    ///         `metadataHash`, spec §8.3) and the pre-initialized V3 `pool` (spec §6.3.2).
    ///         The creator's initial buy is NOT in this event — derived from the first `Trade`
    ///         in the same tx (spec §12.15).
    event TokenCreated(
        address indexed token,
        address indexed curve,
        address indexed creator,
        string name,
        string symbol,
        bytes32 metadataHash,
        string metadataUri,
        address pool
    );

    /// @notice Admin setter events — every owner setter emits (contracts.md §2.2).
    event TreasuryUpdated(address indexed newTreasury);
    event TradeFeeUpdated(uint16 newBps);
    event CreationFeeUpdated(uint256 newFee);
    event GraduationFeeUpdated(uint256 newFee);
    event CallerRewardUpdated(uint256 newReward);
    event AntiSniperUpdated(uint64 windowSeconds, uint128 maxEarlyBuyWei);
    event CapsUpdated(uint128 perTokenEthCap, uint128 globalEthCap);
    event PauseCreatesSet(bool paused);
    event PauseBuysSet(bool paused);
    event RouterSet(address router);
    event MigratorSet(address migrator);

    // ─────────────────────────────── Router-only ───────────────────────────────

    /// @notice Deploys a LaunchToken + BondingCurve pair (CREATE2, staged parameters) and
    ///         pre-initializes its V3 1% pool at the deterministic graduation price
    ///         (spec §6.3.2). Only callable by the Router (which collects the creation fee and
    ///         runs guards). Emits `TokenCreated`.
    /// @dev Validates: bytes(name).length in [1,32], bytes(symbol).length in [1,10],
    ///      metadataHash != bytes32(0), bytes(metadataUri).length in [1,256], !pauseCreates
    ///      (contracts.md §2.2).
    function createToken(
        address creator,
        string calldata name,
        string calldata symbol,
        bytes32 metadataHash,
        string calldata metadataUri
    ) external returns (address token, address curve, address pool);

    // ─────────────────────────────── Curve-only ────────────────────────────────

    /// @notice Curve callback: registers net curve-ETH delta for the global beta TVL cap.
    /// @dev onlyCurve. On buys: reverts CapExceeded if `globalCurveEth` would exceed
    ///      `globalEthCap`. On sells/graduation the delta is negative and NEVER reverts — sells
    ///      must always succeed; unchecked-floor-at-zero semantics, no underflow revert
    ///      (contracts.md §2.2, §5.3 proof-by-construction obligation b).
    function recordEthDelta(int256 delta) external;

    // ────────────────────────────────── Views ──────────────────────────────────

    /// @notice DEPLOY-TRANSIENT staging read — meaningful ONLY mid-`createToken`, consumed by
    ///         the BondingCurve constructor via `ICurveFactory(msg.sender).curveParameters()`
    ///         (constant-init-code CREATE2 staging pattern, contracts.md §2.2).
    /// @dev At ANY other time this returns the ALL-ZERO struct: the staging slot is written and
    ///      `delete`d inside `createToken`. Off-chain consumers MUST NOT read curve shape from
    ///      here (LAUNCH-2 root cause) — use {curveDefaults} for the factory-level defaults, or
    ///      the per-curve public immutables once a curve exists (§12.40d). Behavior is
    ///      intentionally unchanged: the curve constructor depends on these exact semantics.
    function curveParameters() external view returns (CurveParameters memory);

    /// @notice Factory-level immutable curve-shape defaults (see {CurveDefaults}). Safe to read
    ///         at any time, including before the first curve exists — this is the canonical
    ///         pre-create economics read for the Create-page preview (LAUNCH-2) and the indexer
    ///         startup cache (spec §12.38/§12.39).
    function curveDefaults() external view returns (CurveDefaults memory);

    /// @notice token → curve registry (append-only).
    function curveOf(address token) external view returns (address);

    /// @notice curve → token registry (append-only).
    function tokenOf(address curve) external view returns (address);

    /// @notice True iff `account` is a factory-deployed curve (migrator gate, contracts.md §2.5).
    function isCurve(address account) external view returns (bool);

    /// @notice Current config snapshot for Router/UI (contracts.md §2.2).
    function config() external view returns (FactoryConfig memory);

    /// @notice Sum of net curve ETH across all live curves (beta global cap accounting).
    function globalCurveEth() external view returns (uint256);

    /// @notice Trade-fee hard cap, 200 bps = 2% (spec §6.4; constant, contracts.md §2.2).
    function MAX_TRADE_FEE_BPS() external view returns (uint16);

    /// @notice One-time-set Router address (contracts.md §2.2 storage).
    function router() external view returns (address);

    /// @notice One-time-set V3Migrator address.
    function migrator() external view returns (address);

    /// @notice Canonical WETH (immutable; asserted == 0x0Bd7…AD73 in the deploy script).
    function weth() external view returns (address);

    /// @notice Fee destination — Gnosis Safe (spec §6.6). Read live by curves.
    function treasury() external view returns (address);

    /// @notice Flat creation fee, collected by the Router (contracts.md §2.4).
    function creationFee() external view returns (uint256);

    /// @notice Launch pause flag (spec §6.5). Blocks creates only.
    function pauseCreates() external view returns (bool);

    /// @notice Buy pause flag (spec §6.5). Blocks buys only — never sells, graduate, or collect.
    function pauseBuys() external view returns (bool);

    /// @notice Per-token beta ETH cap (spec §10 gate 7), buy-side only.
    function perTokenEthCap() external view returns (uint128);

    /// @notice Global beta ETH cap (spec §10 gate 7), buy-side only.
    function globalEthCap() external view returns (uint128);

    // ─────────────── Owner (Safe) — hard-capped in code (contracts.md §2.2) ───────────────

    function setPauseCreates(bool paused) external;
    function setPauseBuys(bool paused) external;
    /// @dev newTreasury != address(0).
    function setTreasury(address newTreasury) external;
    /// @dev ≤ MAX_TRADE_FEE_BPS (200); applies to FUTURE curves only.
    function setTradeFeeBps(uint16 newBps) external;
    /// @dev ≤ maxCreationFee (immutable ceiling).
    function setCreationFee(uint256 newFee) external;
    /// @dev ≤ maxGraduationFee (immutable ceiling); future curves only.
    function setGraduationFee(uint256 newFee) external;
    /// @dev ≤ maxCallerReward (immutable ceiling); future curves only.
    function setCallerReward(uint256 newReward) external;
    /// @dev Future curves only (anti-sniper defaults, spec §12.18).
    function setAntiSniper(uint64 windowSeconds, uint128 maxEarlyBuyWei) external;
    /// @dev Beta caps; lift = set to type(uint128).max (spec §11 M5).
    function setCaps(uint128 perTokenEthCap_, uint128 globalEthCap_) external;
    /// @dev ONE-TIME: reverts AlreadyInitialized if already set.
    function setRouter(address router_) external;
    /// @dev ONE-TIME: reverts AlreadyInitialized if already set.
    function setMigrator(address migrator_) external;
}
