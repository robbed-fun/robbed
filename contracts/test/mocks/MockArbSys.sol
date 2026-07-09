// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IArbSys} from "src/interfaces/external/IArbSys.sol";

/// @title MockArbSys — test stand-in for the ArbSys precompile at address(100)
/// @notice Unit/fuzz/invariant tests etch this at `address(100)` (contracts.md §6):
///         `vm.etch(address(0x64), address(new MockArbSys()).code);`
///         Fork tests (gate 3) use the REAL precompile path instead — never this mock.
/// @dev THE ONLY TOLERATED HOME OF `block.number` IN THE REPO (CLAUDE.md hard rule;
///      contracts.md §5.1): on a local Foundry chain `block.number` is a real L2-style counter
///      controlled by vm.roll, so the mock mirrors it as the Orbit L2 block number unless a test
///      pins an explicit value via setArbBlockNumber (storage lives at address(100) once etched).
contract MockArbSys is IArbSys {
    uint256 internal _pinned;

    /// @notice Pin an explicit L2 block number (0 = follow block.number / vm.roll).
    function setArbBlockNumber(uint256 value) external {
        _pinned = value;
    }

    /// @inheritdoc IArbSys
    function arbBlockNumber() external view returns (uint256) {
        // block.number tolerated ONLY here — mock harness (contracts.md §5.1).
        return _pinned != 0 ? _pinned : block.number;
    }
}
