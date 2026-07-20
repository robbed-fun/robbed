// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

import {ICurveFactory} from "./interfaces/ICurveFactory.sol";
import {IV3Migrator} from "./interfaces/IV3Migrator.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {BondingCurve} from "./BondingCurve.sol";

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
    CapExceeded,
    CapBelowGraduation,
    EarlyWindowTooLong,
    CreatorVaultUnset
} from "./errors/Errors.sol";

/// @title CurveFactory — token+curve deployer, global config, hard caps, beta TVL caps
/// (gate 7; contracts.md)
/// @notice The one contract in the system with an owner (`Ownable2Step`, owner = Gnosis Safe). The
///         owner can never touch a live curve's economics, token supply, or the LPFeeVault
///. Pause flags are granular — `pauseCreates`, `pauseBuys`. **There is no
/// sell-side pause flag of any kind**; this is proven by construction below
///         (search the whole contract: the only pause storage is those two booleans, neither is
///         read on any sell path — the sell path lives entirely in {BondingCurve}.sell, which reads
///         no factory pause state).
///
/// @dev Design decisions recorded for the hoodpad-security gate:
///
///      1. **CREATE2 with a constant init-code hash (staged-parameters pattern).** The token
///         constructor mints the full supply to the curve, so the token needs the curve address;
///         the curve needs the token address. Resolved Uniswap-V2-`pairFor`-style: the curve takes
///         NO constructor args and reads its parameters back from the factory via
///         `ICurveFactory(msg.sender).curveParameters()` in its own constructor. Because the curve
///         init code is therefore constant, `keccak256(type(BondingCurve).creationCode)` is a fixed
///         hash and the curve address is deterministically precomputable — so the token can be
///         deployed (minting to that precomputed address) BEFORE the curve exists. Chosen over
/// (a) a two-transaction create-then-set-token (breaks the atomic one-tx launch) and
///         (b) constructor-arg CREATE2 (init-code hash then varies per launch, defeating the
/// precompute). This is the exact Gnad.fun/Uniswap pattern (contracts.md step 1/3).
///         Squatting (UM-9): only THIS factory can CREATE2 at the target address (the deployer
///         address is baked into the CREATE2 preimage), and `tokenCounter` is a global monotonic
///         salt input, so no external party can occupy a specific creator's next curve address and
/// no two launches ever collide. Accepted + documented per threat-model.
///
///      2. **Plain storage staging, not transient storage.** `_stagedParams` is written then
///         `delete`d within `createToken`. EIP-1153 transient storage would save the refund-adjusted
///         SSTOREs, but gas is irrelevant at create time and this avoids any ArbOS/Cancun
///         availability assumption (foundry.toml keeps `evm_version` conservative — contracts.md
/// step 3).
///
///      3. **Config split: economics snapshotted immutable per curve; treasury/pauses/beta-caps
///         read live.** Curve shape (`virtualEth0`, `graduationEth`, `tradeFeeBps`, …) is copied
///         into the curve's immutables at creation, so an owner retune only affects FUTURE launches
/// ("existing curves immutable"). Operational values that must never alter a
///         live curve's economics — `treasury` (fee destination), `pauseBuys`, and the beta caps —
///         are read live by the curve at call time. Critically none of the live values can block a
/// sell : `pauseBuys` is buy-only, the caps are enforced only on ETH-INCREASING
///         deltas (`recordEthDelta` never reverts on a negative delta), and `treasury` is never on
/// a trade path at all under the pull-payment model.
contract CurveFactory is ICurveFactory, Ownable2Step {
    // ─────────────────────────────── Immutables ────────────────────────────────

    /// @inheritdoc ICurveFactory
    uint16 public constant override MAX_TRADE_FEE_BPS = 200; // 2% hard cap

    /// @notice Upper bound on the anti-sniper `earlyWindowSeconds` an owner may set (config-discipline
    ///         finding). The early-buy window is a short front-running device (M0 = 8s); 7 days is an
    ///         astronomically generous ceiling for it (≈75_600× the calibrated value) yet keeps the
    ///         `uint64` `createdAt + earlyWindowSeconds` sum in {BondingCurve}'s constructor from ever
    ///         overflowing (block.timestamp ~1.7e9 + 6.05e5 ≪ 1.8e19), so the setter can never brick
    ///         `createToken`. Any window beyond this is a distinct product mechanism, not anti-sniper.
    uint64 public constant MAX_EARLY_WINDOW_SECONDS = 7 days;

    /// @inheritdoc ICurveFactory
    address public immutable override weth;

    // Curve economics — immutable curve shape from M0 `constants.json`; a new shape = new factory
    // version. Snapshotted into every curve at creation.
    uint256 internal immutable _virtualEth0;
    uint256 internal immutable _virtualToken0;
    uint256 internal immutable _curveSupply;
    uint256 internal immutable _lpTranche;
    uint256 internal immutable _graduationEth;

    // Owner-setter ceilings — immutable, deploy-time (fee ceilings).
    uint256 public immutable maxCreationFee;
    uint256 public immutable maxGraduationFee;
    uint256 public immutable maxCallerReward;

    // ──────────────────────────────── Storage ──────────────────────────────────

    /// @inheritdoc ICurveFactory
    address public override router; // one-time-set
    /// @inheritdoc ICurveFactory
    address public override migrator; // one-time-set

    /// @inheritdoc ICurveFactory
    address public override treasury; // Gnosis Safe, owner-settable, read live by curves
    /// @inheritdoc ICurveFactory
    address public override creatorVault; // pull-payment CreatorVault, one-time-set
    /// @inheritdoc ICurveFactory
    address public override lpFeeVault; // registered LPFeeVault ERC20 fee source, one-time-set
    /// @dev Default TREASURY-leg trade fee for FUTURE curves. Snapshotted per curve.
    /// `tradeFeeBps + creatorFeeBps ≤ MAX_TRADE_FEE_BPS` (the ≤2% cap) — enforced here.
    uint16 public tradeFeeBps;
    /// @dev Default CREATOR-leg fee for FUTURE curves. 0 default; configurable,
    ///      ADDITIVE under the shared ≤2% cap. Snapshotted per curve; existing curves keep their rate.
    uint16 public creatorFeeBps;
    /// @inheritdoc ICurveFactory
    uint256 public override creationFee; // collected by the Router (contracts.md)
    uint256 public graduationFee; // default for future curves
    uint256 public callerReward; // default for future curves
    uint64 public earlyWindowSeconds; // anti-sniper default
    uint128 public maxEarlyBuyWei; // anti-sniper default

    /// @inheritdoc ICurveFactory
    bool public override pauseCreates; // blocks creates only
    /// @inheritdoc ICurveFactory
    bool public override pauseBuys; // blocks buys only — NEVER sells

    /// @inheritdoc ICurveFactory
    uint128 public override perTokenEthCap; // beta cap, buy-side only (gate 7)
    /// @inheritdoc ICurveFactory
    uint128 public override globalEthCap; // beta cap, buy-side only

    /// @inheritdoc ICurveFactory
    uint256 public override globalCurveEth; // Σ realEthReserves across live curves

    /// @inheritdoc ICurveFactory
    mapping(address token => address curve) public override curveOf;
    /// @inheritdoc ICurveFactory
    mapping(address curve => address token) public override tokenOf;
    /// @inheritdoc ICurveFactory
    mapping(address account => bool) public override isCurve;

    /// @dev Global monotonic salt input; also guarantees curve-address uniqueness (UM-9).
    uint256 public tokenCounter;

    /// @dev Written then `delete`d within `createToken`; read by the curve constructor callback.
    CurveParameters internal _stagedParams;

    // ─────────────────────────── Construction config ───────────────────────────

    /// @notice Deploy-time configuration. All market-dependent values originate from
    /// `tools/m0/out/constants.json` via the deploy script — never inlined.
    struct FactoryInit {
        address weth; // canonical WETH (deploy script asserts == 0x0Bd7…AD73)
        address treasury; // Gnosis Safe
        address initialOwner; // deployer initially; transferred to the Safe (Ownable2Step)
        // curve economics (immutable shape)
        uint256 virtualEth0;
        uint256 virtualToken0;
        uint256 curveSupply;
        uint256 lpTranche;
        uint256 graduationEth;
        // fee config + ceilings
        uint16 tradeFeeBps; // treasury leg
        uint16 creatorFeeBps; // creator leg; tradeFeeBps + creatorFeeBps ≤ 200
        uint256 creationFee;
        uint256 maxCreationFee;
        uint256 graduationFee;
        uint256 maxGraduationFee;
        uint256 callerReward;
        uint256 maxCallerReward;
        // anti-sniper
        uint64 earlyWindowSeconds;
        uint128 maxEarlyBuyWei;
        // beta caps
        uint128 perTokenEthCap;
        uint128 globalEthCap;
    }

    /// @param p Deploy config (see {FactoryInit}).
    /// @dev Validates structurally: non-zero WETH/treasury; `curveSupply + lpTranche` sums to the
    /// fixed 1e27 total supply (venue-continuity guarantee, contracts.md); every fee within
    ///      its immutable ceiling; `tradeFeeBps ≤ MAX_TRADE_FEE_BPS`; non-zero virtual reserves and
    ///      graduation threshold. `router`/`migrator` are wired post-deploy via the one-time setters
    /// (deploy order) — `createToken` reverts until both are set.
    constructor(FactoryInit memory p) Ownable(p.initialOwner) {
        if (p.weth == address(0) || p.treasury == address(0)) revert ZeroAddress();
        if (p.virtualEth0 == 0 || p.virtualToken0 == 0 || p.graduationEth == 0) revert ZeroAddress();
        // Supply split must reconstruct the fixed total (contracts.md). The total is a
        // structural constant (mirrored by LaunchToken.TOTAL_SUPPLY) — safe to hardcode.
        if (p.curveSupply + p.lpTranche != 1_000_000_000e18) revert ZeroAddress();
        // ADDITIVE ≤2% cap: the treasury + creator legs together may never exceed
        // MAX_TRADE_FEE_BPS (200). Constructor-asserted on this factory generation; re-asserted in
        // setTradeFeeBps / setCreatorFeeBps. `uint16 + uint16` cannot overflow the widened arithmetic.
        if (uint256(p.tradeFeeBps) + p.creatorFeeBps > MAX_TRADE_FEE_BPS) revert FeeAboveCap();
        if (
            p.creationFee > p.maxCreationFee || p.graduationFee > p.maxGraduationFee
                || p.callerReward > p.maxCallerReward
        ) revert FeeAboveCap();
        // F-3 (M1-7/M1-8 gate): even at the worst-case owner-set values, graduation must stay
        // fundable. At graduation the curve pays CALLER_REWARD to the caller and the migrator
        // deducts GRADUATION_FEE first (contracts.md); both are drawn from the raised
        // GRADUATION_ETH. If the ceilings summed to >= graduationEth, an owner could tune future
        // curves into a permanently ungraduatable state (no ETH left for the LP mint). Checking the
        // immutable CEILINGS (not the current values) makes the guarantee hold for every admissible
        // future setting. Strict `<` leaves headroom for the LP tranche's WETH leg.
        if (p.maxCallerReward + p.maxGraduationFee >= p.graduationEth) revert GraduationUnfundable();
        // Beta caps must never be set below the graduation threshold, or a curve could never raise
        // enough to graduate (the cap binds before real reserves reach GRADUATION_ETH). Fail a bad
        // deploy closed here; `setCaps` re-checks for owner retunes. `p.graduationEth != 0` was
        // asserted above, so a zero cap also trips this (config-discipline finding, guards).
        _requireCapsReachGraduation(p.perTokenEthCap, p.globalEthCap, p.graduationEth);

        weth = p.weth;
        _virtualEth0 = p.virtualEth0;
        _virtualToken0 = p.virtualToken0;
        _curveSupply = p.curveSupply;
        _lpTranche = p.lpTranche;
        _graduationEth = p.graduationEth;

        maxCreationFee = p.maxCreationFee;
        maxGraduationFee = p.maxGraduationFee;
        maxCallerReward = p.maxCallerReward;

        treasury = p.treasury;
        tradeFeeBps = p.tradeFeeBps;
        creatorFeeBps = p.creatorFeeBps;
        creationFee = p.creationFee;
        graduationFee = p.graduationFee;
        callerReward = p.callerReward;
        earlyWindowSeconds = p.earlyWindowSeconds;
        maxEarlyBuyWei = p.maxEarlyBuyWei;
        perTokenEthCap = p.perTokenEthCap;
        globalEthCap = p.globalEthCap;
    }

    // ──────────────────────────────── Modifiers ────────────────────────────────

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    modifier onlyCurve() {
        if (!isCurve[msg.sender]) revert NotCurve();
        _;
    }

    // ─────────────────────────────── Router-only ───────────────────────────────

    /// @inheritdoc ICurveFactory
    function createToken(
        address creator,
        string calldata name,
        string calldata symbol,
        bytes32 metadataHash,
        string calldata metadataUri
    ) external override onlyRouter returns (address token, address curve, address pool) {
        _validateCreate(name, symbol, metadataHash, metadataUri);

        // 1. Precompute the curve address (constant init-code hash — decision #1). The global,
        //    monotonic tokenCounter makes the salt (hence the address) unique per launch (UM-9).
        bytes32 salt = keccak256(abi.encode(creator, tokenCounter));

        // 2. Deploy the token (plain CREATE); the full supply mints to the not-yet-deployed curve.
        token = address(new LaunchToken(name, symbol, metadataHash, metadataUri, _computeCurveAddress(salt)));

        // 3. Stage the immutable curve parameters, CREATE2 the curve (reads them back), unstage.
        curve = _deployCurve(salt, token, creator);

        // 4. Pre-initialize the V3 pool at the deterministic graduation price.
        pool = IV3Migrator(migrator).initializePool(token);

        // 5. Register (append-only) and bump the salt counter.
        curveOf[token] = curve;
        tokenOf[curve] = token;
        isCurve[curve] = true;
        unchecked {
            ++tokenCounter;
        }

        // 6. Canonical cross-service creation event.
        emit TokenCreated(token, curve, creator, name, symbol, metadataHash, metadataUri, pool);
    }

    /// @dev Create-time input validation — the SOLE on-chain enforcement of these bounds
    /// (contracts.md), including F4: the non-zero `metadataHash` integrity commitment.
    function _validateCreate(
        string calldata name,
        string calldata symbol,
        bytes32 metadataHash,
        string calldata metadataUri
    ) internal view {
        if (pauseCreates) revert CreatesPaused();
        if (migrator == address(0)) revert ZeroAddress(); // deploy-order guard (contracts.md)
        // fail-closed: a launch that would accrue creator fees needs a wired CreatorVault to
        // sweep them to (else the sweep would push to the zero address and burn them). At
        // creatorFeeBps == 0 (v1/mainnet) the vault is not required — backward-compatible.
        if (creatorFeeBps != 0 && creatorVault == address(0)) revert CreatorVaultUnset();
        uint256 len = bytes(name).length;
        if (len == 0 || len > 32) revert InvalidName();
        len = bytes(symbol).length;
        if (len == 0 || len > 10) revert InvalidSymbol();
        // F4 (M1-5 security gate): load-bearing — the token stores this verbatim/immutably.
        if (metadataHash == bytes32(0)) revert ZeroMetadataHash();
        len = bytes(metadataUri).length;
        // F-4 (M1-7/M1-8 gate): the URI is the metadata pointer (emitted and exposed by
        // LaunchToken.tokenURI), NOT the integrity commitment. A bad length is a distinct fault
        // from a zero hash, so it gets its own error.
        if (len == 0 || len > 256) revert InvalidMetadataUri();
    }

    /// @dev The constant curve init-code hash → the address is precomputable before deploy.
    function _computeCurveAddress(bytes32 salt) internal view returns (address) {
        return Create2.computeAddress(salt, keccak256(type(BondingCurve).creationCode), address(this));
    }

    /// @dev Stage the immutable snapshot, CREATE2-deploy the curve (which reads it back in its
    ///      constructor), then unstage. The `assert` proves CREATE2 determinism held. `creator` +
    /// `creatorVault` are snapshotted so the curve's creator-fee leg is fixed at birth
    /// and an owner retune of `creatorFeeBps`/`creatorVault` cannot touch a live curve.
    function _deployCurve(bytes32 salt, address token, address creator) internal returns (address curve) {
        _stagedParams = CurveParameters({
            token: token,
            router: router,
            migrator: migrator,
            creator: creator,
            creatorVault: creatorVault,
            virtualEth0: _virtualEth0,
            virtualToken0: _virtualToken0,
            curveSupply: _curveSupply,
            lpTranche: _lpTranche,
            graduationEth: _graduationEth,
            tradeFeeBps: tradeFeeBps,
            creatorFeeBps: creatorFeeBps,
            graduationFee: graduationFee,
            callerReward: callerReward,
            earlyWindowSeconds: earlyWindowSeconds,
            maxEarlyBuyWei: maxEarlyBuyWei
        });
        curve = address(new BondingCurve{salt: salt}());
        assert(curve == _computeCurveAddress(salt));
        delete _stagedParams;
    }

    // ─────────────────────────────── Curve-only ────────────────────────────────

    /// @inheritdoc ICurveFactory
    /// @dev Positive delta (buy): accumulate and enforce the global beta cap. Negative delta
    ///      (sell/graduation): floor-at-zero, NEVER revert — this is proof-by-construction
    /// obligation (b) that no beta-cap path can block a sell (contracts.md). The subtract
    ///      is `unchecked` only under an explicit `>=` floor guard, so it cannot underflow.
    function recordEthDelta(int256 delta) external override onlyCurve {
        if (delta > 0) {
            uint256 added = uint256(delta);
            uint256 updated = globalCurveEth + added;
            if (updated > globalEthCap) revert CapExceeded();
            globalCurveEth = updated;
        } else if (delta < 0) {
            uint256 removed = uint256(-delta);
            uint256 current = globalCurveEth;
            unchecked {
                globalCurveEth = removed >= current ? 0 : current - removed;
            }
        }
    }

    // ──────────────────────────────── Views ────────────────────────────────────

    /// @inheritdoc ICurveFactory
    /// @dev LOUD semantics note (LAUNCH-2 root cause): this is the CREATE2 staging callback for
    ///      the BondingCurve constructor (decision #1 above), NOT a config surface. Outside the
    ///      `_deployCurve` window `_stagedParams` is deleted, so this returns ALL ZEROS by design.
    ///      Behavior is intentionally unchanged — the constant-init-code staging pattern depends
    ///      on it. Off-chain readers wanting curve shape: {curveDefaults}.
    function curveParameters() external view override returns (CurveParameters memory) {
        return _stagedParams;
    }

    /// @inheritdoc ICurveFactory
    /// @dev Pure view over the five curve-shape `immutable`s (seam; LAUNCH-2:
    ///      the Create-page pre-create preview reads these factory-level defaults — per-curve
    /// immutables only exist after a curve deploys, and {curveParameters} is
    /// deploy-transient). owner-reach: adds no authority — no setter, no state write,
    /// values fixed at factory deploy (new shape = new factory version).
    function curveDefaults() external view override returns (CurveDefaults memory) {
        return CurveDefaults({
            virtualEth0: _virtualEth0,
            virtualToken0: _virtualToken0,
            curveSupply: _curveSupply,
            lpTranche: _lpTranche,
            graduationEth: _graduationEth
        });
    }

    /// @inheritdoc ICurveFactory
    function config() external view override returns (FactoryConfig memory) {
        return FactoryConfig({
            treasury: treasury,
            tradeFeeBps: tradeFeeBps,
            creatorFeeBps: creatorFeeBps,
            creationFee: creationFee,
            graduationFee: graduationFee,
            callerReward: callerReward,
            earlyWindowSeconds: earlyWindowSeconds,
            maxEarlyBuyWei: maxEarlyBuyWei,
            pauseCreates: pauseCreates,
            pauseBuys: pauseBuys,
            perTokenEthCap: perTokenEthCap,
            globalEthCap: globalEthCap
        });
    }

    // ───────────────────── Owner (Safe) — hard-capped in code ───────────────────

    /// @inheritdoc ICurveFactory
    function setPauseCreates(bool paused) external override onlyOwner {
        pauseCreates = paused;
        emit PauseCreatesSet(paused);
    }

    /// @inheritdoc ICurveFactory
    function setPauseBuys(bool paused) external override onlyOwner {
        pauseBuys = paused;
        emit PauseBuysSet(paused);
    }

    /// @inheritdoc ICurveFactory
    function setTreasury(address newTreasury) external override onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    /// @inheritdoc ICurveFactory
    function setTradeFeeBps(uint16 newBps) external override onlyOwner {
        // ADDITIVE ≤2% cap : treasury + creator legs together ≤ MAX_TRADE_FEE_BPS.
        if (uint256(newBps) + creatorFeeBps > MAX_TRADE_FEE_BPS) revert FeeAboveCap();
        tradeFeeBps = newBps;
        emit TradeFeeUpdated(newBps);
    }

    /// @inheritdoc ICurveFactory
    /// @dev Creator-leg default for FUTURE curves. Re-asserts the ADDITIVE cap.
    /// Live curves are unaffected — each snapshots its own rate at creation.
    function setCreatorFeeBps(uint16 newBps) external override onlyOwner {
        if (uint256(tradeFeeBps) + newBps > MAX_TRADE_FEE_BPS) revert FeeAboveCap();
        creatorFeeBps = newBps;
        emit CreatorFeeUpdated(newBps);
    }

    /// @inheritdoc ICurveFactory
    /// @dev ONE-TIME wiring of the pull-payment CreatorVault, mirroring
    ///      {setRouter}/{setMigrator}. Immutable-by-convention: reverts once set, so an owner can
    ///      never repoint a live system's creator-fee sink. Non-zero required.
    function setCreatorVault(address vault) external override onlyOwner {
        if (creatorVault != address(0)) revert AlreadyInitialized();
        if (vault == address(0)) revert ZeroAddress();
        creatorVault = vault;
        emit CreatorVaultSet(vault);
    }

    /// @inheritdoc ICurveFactory
    /// @dev ONE-TIME wiring of the post-graduation ERC20 fee source, mirroring
    ///      {setCreatorVault}. Immutable-by-convention: reverts once set. Gates
    ///      {CreatorVault.depositERC20} to this single trusted LPFeeVault so the per-token creator
    /// balance equals the sum of collect-routed shares (exact accounting). owner-reach: adds
    ///      no authority over live curves/token economics/the vaults — pure wiring, like setMigrator.
    function setLpFeeVault(address lpFeeVault_) external override onlyOwner {
        if (lpFeeVault != address(0)) revert AlreadyInitialized();
        if (lpFeeVault_ == address(0)) revert ZeroAddress();
        lpFeeVault = lpFeeVault_;
        emit LpFeeVaultSet(lpFeeVault_);
    }

    /// @inheritdoc ICurveFactory
    function setCreationFee(uint256 newFee) external override onlyOwner {
        if (newFee > maxCreationFee) revert FeeAboveCap();
        creationFee = newFee;
        emit CreationFeeUpdated(newFee);
    }

    /// @inheritdoc ICurveFactory
    function setGraduationFee(uint256 newFee) external override onlyOwner {
        if (newFee > maxGraduationFee) revert FeeAboveCap();
        graduationFee = newFee;
        emit GraduationFeeUpdated(newFee);
    }

    /// @inheritdoc ICurveFactory
    function setCallerReward(uint256 newReward) external override onlyOwner {
        if (newReward > maxCallerReward) revert FeeAboveCap();
        callerReward = newReward;
        emit CallerRewardUpdated(newReward);
    }

    /// @inheritdoc ICurveFactory
    /// @dev `windowSeconds ≤ MAX_EARLY_WINDOW_SECONDS` (7 days) — bounds the setter so it can never
    ///      overflow the `uint64` `createdAt + earlyWindowSeconds` sum in the curve constructor (which
    ///      would brick every future `createToken`) and stays within a sane anti-sniper horizon
    /// (config-discipline finding). `maxEarlyBuyWei_` is deliberately left
    ///      unbounded: a larger value only WEAKENS the (buy-only) early cap and can never block a sell.
    function setAntiSniper(uint64 windowSeconds, uint128 maxEarlyBuyWei_) external override onlyOwner {
        if (windowSeconds > MAX_EARLY_WINDOW_SECONDS) revert EarlyWindowTooLong();
        earlyWindowSeconds = windowSeconds;
        maxEarlyBuyWei = maxEarlyBuyWei_;
        emit AntiSniperUpdated(windowSeconds, maxEarlyBuyWei_);
    }

    /// @inheritdoc ICurveFactory
    /// @dev Both caps must stay `≥ _graduationEth` so graduation remains reachable (a cap below the
    ///      threshold means no buy can ever push real reserves to GRADUATION_ETH — config-discipline
    /// finding, guards). The M5 caps-lift value `type(uint128).max` satisfies it.
    function setCaps(uint128 perTokenEthCap_, uint128 globalEthCap_) external override onlyOwner {
        _requireCapsReachGraduation(perTokenEthCap_, globalEthCap_, _graduationEth);
        perTokenEthCap = perTokenEthCap_;
        globalEthCap = globalEthCap_;
        emit CapsUpdated(perTokenEthCap_, globalEthCap_);
    }

    /// @dev Shared cap-reachability guard (constructor + {setCaps}): a beta cap below the graduation
    ///      threshold would permanently strand every curve below graduation. `globalEthCap` bounds the
    ///      SUM across all curves, so it too must clear a single curve's threshold for ANY curve to
    ///      graduate. `perTokenEthCap` may legitimately exceed `globalEthCap` (a non-binding per-token
    ///      limit), so only the graduation floor — not their mutual ordering — is enforced.
    function _requireCapsReachGraduation(uint256 perTokenEthCap_, uint256 globalEthCap_, uint256 graduationEth_)
        internal
        pure
    {
        if (perTokenEthCap_ < graduationEth_ || globalEthCap_ < graduationEth_) revert CapBelowGraduation();
    }

    /// @inheritdoc ICurveFactory
    function setRouter(address router_) external override onlyOwner {
        if (router != address(0)) revert AlreadyInitialized();
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    /// @inheritdoc ICurveFactory
    function setMigrator(address migrator_) external override onlyOwner {
        if (migrator != address(0)) revert AlreadyInitialized();
        if (migrator_ == address(0)) revert ZeroAddress();
        migrator = migrator_;
        emit MigratorSet(migrator_);
    }
}
