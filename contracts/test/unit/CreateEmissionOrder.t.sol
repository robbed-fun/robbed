// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test, Vm} from "forge-std/Test.sol";

import {CurveFactory} from "src/CurveFactory.sol";
import {Router} from "src/Router.sol";
import {ICurveFactory} from "src/interfaces/ICurveFactory.sol";
import {IBondingCurve} from "src/interfaces/IBondingCurve.sol";

import {TestConstants} from "test/harness/TestConstants.sol";
import {MockMigrator} from "test/harness/Harness.sol";
import {MockArbSys} from "test/mocks/MockArbSys.sol";

/// @title §12.41 emission-order gate — `TokenCreated` MUST precede the initial-buy `Trade` (§12.15)
/// @notice Pins the contracts-side invariant the M2-0b Ponder spike (2026-07-11, ponder 0.16.8)
///         made load-bearing: in an atomic `Router.createToken` with a non-zero initial buy, the
///         factory's `TokenCreated` is emitted STRICTLY BEFORE the child curve's initial-buy
///         `Trade` in the same transaction (`TokenCreated.logIndex < Trade.logIndex`). Ponder
///         processes same-block events by logIndex, so inverting this order would fire the
///         indexer's `Trade` handler before the token row exists — spec §12.41 records this as an
///         event-shape/ordering divergence to ESCALATE (robbed-architect), never work around.
///         If either test here fails, do NOT patch the test or the handlers: the emission order
///         in `Router.createToken` / `CurveFactory.createToken` has drifted and must be escalated.
///
/// @dev Method: `vm.recordLogs()` around the real `Router.createToken` call through the production
///      factory/curve (Foundry preserves emission order in the recorded array). Topics are matched
///      via the canonical interface event selectors (`ICurveFactory.TokenCreated.selector`,
///      `IBondingCurve.Trade.selector`) — no hand-rolled signature hex — and emitters are pinned
///      to the factory / registered curve so an unrelated same-topic log cannot satisfy the test.
contract CreateEmissionOrderTest is Test {
    CurveFactory internal factory;
    Router internal router;
    MockMigrator internal migrator;

    address internal treasury = makeAddr("treasury");
    address internal safeOwner = makeAddr("safeOwner");
    address internal creator = makeAddr("creator");

    function setUp() public {
        // Mock ArbSys at address(100) so the real precompile path is stubbed in unit tests.
        vm.etch(address(0x64), address(new MockArbSys()).code);

        factory = new CurveFactory(TestConstants.factoryInit(treasury, safeOwner));
        migrator = new MockMigrator(ICurveFactory(address(factory)));
        router = new Router(ICurveFactory(address(factory)));

        vm.startPrank(safeOwner);
        factory.setMigrator(address(migrator));
        factory.setRouter(address(router));
        vm.stopPrank();
    }

    /// @notice Atomic create + non-zero initial buy: exactly one `TokenCreated` (from the factory)
    ///         and exactly one `Trade` (from the child curve) are emitted, and `TokenCreated`
    ///         appears STRICTLY FIRST in emission order (spec §12.41 / §12.15).
    function test_emissionOrder_tokenCreatedBeforeInitialBuyTrade_spec12_41() public {
        uint256 fee = factory.creationFee();
        uint256 buyIn = 0.1 ether;
        vm.deal(creator, fee + buyIn);

        vm.recordLogs();
        vm.prank(creator);
        (address token, address curve, uint256 tokensOut) = router.createToken{value: fee + buyIn}(
            "Subject", "SUBJ", keccak256("meta"), "ipfs://meta", 1, block.timestamp
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertGt(tokensOut, 0, "harness defect: initial buy bought nothing");
        assertEq(factory.curveOf(token), curve, "harness defect: registry mismatch");

        (uint256 createdAt, uint256 createdCount) =
            _findLog(logs, ICurveFactory.TokenCreated.selector, address(factory));
        (uint256 tradeAt, uint256 tradeCount) = _findLog(logs, IBondingCurve.Trade.selector, curve);

        assertEq(createdCount, 1, "expected exactly one TokenCreated from the factory");
        assertEq(tradeCount, 1, "expected exactly one initial-buy Trade from the curve");
        // THE §12.41 invariant: strict logIndex ordering within the tx.
        assertLt(createdAt, tradeAt, "12.41 VIOLATED: Trade emitted before TokenCreated - ESCALATE, do not work around");
    }

    /// @notice No-initial-buy variant: the create tx emits exactly one `TokenCreated` and NO
    ///         `Trade` at all (the §12.15 "initial buy derived from first same-tx Trade" rule
    ///         must see zero Trades when the creator did not buy).
    function test_emissionOrder_noInitialBuy_tokenCreatedOnly_noTrade_spec12_41() public {
        uint256 fee = factory.creationFee();
        vm.deal(creator, fee);

        vm.recordLogs();
        vm.prank(creator);
        (, address curve, uint256 tokensOut) =
            router.createToken{value: fee}("Subject", "SUBJ", keccak256("meta"), "ipfs://meta", 0, block.timestamp);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(tokensOut, 0, "harness defect: no-buy create returned tokens");

        (, uint256 createdCount) = _findLog(logs, ICurveFactory.TokenCreated.selector, address(factory));
        assertEq(createdCount, 1, "expected exactly one TokenCreated from the factory");

        // No Trade from ANY emitter in this tx — not just the curve — so a same-topic stray
        // cannot masquerade as an initial buy to the indexer's same-tx derivation.
        (, uint256 tradeCountCurve) = _findLog(logs, IBondingCurve.Trade.selector, curve);
        (, uint256 tradeCountAny) = _findLog(logs, IBondingCurve.Trade.selector, address(0));
        assertEq(tradeCountCurve, 0, "no-buy create must emit no Trade from the curve");
        assertEq(tradeCountAny, 0, "no-buy create must emit no Trade at all");
    }

    /// @dev Scan the recorded logs for `topic0` from `emitter` (`address(0)` = any emitter).
    ///      Returns the array position of the FIRST match (emission order == logIndex order in a
    ///      single-tx recording) and the total match count.
    function _findLog(Vm.Log[] memory logs, bytes32 topic0, address emitter)
        private
        pure
        returns (uint256 firstAt, uint256 count)
    {
        firstAt = type(uint256).max;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 0 || logs[i].topics[0] != topic0) continue;
            if (emitter != address(0) && logs[i].emitter != emitter) continue;
            if (count == 0) firstAt = i;
            count++;
        }
    }
}
