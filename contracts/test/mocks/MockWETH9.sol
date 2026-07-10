// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {IWETH9} from "src/interfaces/external/IWETH9.sol";

/// @title MockWETH9 — faithful canonical WETH9 for gate-2 unit/invariant tests
/// @notice TEST MOCK. Byte-for-byte-behaviour clone of the canonical WETH9 semantics the V3
///         periphery and the {V3Migrator} rely on. THE load-bearing property (do not change):
///         `transfer`/`transferFrom` update balances and invoke NO recipient callback — exactly like
///         canonical WETH9. This is why the migrator can pay the graduation fee + WETH dust to a
///         potentially-hostile treasury via `weth.transfer` without any freeze risk (TM-T1). Fork
///         tests (gate 3, M1-12) use the REAL WETH `0x0Bd7…AD73`; this mock stands in only where a
///         local deploy is needed under the single 0.8.35 pin.
contract MockWETH9 is IWETH9 {
    string public constant name = "Wrapped Ether";
    string public constant symbol = "WETH";
    uint8 public constant decimals = 18;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    receive() external payable {
        deposit();
    }

    function deposit() public payable override {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public override {
        require(balanceOf[msg.sender] >= wad, "WETH: insufficient");
        balanceOf[msg.sender] -= wad;
        (bool ok,) = msg.sender.call{value: wad}("");
        require(ok, "WETH: withdraw failed");
        emit Withdrawal(msg.sender, wad);
    }

    function totalSupply() external view override returns (uint256) {
        return address(this).balance;
    }

    function approve(address spender, uint256 wad) external override returns (bool) {
        allowance[msg.sender][spender] = wad;
        emit Approval(msg.sender, spender, wad);
        return true;
    }

    function transfer(address dst, uint256 wad) external override returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    /// @dev No recipient hook — canonical WETH9 behaviour. This is why a hostile treasury cannot
    ///      revert a WETH transfer to it (TM-T1 graduation-fee/dust legs).
    function transferFrom(address src, address dst, uint256 wad) public override returns (bool) {
        require(balanceOf[src] >= wad, "WETH: insufficient");
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= wad, "WETH: allowance");
            allowance[src][msg.sender] -= wad;
        }
        balanceOf[src] -= wad;
        balanceOf[dst] += wad;
        emit Transfer(src, dst, wad);
        return true;
    }
}
