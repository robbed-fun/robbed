// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IWETH9 — minimal canonical wrapped-ETH interface
/// @notice Canonical WETH on Robinhood Chain: `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`
/// (chain facts; the address is a constructor/config param, asserted in the
/// deploy script — contracts.md storage).
/// @dev Minimal local interface, no upstream npm dependency (contracts.md inventory).
interface IWETH9 is IERC20 {
    /// @notice Wrap ETH: mints `msg.value` WETH to the caller.
    function deposit() external payable;

    /// @notice Unwrap: burns `wad` WETH from the caller and sends ETH back.
    function withdraw(uint256 wad) external;
}
