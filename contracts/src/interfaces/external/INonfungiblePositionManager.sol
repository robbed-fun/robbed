// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title INonfungiblePositionManager — minimal local interface
///        (mint, collect, createAndInitializePoolIfNecessary, positions)
/// @notice The live NPM address on chain 4663 is an OPEN ITEM (spec §13, contracts.md O-4):
///         pulled from the official Uniswap deployments registry, constructor/config param only.
/// @dev Minimal local interface, no upstream npm dependency (contracts.md §2 inventory).
///      `is IERC721` because the LP NFT custody flow (mint recipient = LPFeeVault, spec §6.3)
///      and the fork lifecycle test need ownerOf/safeTransferFrom semantics.
interface INonfungiblePositionManager is IERC721 {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    /// @notice Creates + initializes the pool if needed. Used at token-creation time for the
    ///         pre-seed defense (spec §6.3.2; contracts.md §2.5 initializePool). If an attacker
    ///         pre-created the pool at a hostile price, initialization is skipped — tolerated,
    ///         migrate() never trusts slot0.
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    /// @notice Mints a new position; graduation mints full-range with amount-mins enforced and
    ///         recipient = LPFeeVault (spec §6.3, contracts.md §3.4 step 7).
    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    /// @notice Collects accrued fees; sole call made by LPFeeVault.collect (spec §6.3.4).
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);

    /// @notice Position data; used by tests to verify the minted full-range position
    ///         (gate-2 row 6 "position value ratio at target", contracts.md §6).
    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}
