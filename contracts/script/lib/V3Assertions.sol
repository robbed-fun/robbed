// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IUniswapV3Factory} from "../../src/interfaces/external/IUniswapV3Factory.sol";
import {INonfungiblePositionManager} from "../../src/interfaces/external/INonfungiblePositionManager.sol";

/// @title V3Assertions — deploy-time Uniswap V3 runtime sanity checks (contracts.md)
/// @notice The four V3 addresses on chain 4663 are CONFIRMED (O-4 RESOLVED) registry-
///         sourced + on-chain verified. A registry lookup proves the addresses exist, but it CANNOT
///         prove (a) the 1% fee tier is enabled on that Factory, nor (b) that the NPM was deployed
///         against that same Factory/WETH. This library runtime-asserts exactly those three facts so
///         `Deploy.s.sol` (M1-14) fails closed if the wired addresses are wrong for this chain —
///         rather than silently deploying a migrator that will only revert at the first graduation.
/// @dev  Design decision (owned by robbed-contracts, not a product question):
///       - `internal` library, not an abstract contract or free function: it inlines into the deploy
///         script with zero deployed bytecode and no extra address to trust, while staying unit-
///         testable in isolation (a `Test` contract can wrap it). Options weighed: (1) inline the
///         `require`s directly in Deploy.s.sol — rejected: not independently testable, and M1-14's
///         `Deploy.s.sol` does not exist yet; (2) a deployed helper contract — rejected: needless
///         bytecode/address for a pure deploy-time check. Authoritative basis: Solidity library docs
///         (internal functions are inlined) — https://docs.soliditylang.org.
/// - Custom errors, never revert strings (/ contracts.md). These live locally
///         (not in the FROZEN src/errors/Errors.sol) because they are deploy-tooling errors, not part
///         of the six shipped contracts' shared taxonomy — keeping Errors.sol untouched.
///       - Signatures verified against Uniswap docs (docs-first): v3-core
///         `IUniswapV3Factory.feeAmountTickSpacing(uint24) view returns (int24)` and v3-periphery
///         `IPeripheryImmutableState.factory()/WETH9() view returns (address)`.
/// Protects: the graduation/mint path (a wrong Factory ⇒ wrong/absent pool; a disabled 1%
///       tier ⇒ `createPool` reverts; a wrong WETH ⇒ the migrator mints against the wrong asset).
library V3Assertions {
    /// @notice The 1% fee tier used for graduation pools.
    uint24 internal constant V3_FEE_TIER = 10_000;

    /// @notice The tick spacing the 1% tier must expose on the Factory.
    int24 internal constant EXPECTED_TICK_SPACING = 200;

    /// @notice The 1% fee tier is not enabled on the wired Factory (`feeAmountTickSpacing != 200`).
    /// @param actual The tick spacing the Factory returned for the 1% tier (0 == tier disabled).
    error FeeTierNotEnabled(int24 expected, int24 actual);

    /// @notice The NPM was not deployed against the wired Factory (`NPM.factory() != v3Factory`).
    error NpmFactoryMismatch(address expected, address actual);

    /// @notice The NPM's WETH9 is not the canonical 4663 WETH (`NPM.WETH9() != weth`).
    error NpmWeth9Mismatch(address expected, address actual);

    /// @notice Runtime-assert the V3 wiring; reverts (fail-closed) on any mismatch.
    /// @dev `view` (reads external state); no `block.number`, no revert strings.
    /// @param v3Factory Uniswap V3 Factory address (constants.json `external.v3Factory`).
    /// @param npm       NonfungiblePositionManager address (constants.json `external.positionManager`).
    /// @param weth      Canonical WETH9 on 4663 (`0x0Bd7…AD73`, constants.json `external.weth`).
    function assertV3Wiring(address v3Factory, address npm, address weth) internal view {
        int24 tickSpacing = IUniswapV3Factory(v3Factory).feeAmountTickSpacing(V3_FEE_TIER);
        if (tickSpacing != EXPECTED_TICK_SPACING) revert FeeTierNotEnabled(EXPECTED_TICK_SPACING, tickSpacing);

        address npmFactory = INonfungiblePositionManager(npm).factory();
        if (npmFactory != v3Factory) revert NpmFactoryMismatch(v3Factory, npmFactory);

        address npmWeth = INonfungiblePositionManager(npm).WETH9();
        if (npmWeth != weth) revert NpmWeth9Mismatch(weth, npmWeth);
    }
}
