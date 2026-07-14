// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {DeployHarness} from "test/unit/DeployModes.t.sol";

/// @title Testnet small-G constants — Deploy.s.sol loader acceptance pin (Phase-T redeploy prep)
/// @notice Dry-runs the EXACT pre-broadcast resolution path of {Deploy.run} (mode select →
///         `_loadConstantsFrom` with the chain-id pin + `_consistencyChecks` — SupplySplitMismatch,
///         GraduationUnfundable, CapBelowGraduation, MinFloorToleranceBandViolated — →
///         `_resolveExternals` with the O-6 treasury guard) against the REAL, checked-in
///         `tools/m0/out/constants.testnet.json`, WITHOUT broadcasting anything. This is the
///         committed proof that the T-1 derive output — currently the faucet-scale
///         `M0_TESTNET_GRADUATION_ETH=0.005` re-derivation — is deploy-loadable: a regenerated
///         constants file that would brick `forge script Deploy` on 46630 fails HERE first.
/// @dev Distinct from unit/DeployModes.t.sol (which proves the mode/guard machinery against
///      sentinel fixtures): this file pins the machinery against the live artifact. If a future
///      testnet re-derivation changes policy (e.g. drops the small-G override), update the
///      faucet-band assertion below alongside it — it encodes the CURRENT testnet deploy intent.
contract DeployTestnetConstantsTest is Test {
    string internal constant TESTNET_CONSTANTS = "../tools/m0/out/constants.testnet.json";

    DeployHarness internal harness;

    function setUp() public {
        harness = new DeployHarness();
        // Deterministic env (mirrors DeployModes.t.sol): "0" == the vm.envOr default, so a shell
        // key can never leak into the harness; same value in every test → parallel-safe.
        vm.setEnv("DEPLOYER_PRIVATE_KEY", "0");
    }

    /// @notice The production loader accepts the regenerated small-G testnet constants end-to-end.
    function test_testnetConstants_smallG_loaderAccepts() public {
        vm.chainId(46_630);
        (address weth, address v3Factory, address npm,,, address treasury) =
            harness.loadAndResolveFrom(TESTNET_CONSTANTS);

        // Externals resolved from the file (ratified set — non-zero by the derive fail-closed
        // loader; the O-6 treasury guard did not revert, so the dev-signer Safe is wired).
        assertTrue(weth != address(0) && v3Factory != address(0) && npm != address(0), "externals unresolved");
        assertTrue(treasury != address(0), "treasury Safe unresolved");
    }

    /// @notice Margin + policy pins for the small-G set (Task-2 requirements, 2026-07-13):
    ///         (a) faucet-testable target — G ≈ 0.005 ETH (±2% tick-alignment shift);
    ///         (b) `GraduationUnfundable` clears with ≥2× margin: maxCallerReward + maxGraduationFee
    ///             ≤ 50% of G (the deploy guard itself only requires < G);
    ///         (c) callerReward = 10% of G and graduationFee ≤ 10% of G, so W* = G − R − F ≥ 80% of
    ///             G — the LP WETH leg stays the dominant share of the raise;
    ///         (d) anti-sniper cap = 2.5% of G and perTokenCap = 1.5×G stayed G-relative.
    function test_testnetConstants_smallG_feePolicyMargins() public view {
        string memory cj = vm.readFile(TESTNET_CONSTANTS);
        uint256 g = vm.parseJsonUint(cj, ".curve.graduationEthWei");
        uint256 callerReward = vm.parseJsonUint(cj, ".fees.callerRewardWei");
        uint256 gradFee = vm.parseJsonUint(cj, ".fees.graduationFeeWei");
        uint256 maxes =
            vm.parseJsonUint(cj, ".fees.maxCallerRewardWei") + vm.parseJsonUint(cj, ".fees.maxGraduationFeeWei");

        // (a) faucet band: requested 0.005 ETH; tick alignment may shift the derived G by ≤~1%.
        assertGe(g, 0.0049 ether, "testnet G below the 0.005 faucet band");
        assertLe(g, 0.0051 ether, "testnet G above the 0.005 faucet band");

        // (b) GraduationUnfundable margin (Deploy._consistencyChecks reverts at maxes >= G).
        assertLe(maxes * 2, g, "fee ceilings must stay <= 50% of G (>=2x GraduationUnfundable margin)");

        // (c) actual fee set: reward 10% of G (rounded to 1e12), fee cost-based but <= 10% of G.
        assertLe(callerReward, g / 10 + 1e12, "callerReward above 10% of G");
        assertLe(gradFee, g / 10, "graduationFee above its 10%-of-G cap");
        assertGe(g - callerReward - gradFee, (g * 8) / 10, "W* fell below 80% of G");

        // (d) G-relative knobs re-derived at the new G.
        uint256 earlyCap = vm.parseJsonUint(cj, ".antiSniper.maxEarlyBuyWei");
        assertApproxEqRel(earlyCap, (g * 250) / 10_000, 0.02e18, "anti-sniper cap != 2.5% of G");
        assertEq(
            vm.parseJsonUint(cj, ".beta.perTokenEthCapWei"), (g * 3) / 2, "perTokenEthCap != 1.5x G (gate-7 policy)"
        );
    }
}
