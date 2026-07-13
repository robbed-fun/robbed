// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ROBBED_ shared custom errors
/// @notice Free-standing declarations shared across all six contracts. Custom errors only — no
///         revert strings anywhere (contracts.md §2). Transcribed from the per-contract error
///         lists in contracts.md §2.2 (CurveFactory), §2.3 (BondingCurve), §2.4 (Router),
///         §2.5 (V3Migrator), §2.6 (LPFeeVault); deduplicated where the same name appears on
///         more than one contract (NotRouter, NotCurve, ZeroAddress, CreatesPaused,
///         EthTransferFailed).
/// @dev FROZEN by the tests-as-spec phase: M1 implementations import from this file unchanged.

// ─────────────────────────────── Access control ────────────────────────────────

/// @notice Caller is not the registered Router (contracts.md §2.2, §2.3).
error NotRouter();

/// @notice Caller is not a factory-registered BondingCurve (contracts.md §2.2, §2.5).
error NotCurve();

/// @notice Caller is not the CurveFactory (contracts.md §2.5).
error NotFactory();

/// @notice Swap-callback caller is not the in-flight migration's pool (contracts.md §2.5).
error NotPool();

/// @notice ERC721 sender is not the NonfungiblePositionManager (contracts.md §2.6).
error NotPositionManager();

// ─────────────────────────────── Factory (§2.2) ────────────────────────────────

/// @notice One-time setter (setRouter/setMigrator) called a second time (contracts.md §2.2).
error AlreadyInitialized();

/// @notice Zero address where a non-zero address is required (contracts.md §2.2, §2.4, §2.6).
error ZeroAddress();

/// @notice Token name length outside [1,32] bytes (contracts.md §2.2).
error InvalidName();

/// @notice Token symbol length outside [1,10] bytes (contracts.md §2.2).
error InvalidSymbol();

/// @notice metadataHash == bytes32(0) — the §8.3 integrity commitment is mandatory (contracts.md §2.2).
error ZeroMetadataHash();

/// @notice metadataUri length outside [1,256] bytes (contracts.md §2.2). Distinct from
///         {ZeroMetadataHash} — the URI is the event-only indexer pointer, the hash is the on-chain
///         integrity commitment; conflating their reverts was fixup F-4 (M1-7/M1-8 security gate).
error InvalidMetadataUri();

/// @notice Deploy-time misconfig: the worst-case owner-settable graduation-fee + caller-reward
///         ceilings would meet or exceed the net-of-fee graduation threshold, leaving graduation
///         permanently unfundable (no ETH left for the LP mint). Enforced in the constructor so a
///         misconfigured deploy fails fast rather than shipping a curve that can never graduate
///         (fixup F-3, M1-7/M1-8 security gate; guards spec §12.11 reachability).
error GraduationUnfundable();

/// @notice Launches are paused (`pauseCreates`, spec §6.5 granular pause) (contracts.md §2.2, §2.4).
error CreatesPaused();

/// @notice Admin setter above its code-enforced hard cap (spec §6.4 fee ceilings) (contracts.md §2.2).
error FeeAboveCap();

/// @notice Buy would push global curve ETH beyond `globalEthCap` (beta cap, spec §10 gate 7)
///         (contracts.md §2.2). Never raised on ETH-decreasing operations (sells/graduation).
error CapExceeded();

/// @notice An owner-set (or deploy-time) beta cap — `perTokenEthCap` or `globalEthCap` — is below
///         `GRADUATION_ETH`, which would make graduation permanently UNREACHABLE (a buy can never
///         push real reserves to the threshold once the cap binds below it). Enforced in the factory
///         constructor and `setCaps` so a misconfigured cap fails closed rather than silently
///         bricking every future curve's graduation (config-discipline finding; guards §12.11
///         reachability). The caps-lift target `type(uint128).max` trivially satisfies it.
error CapBelowGraduation();

/// @notice An owner-set anti-sniper `earlyWindowSeconds` exceeds `MAX_EARLY_WINDOW_SECONDS`. The
///         window is a short front-running-protection device (M0 = 8s); an unbounded value both
///         overshoots any sane anti-sniper horizon AND risks overflowing the `uint64`
///         `createdAt + earlyWindowSeconds` sum in the curve constructor (which would revert every
///         future `createToken`). Bounded in `setAntiSniper` so the setter cannot brick launches
///         (config-discipline finding; guards spec §12.18).
error EarlyWindowTooLong();

/// @notice A launch with a non-zero `creatorFeeBps` was attempted while the CreatorVault is unwired
///         (spec §7, §12.63). Fail-closed so creator-fee ETH can never accrue with nowhere to sweep
///         it (a call to the zero-address vault would burn it). At `creatorFeeBps == 0` the vault is
///         not required and this never fires — backward-compatible with the treasury-only v1.
error CreatorVaultUnset();

// ─────────────────────────────── BondingCurve (§2.3) ───────────────────────────

/// @notice Curve phase != Trading (buy/sell after lock or graduation) (contracts.md §2.3).
error NotTrading();

/// @notice graduate() called while phase != ReadyToGraduate (contracts.md §2.3).
error NotReady();

/// @notice Zero-amount trade (contracts.md §2.3).
error ZeroAmount();

/// @notice Output below the caller-supplied minimum (spec §6.5 slippage floor) (contracts.md §2.3).
/// @param actual Actual output computed by curve math.
/// @param min    Caller's floor (minTokensOut / minEthOut).
error SlippageExceeded(uint256 actual, uint256 min);

/// @notice Gross buy above `MAX_EARLY_BUY` inside the anti-sniper timestamp window
///         (spec §6.5, mechanism ratified §12.18) (contracts.md §2.3).
/// @param sent Gross ETH sent.
/// @param cap  MAX_EARLY_BUY.
error EarlyBuyCapExceeded(uint256 sent, uint256 cap);

/// @notice Buy would push realEthReserves beyond `perTokenEthCap` (beta cap, spec §10 gate 7)
///         (contracts.md §2.3).
error PerTokenCapExceeded();

/// @notice Low-level ETH `call` failed (contracts.md §2.3, §2.5).
error EthTransferFailed();

// ─────────────────────────────── Router (§2.4) ─────────────────────────────────

/// @notice Transaction deadline passed (spec §6.5 deadline on all trade paths) (contracts.md §2.4).
error DeadlineExpired();

/// @notice Token has no registered curve in the factory (contracts.md §2.4).
error UnknownToken();

/// @notice msg.value inconsistent with creationFee/initialBuy expectations (contracts.md §2.4:
///         if initialBuy == 0, minTokensOut MUST be 0).
error InvalidMsgValue();

/// @notice Curve buys are paused (`pauseBuys`, spec §6.5) — sells have NO such error by
///         construction (contracts.md §2.4, §5.3).
error BuysPaused();

// ─────────────────────────────── V3Migrator (§2.5) ─────────────────────────────

/// @notice Arb-back loop ended outside `targetTick ± TOLERANCE_TICKS`; migration reverts rather
///         than mint into a hostile ratio (spec §6.3.2) (contracts.md §2.5).
/// @param finalTick  Pool tick after the bounded arb-back loop.
/// @param targetTick Deterministic graduation-price tick for this token ordering.
error PoolPriceUnrecoverable(int24 finalTick, int24 targetTick);

/// @notice Arb-back would consume inventory needed by the target-price mint (budget rule,
///         spec §13 O-8 note) (contracts.md §2.5).
error ArbBudgetExceeded();

/// @notice NPM.mint produced less liquidity than the amount-min-enforced expectation
///         (contracts.md §2.5).
error InsufficientLiquidityMinted();
