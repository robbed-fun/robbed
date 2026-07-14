// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

import {IRouter} from "src/interfaces/IRouter.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";

import {CreatesPaused, BuysPaused, UnknownToken, InvalidMsgValue, EthTransferFailed} from "src/errors/Errors.sol";

/// @title TestRouter — minimal preview of the M1-9 Router, used to exercise the M1-8 curve
/// @notice TEST HARNESS (not the production Router). Implements exactly the fund-plumbing the curve
///         relies on: forwards `msg.sender` as `trader` (finding X-3), collects the creation fee to
///         the treasury, moves sell tokens into the curve before calling `sell`, and gates buys on
///         `pauseBuys`. It deliberately does NOT enforce `deadline` — the real Router (M1-9) owns
///         the deadline/slippage-guard surface; this harness only proves the curve's Router-facing
/// signatures and the no-treasury-on-trade property. The sell path here reads NO
/// pause flag, matching the production guarantee.
contract TestRouter is IRouter {
    using SafeERC20 for IERC20;

    ICurveFactory public immutable factoryContract;

    constructor(ICurveFactory factory_) {
        factoryContract = factory_;
    }

    function factory() external view override returns (address) {
        return address(factoryContract);
    }

    function createToken(
        string calldata name,
        string calldata symbol,
        bytes32 metadataHash,
        string calldata metadataUri,
        uint256 minTokensOut,
        uint256 /*deadline*/
    ) external payable override returns (address token, address curve, uint256 tokensOut) {
        if (factoryContract.pauseCreates()) revert CreatesPaused();
        uint256 creationFee = factoryContract.creationFee();
        if (msg.value < creationFee) revert InvalidMsgValue();

        (token, curve,) = factoryContract.createToken(msg.sender, name, symbol, metadataHash, metadataUri);

        // Creation fee → treasury (the one place the harness pushes to the treasury; NOT a trade path).
        _sendEth(factoryContract.treasury(), creationFee);

        uint256 initialBuy = msg.value - creationFee;
        if (initialBuy > 0) {
            (tokensOut,,) =
                IBondingCurve(curve).buy{value: initialBuy}(msg.sender, msg.sender, msg.sender, minTokensOut);
        } else if (minTokensOut != 0) {
            revert InvalidMsgValue();
        }
    }

    function buy(
        address token,
        address recipient,
        uint256 minTokensOut,
        uint256 /*deadline*/
    )
        external
        payable
        override
        returns (uint256 tokensOut)
    {
        if (factoryContract.pauseBuys()) revert BuysPaused();
        address curve = factoryContract.curveOf(token);
        if (curve == address(0)) revert UnknownToken();
        (tokensOut,,) = IBondingCurve(curve).buy{value: msg.value}(msg.sender, recipient, msg.sender, minTokensOut);
    }

    /// @dev No pause flag is read here or in {BondingCurve}.sell — sells are unfreezable.
    function sell(
        address token,
        uint256 tokenAmount,
        address recipient,
        uint256 minEthOut,
        uint256 /*deadline*/
    )
        external
        override
        returns (uint256 ethOut)
    {
        address curve = factoryContract.curveOf(token);
        if (curve == address(0)) revert UnknownToken();
        IERC20(token).safeTransferFrom(msg.sender, curve, tokenAmount);
        (ethOut,) = IBondingCurve(curve).sell(msg.sender, recipient, tokenAmount, minEthOut);
    }

    function sellWithPermit(
        address token,
        uint256 tokenAmount,
        address recipient,
        uint256 minEthOut,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override returns (uint256 ethOut) {
        try IERC20Permit(token).permit(msg.sender, address(this), tokenAmount, deadline, v, r, s) {} catch {}
        address curve = factoryContract.curveOf(token);
        if (curve == address(0)) revert UnknownToken();
        IERC20(token).safeTransferFrom(msg.sender, curve, tokenAmount);
        (ethOut,) = IBondingCurve(curve).sell(msg.sender, recipient, tokenAmount, minEthOut);
    }

    function quoteBuy(address token, uint256 ethInGross)
        external
        view
        override
        returns (uint256 tokensOut, uint256 fee, uint256 acceptedEthGross, uint256 refund)
    {
        return IBondingCurve(factoryContract.curveOf(token)).quoteBuy(ethInGross);
    }

    function quoteSell(address token, uint256 tokenAmount)
        external
        view
        override
        returns (uint256 ethOut, uint256 fee)
    {
        return IBondingCurve(factoryContract.curveOf(token)).quoteSell(tokenAmount);
    }

    function _sendEth(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}

/// @title MockMigrator — graduation sink standing in for the M1-10 V3Migrator
/// @notice TEST HARNESS. Real V3 pool init + arb-back + mint are M1-10 (invariant 6). For M1-8 this
///         only needs to (1) return a deterministic non-zero pool at create time and (2) accept the
///         curve's tokens + ETH at graduation and push the flat GRADUATION_FEE to the treasury FIRST
/// (contracts.md step 2), so the exact-fee invariant sees the graduation-fee leg. It
///         holds the rest (the LP ETH) — representing value locked in the future V3 position.
contract MockMigrator {
    ICurveFactory public immutable factoryContract;

    constructor(ICurveFactory factory_) {
        factoryContract = factory_;
    }

    /// @dev Called by the factory during createToken (onlyFactory in production). Deterministic
    ///      non-zero address; no real pool is created (M1-10 owns that).
    function initializePool(address token) external view returns (address pool) {
        return address(uint160(uint256(keccak256(abi.encode(token, factoryContract, "mock-pool")))));
    }

    /// @dev Called by curve.graduate() with the curve's ETH (minus reward, minus accruedFees) and
    ///      after receiving the curve's entire token balance. msg.sender IS the curve.
    function migrate(
        address /*token*/
    )
        external
        payable
        returns (uint256 tokenId, uint128 liquidity)
    {
        uint256 gradFee = IBondingCurve(msg.sender).GRADUATION_FEE();
        address treasury = factoryContract.treasury();
        (bool ok,) = treasury.call{value: gradFee}("");
        require(ok, "grad-fee push");
        return (1, 1);
    }

    receive() external payable {}
}

/// @title Reverter — treasury/recipient that rejects all incoming ETH
/// @notice TEST HARNESS for the decisive / UM-1 proof: pointed at as the factory `treasury`,
///         it proves a curve SELL still succeeds (no trade path touches it) while `sweepFees()`
///         reverts (retriable). Also reused to prove a reverting `recipient` only fails its own trade.
contract Reverter {
    error Nope();

    receive() external payable {
        revert Nope();
    }

    fallback() external payable {
        revert Nope();
    }
}
