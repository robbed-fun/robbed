// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "src/interfaces/external/IUniswapV3Pool.sol";
import {IUniswapV3SwapCallback} from "src/interfaces/external/IUniswapV3SwapCallback.sol";
import {INonfungiblePositionManager} from "src/interfaces/external/INonfungiblePositionManager.sol";
import {IWETH9} from "src/interfaces/external/IWETH9.sol";

/// @title PoolGriefer — adversary contract for the pre-seed-defense suites (spec §6.3.2)
/// @notice Reused by the migrator unit tests AND the gate-2 invariant-6 handler. A CONTRACT (not an
///         EOA) because `pool.swap`/`npm.mint` call `uniswapV3SwapCallback`/pay on `msg.sender`,
///         which must have code. Pays every swap/mint debt from its OWN funded balances — so all
///         griefing is strictly money-losing for the attacker; whatever it pushes into the pool
///         becomes migrator inventory at graduation (contracts.md §3.4 step 5).
contract PoolGriefer is IUniswapV3SwapCallback {
    IUniswapV3Pool public immutable pool;
    address public immutable token;
    IWETH9 public immutable weth;
    INonfungiblePositionManager public immutable npm;

    constructor(address pool_, address token_, address weth_, address npm_) {
        pool = IUniswapV3Pool(pool_);
        token = token_;
        weth = IWETH9(weth_);
        npm = INonfungiblePositionManager(npm_);
    }

    receive() external payable {}

    /// @notice Move `slot0` with a price-limited swap (near-free in the empty pre-grad pool).
    function grief_swap(bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96)
        external
        returns (int256 a0, int256 a1)
    {
        return pool.swap(address(this), zeroForOne, amountSpecified, sqrtPriceLimitX96, "");
    }

    /// @notice Mint attacker liquidity at a hostile tick range (forces the arb-back to consume real
    ///         budget rather than gliding through empty ticks).
    function grief_mint(int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired)
        external
        returns (uint256 tokenId, uint128 liquidity)
    {
        (address t0, address t1) = (pool.token0(), pool.token1());
        IERC20(t0).approve(address(npm), type(uint256).max);
        IERC20(t1).approve(address(npm), type(uint256).max);
        (tokenId, liquidity,,) = npm.mint(
            INonfungiblePositionManager.MintParams({
                token0: t0,
                token1: t1,
                fee: pool.fee(),
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp
            })
        );
    }

    /// @notice Raw donation of an asset to the pool (inert in V3 — proves it cannot skew the mint).
    function grief_donate(address asset, uint256 amount) external {
        IERC20(asset).transfer(address(pool), amount);
    }

    /// @inheritdoc IUniswapV3SwapCallback
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        require(msg.sender == address(pool), "griefer: not pool");
        if (amount0Delta > 0) _pay(pool.token0(), uint256(amount0Delta));
        if (amount1Delta > 0) _pay(pool.token1(), uint256(amount1Delta));
    }

    function _pay(address asset, uint256 amount) internal {
        IERC20(asset).transfer(msg.sender, amount);
    }
}
