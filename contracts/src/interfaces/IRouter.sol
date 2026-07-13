// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @title IRouter — single user entrypoint (spec §6.5, §7; contracts.md §2.4)
/// @notice Thin by design: deadline + pause guards + fund plumbing + permit; all economics live
///         in the curve. No owner — all config is read from the factory. No events of its own.
///         Fees are NEVER caller-supplied — no fee parameter exists in any signature (spec §4.1).
///         BOTH ETH-leg fees (treasury §12.25 + Phase-2 creator §12.63) are computed and accrued
///         entirely in the {BondingCurve}; the Router supplies no fee and holds no creator state.
/// @dev FROZEN interface (tests-as-spec phase). Implementation: `nonReentrant` on every external
///      state-mutating function, CEI throughout, no `receive()` — the Router never holds ETH
///      (contracts.md §2.4). Slippage + deadline on every trade path incl. create's atomic buy
///      (spec §6.5).
interface IRouter {
    /// @notice One-tx launch: create token + curve + pre-initialized V3 pool, optionally atomic
    ///         initial buy with the remaining msg.value (anti-self-snipe, spec §5.3).
    /// @dev msg.value = factory.creationFee() + optional initialBuy. Creation fee → treasury.
    ///      If initialBuy == 0, minTokensOut MUST be 0 (revert InvalidMsgValue otherwise).
    ///      Reverts CreatesPaused if factory.pauseCreates(). metadataHash + metadataUri emitted
    ///      via the factory's TokenCreated (spec §12.15). The creator's initial buy IS subject to
    ///      the anti-sniper cap — no carve-out (contracts.md §3.1).
    /// @param name         Token name, [1,32] bytes (factory-validated).
    /// @param symbol       Ticker, [1,10] bytes (factory-validated).
    /// @param metadataHash keccak256 of the canonicalized metadata JSON (spec §8.3), != 0.
    /// @param metadataUri  R2 canonical JSON URL, [1,256] bytes; event-only, not stored on-chain.
    /// @param minTokensOut Slippage floor for the atomic initial buy (0 when no initial buy).
    /// @param deadline     Unix-timestamp deadline (spec §6.5).
    function createToken(
        string calldata name,
        string calldata symbol,
        bytes32 metadataHash,
        string calldata metadataUri,
        uint256 minTokensOut,
        uint256 deadline
    ) external payable returns (address token, address curve, uint256 tokensOut);

    /// @notice Buy on the bonding curve. Reverts BuysPaused if factory.pauseBuys().
    /// @param token        The LaunchToken to buy (curve resolved via factory; UnknownToken if none).
    /// @param recipient    Receives the tokens.
    /// @param minTokensOut Slippage floor (spec §6.5).
    /// @param deadline     Unix-timestamp deadline.
    function buy(address token, address recipient, uint256 minTokensOut, uint256 deadline)
        external
        payable
        returns (uint256 tokensOut);

    /// @notice Sell on the bonding curve. Reads NO pause flag of any kind — greppable by
    ///         auditors: pauseBuys/pauseCreates do not appear in this function or anything it
    ///         calls (spec §6.5; contracts.md §5.3).
    /// @dev Pulls tokenAmount from msg.sender (approval target = Router; one approval covers all
    ///      curves) directly to the curve via SafeERC20.safeTransferFrom, then curve.sell().
    /// @param token       The LaunchToken to sell.
    /// @param tokenAmount Tokens to sell.
    /// @param recipient   Receives the ETH proceeds.
    /// @param minEthOut   Slippage floor on net ETH out.
    /// @param deadline    Unix-timestamp deadline.
    function sell(address token, uint256 tokenAmount, address recipient, uint256 minEthOut, uint256 deadline)
        external
        returns (uint256 ethOut);

    /// @notice sell() with EIP-2612 permit (LaunchToken is ERC20Permit).
    /// @dev try/catch around permit — front-run-permit griefing tolerance: proceed if allowance
    ///      is already sufficient (contracts.md §2.4, §5.7). `deadline` doubles as the permit
    ///      deadline and the trade deadline.
    function sellWithPermit(
        address token,
        uint256 tokenAmount,
        address recipient,
        uint256 minEthOut,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 ethOut);

    // ──────────── Views (thin proxies to curve quoting, FE convenience) ────────────

    /// @notice Proxy to curve.quoteBuy (contracts.md §2.4).
    function quoteBuy(address token, uint256 ethInGross)
        external
        view
        returns (uint256 tokensOut, uint256 fee, uint256 acceptedEthGross, uint256 refund);

    /// @notice Proxy to curve.quoteSell.
    function quoteSell(address token, uint256 tokenAmount) external view returns (uint256 ethOut, uint256 fee);

    /// @notice The CurveFactory (sole storage, immutable — contracts.md §2.4).
    function factory() external view returns (address);
}
