// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {IArbSys} from "src/interfaces/external/IArbSys.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";

/// @title MockArbSys harness test (contracts.md : unit/fuzz/invariant tests run against
///        MockArbSys etched at address(100); the real precompile path is fork-only, gate 3)
contract MockArbSysTest is Test {
    address internal constant ARB_SYS = address(100);

    function setUp() public {
        vm.etch(ARB_SYS, address(new MockArbSys()).code);
    }

    /// @notice The etched mock answers arbBlockNumber() at the canonical precompile address.
    function test_etchedAtPrecompileAddress_followsRoll() public {
        vm.roll(4663);
        assertEq(IArbSys(ARB_SYS).arbBlockNumber(), 4663, "mock must mirror the local chain's L2 block counter");
    }

    /// @notice Tests can pin an explicit L2 block number independent of the local counter.
    function test_pinnedValueWins(uint256 pinned) public {
        pinned = bound(pinned, 1, type(uint256).max);
        MockArbSys(ARB_SYS).setArbBlockNumber(pinned);
        assertEq(IArbSys(ARB_SYS).arbBlockNumber(), pinned, "pinned value must take precedence");
    }
}
