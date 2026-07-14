// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title ROBBED_ shared custom errors
/// @notice Free-standing declarations shared across all six contracts. Custom errors only — no
/// revert strings anywhere (contracts.md). Transcribed from the per-contract error
/// lists in contracts.md (CurveFactory), (BondingCurve), (Router),
/// (V3Migrator), (LPFeeVault); deduplicated where the same name appears on
///         more than one contract (NotRouter, NotCurve, ZeroAddress, CreatesPaused,
///         EthTransferFailed).
/// @dev FROZEN by the tests-as-spec phase: M1 implementations import from this file unchanged.

// ─────────────────────────────── Access control ────────────────────────────────

/// @notice Caller is not the registered Router (contracts.md).
error NotRouter();

/// @notice Caller is not a factory-registered BondingCurve (contracts.md).
error NotCurve();

/// @notice Caller is not the CurveFactory (contracts.md).
error NotFactory();

/// @notice Swap-callback caller is not the in-flight migration's pool (contracts.md).
error NotPool();

/// @notice ERC721 sender is not the NonfungiblePositionManager (contracts.md).
error NotPositionManager();

/// @notice `LPFeeVault.registerCreator` caller is not the factory's registered V3Migrator (spec
/// ). The post-graduation `tokenId → creator` binding may ONLY be written by the
///         migrator (which mints the LP position and authoritatively knows the graduating curve's
///         creator), so a non-migrator caller cannot spoof a creator for a position.
error NotMigrator();

/// @notice `LPFeeVault.registerCreator` called twice for the same `tokenId` (,
///         set-once). The creator binding is captured exactly once at graduation and can never be
///         overwritten — a graduated position's post-grad fee beneficiary is immutable.
error CreatorAlreadyRegistered();

/// @notice `CreatorVault.depositERC20` caller is not the factory's registered LPFeeVault (spec
/// ). The per-(creator, token) ERC20 custody is credited ONLY by the trusted
///         fee-source vault, mirroring the ETH-leg `deposit` curve-gate so the vault's per-token
///         balance equals the sum of collect-routed creator shares to the wei (no donation pollution).
error NotLpFeeVault();

// ─────────────────────────────── Factory ────────────────────────────────

/// @notice One-time setter (setRouter/setMigrator) called a second time (contracts.md).
error AlreadyInitialized();

/// @notice Zero address where a non-zero address is required (contracts.md).
error ZeroAddress();

/// @notice Token name length outside [1,32] bytes (contracts.md).
error InvalidName();

/// @notice Token symbol length outside [1,10] bytes (contracts.md).
error InvalidSymbol();

/// @notice metadataHash == bytes32(0) — the integrity commitment is mandatory (contracts.md).
error ZeroMetadataHash();

/// @notice metadataUri length outside [1,256] bytes (contracts.md). Distinct from
///         {ZeroMetadataHash} — the URI is the event-only indexer pointer, the hash is the on-chain
///         integrity commitment; conflating their reverts was fixup F-4 (M1-7/M1-8 security gate).
error InvalidMetadataUri();

/// @notice Deploy-time misconfig: the worst-case owner-settable graduation-fee + caller-reward
///         ceilings would meet or exceed the net-of-fee graduation threshold, leaving graduation
///         permanently unfundable (no ETH left for the LP mint). Enforced in the constructor so a
///         misconfigured deploy fails fast rather than shipping a curve that can never graduate
/// (fixup F-3, M1-7/M1-8 security gate; guards reachability).
error GraduationUnfundable();

/// @notice Launches are paused (`pauseCreates`, granular pause) (contracts.md).
error CreatesPaused();

/// @notice Admin setter above its code-enforced hard cap (fee ceilings) (contracts.md).
error FeeAboveCap();

/// @notice Buy would push global curve ETH beyond `globalEthCap` (beta cap, gate 7)
/// (contracts.md). Never raised on ETH-decreasing operations (sells/graduation).
error CapExceeded();

/// @notice An owner-set (or deploy-time) beta cap — `perTokenEthCap` or `globalEthCap` — is below
///         `GRADUATION_ETH`, which would make graduation permanently UNREACHABLE (a buy can never
///         push real reserves to the threshold once the cap binds below it). Enforced in the factory
///         constructor and `setCaps` so a misconfigured cap fails closed rather than silently
/// bricking every future curve's graduation (config-discipline finding; guards
///         reachability). The caps-lift target `type(uint128).max` trivially satisfies it.
error CapBelowGraduation();

/// @notice An owner-set anti-sniper `earlyWindowSeconds` exceeds `MAX_EARLY_WINDOW_SECONDS`. The
///         window is a short front-running-protection device (M0 = 8s); an unbounded value both
///         overshoots any sane anti-sniper horizon AND risks overflowing the `uint64`
///         `createdAt + earlyWindowSeconds` sum in the curve constructor (which would revert every
///         future `createToken`). Bounded in `setAntiSniper` so the setter cannot brick launches
/// (config-discipline finding; guards).
error EarlyWindowTooLong();

/// @notice A launch with a non-zero `creatorFeeBps` was attempted while the CreatorVault is unwired
///. Fail-closed so creator-fee ETH can never accrue with nowhere to sweep
///         it (a call to the zero-address vault would burn it). At `creatorFeeBps == 0` the vault is
///         not required and this never fires — backward-compatible with the treasury-only v1.
error CreatorVaultUnset();

// ─────────────────────────────── BondingCurve ───────────────────────────

/// @notice Curve phase != Trading (buy/sell after lock or graduation) (contracts.md).
error NotTrading();

/// @notice graduate() called while phase != ReadyToGraduate (contracts.md).
error NotReady();

/// @notice Zero-amount trade (contracts.md).
error ZeroAmount();

/// @notice Output below the caller-supplied minimum (slippage floor) (contracts.md).
/// @param actual Actual output computed by curve math.
/// @param min    Caller's floor (minTokensOut / minEthOut).
error SlippageExceeded(uint256 actual, uint256 min);

/// @notice Gross buy above `MAX_EARLY_BUY` inside the anti-sniper timestamp window
/// (mechanism ratified) (contracts.md).
/// @param sent Gross ETH sent.
/// @param cap  MAX_EARLY_BUY.
error EarlyBuyCapExceeded(uint256 sent, uint256 cap);

/// @notice Buy would push realEthReserves beyond `perTokenEthCap` (beta cap, gate 7)
/// (contracts.md).
error PerTokenCapExceeded();

/// @notice Low-level ETH `call` failed (contracts.md).
error EthTransferFailed();

// ─────────────────────────────── Router ─────────────────────────────────

/// @notice Transaction deadline passed (deadline on all trade paths) (contracts.md).
error DeadlineExpired();

/// @notice Token has no registered curve in the factory (contracts.md).
error UnknownToken();

/// @notice msg.value inconsistent with creationFee/initialBuy expectations (contracts.md :
///         if initialBuy == 0, minTokensOut MUST be 0).
error InvalidMsgValue();

/// @notice Curve buys are paused (`pauseBuys`) — sells have NO such error by
/// construction (contracts.md).
error BuysPaused();

// ─────────────────────────────── V3Migrator ─────────────────────────────

/// @notice Arb-back loop ended outside `targetTick ± TOLERANCE_TICKS`; migration reverts rather
/// than mint into a hostile ratio (contracts.md).
/// @param finalTick  Pool tick after the bounded arb-back loop.
/// @param targetTick Deterministic graduation-price tick for this token ordering.
error PoolPriceUnrecoverable(int24 finalTick, int24 targetTick);

/// @notice Arb-back would consume inventory needed by the target-price mint (budget rule,
/// O-8 note) (contracts.md).
error ArbBudgetExceeded();

/// @notice NPM.mint produced less liquidity than the amount-min-enforced expectation
/// (contracts.md).
error InsufficientLiquidityMinted();
