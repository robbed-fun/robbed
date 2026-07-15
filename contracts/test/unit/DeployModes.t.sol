// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";

/// @dev Exposes the internal mode/constants plumbing of {Deploy} for unit testing. Never broadcasts
///      and never touches the topology deploy path — only the Phase-T mode selection + constants
///      resolution added for testnet (chain 46630) is under test here; the full deploy path stays
///      covered by the compose `deploychain` smoke (M1-14) and the fork lifecycle suite.
contract DeployHarness is Deploy {
    // Deterministic affirmation override (decision #5): the production {_isMainnetAffirmed} reads
    // process-global env, which races under forge's parallel execution. The harness pins it so every
    // mode/label assertion is race-free.
    bool private _affirm;

    function setAffirm(bool v) external {
        _affirm = v;
    }

    function _isMainnetAffirmed() internal view override returns (bool) {
        return _affirm;
    }

    function selectMode(uint256 chainId, bool affirmed) external pure returns (Mode) {
        return _selectMode(chainId, affirmed);
    }

    /// @dev The exact `run()` step-0 mode resolution → artifact `mode` string. This is the single
    /// value the addresses codegen + the indexer chain-identity gate assert against.
    function resolveModeString() external returns (string memory) {
        mode = _selectMode(block.chainid, _isMainnetAffirmed());
        return _modeString();
    }

    /// @dev `_modeString()` for an explicitly-set `mode` (label-taxonomy check, race-free).
    function modeStringFor(Mode m) external returns (string memory) {
        mode = m;
        return _modeString();
    }

    function currentMode() external view returns (Mode) {
        return mode;
    }

    /// @dev Resolves mode from the (cheatcode-set) chain id + affirmation, then the default path.
    function defaultConstantsPath() external returns (string memory) {
        mode = _selectMode(block.chainid, _isMainnetAffirmed());
        return _defaultConstantsPath();
    }

    /// @dev The exact pre-broadcast resolution sequence of {Deploy.run} steps 0–1 (minus the signer):
    ///      mode → `_loadConstantsFrom` (chain-id pin + consistency checks) → `_resolveExternals`.
    ///      The constants path is an explicit argument (not `ROBBED_CONSTANTS`) because forge runs
    ///      tests in parallel and `vm.setEnv` mutates PROCESS-global state — env-based fixture
    ///      selection races across tests. The env override itself is a one-line `vm.envOr` shim in
    ///      {Deploy._loadConstants}; everything behind it is exercised here.
    function loadAndResolveFrom(string memory path)
        external
        returns (
            address weth_,
            address v3Factory_,
            address npm_,
            address swapRouter02_,
            address quoterV2_,
            address treasury_
        )
    {
        mode = _selectMode(block.chainid, _isMainnetAffirmed());
        _loadConstantsFrom(path);
        _resolveExternals();
        return (weth, v3Factory, npm, swapRouter02, quoterV2, treasury);
    }
}

/// @title DeployModesTest — Phase-T deploy-script mode selection (live 4663 / testnet 46630 / local)
/// @notice Proves, per the Phase-T prep requirements:
///         (a) chain 46630 selects TESTNET (public-chain) mode — before the three-way split it
///             wrongly took the local mock-V3/dev-key branch;
///         (b) NO public chain (4663 or 46630) can deploy without `DEPLOYER_ADDRESS`
///             (`MissingDeployerAddress` — the anvil account-0 fallback is local-only);
///         (c) testnet externals (WETH/V3/NPM/router/quoter/treasury) are read from the constants
///             file's `external.*` — sentinel-address fixtures prove zero hardcodes in Solidity;
///         (d) the O-6 `TreasurySafeUnset` guard fails closed on testnet exactly as on live;
///         (e) a constants-file/chain mismatch fails closed (`ConstantsChainIdMismatch`) before spend.
contract DeployModesTest is Test {
    // Fixture paths are relative to the foundry project root (contracts/) — same base
    // `vm.readFile` uses for the real `../tools/m0/out/…` defaults.
    string internal constant FIXTURE = "test/fixtures/deploy/constants.testnet-mode.json";
    string internal constant FIXTURE_ZERO_TREASURY = "test/fixtures/deploy/constants.testnet-zerotreasury.json";
    // The real dev-fork constants (chainId 4663, canonical WETH externals, anvil-1 treasury
    // stand-in) the docker `deploychain` one-shot feeds a FORK run — used to prove a fork resolves.
    string internal constant FORK_FIXTURE = "../tools/localstack/constants.fork.json";

    // mainnet facts — the sentinels in the fixture must NOT be these (proves no hardcodes).
    address internal constant MAINNET_WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address internal constant MAINNET_V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant MAINNET_NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;

    DeployHarness internal harness;

    function setUp() public {
        harness = new DeployHarness();
        // Deterministic env: "0" parses to uint256(0) — the same value `vm.envOr` yields when the
        // var is absent — so a developer's shell key can never flip the MissingDeployerAddress tests.
        // (Same value in every test → safe under forge's parallel test execution; per-test-DIFFERENT
        // env values would race, which is why fixtures are passed as explicit paths instead.)
        vm.setEnv("DEPLOYER_PRIVATE_KEY", "0");
        vm.setEnv("DEPLOYER_ADDRESS", "0x0000000000000000000000000000000000000000");
    }

    // ── (a) mode selection ────────────────────────────────────────────────────

    function test_selectMode_fourWaySplit() public view {
        // 4663 is LIVE only when affirmed; the default (unaffirmed) is FORK — decision #5.
        assertEq(uint256(harness.selectMode(4663, true)), uint256(Deploy.Mode.Live), "4663 affirmed -> live");
        assertEq(uint256(harness.selectMode(4663, false)), uint256(Deploy.Mode.Fork), "4663 default -> fork");
        // 46630/31337/1 ignore the affirmation entirely.
        assertEq(uint256(harness.selectMode(46_630, false)), uint256(Deploy.Mode.Testnet), "46630 -> testnet");
        assertEq(uint256(harness.selectMode(46_630, true)), uint256(Deploy.Mode.Testnet), "46630 affirmed -> testnet");
        assertEq(uint256(harness.selectMode(31_337, false)), uint256(Deploy.Mode.Local), "31337 -> local");
        assertEq(uint256(harness.selectMode(31_337, true)), uint256(Deploy.Mode.Local), "31337 affirmed -> local");
        assertEq(uint256(harness.selectMode(1, false)), uint256(Deploy.Mode.Local), "1 -> local");
        // 46646 is the WRONG testnet id printed by some third-party lists (testnet.md) — it must
        // NOT be treated as the testnet; it falls through to local, where the very first public-RPC
        // interaction (mock V3 deploy against a remote chain) fails rather than deploying wrongly.
        assertEq(uint256(harness.selectMode(46_646, false)), uint256(Deploy.Mode.Local), "46646 stays non-testnet");
    }

    // ── (a2) / T-5: a FORK run can never produce a mode:"live" 4663 artifact ──

    /// @notice The core guarantee at its source (the mode is minted by Deploy.s.sol) a
    ///         chain-4663 run WITHOUT the explicit `ROBBED_DEPLOY_ENV=mainnet` affirmation resolves
    ///         to `mode:"fork"`, never `"live"`. Fail-safe by omission — forgetting the flag (or any
    ///         fork pipeline that never sets it) yields "fork", so the mainnet-fork-mislabeled-live
    /// defect that motivated cannot recur through this pipeline.
    function test_forkRun_4663_modeIsForkNeverLive() public {
        vm.chainId(4663);
        harness.setAffirm(false); // a fork run: no mainnet affirmation
        string memory m = harness.resolveModeString();
        assertEq(m, "fork", "unaffirmed 4663 run must label the artifact mode:\"fork\"");
        assertTrue(keccak256(bytes(m)) != keccak256(bytes("live")), "fork run must NOT be mode:\"live\"");
        assertEq(uint256(harness.currentMode()), uint256(Deploy.Mode.Fork), "resolved mode must be Fork");
    }

    /// @notice The opt-IN path: only an explicit `ROBBED_DEPLOY_ENV=mainnet` on 4663 mints `"live"`.
    function test_affirmedRun_4663_modeIsLive() public {
        vm.chainId(4663);
        harness.setAffirm(true);
        assertEq(harness.resolveModeString(), "live", "affirmed 4663 run is mode:\"live\"");
        assertEq(uint256(harness.currentMode()), uint256(Deploy.Mode.Live), "resolved mode must be Live");
    }

    /// @notice Label taxonomy — `_modeString` maps every mode uniquely and "fork" is never "live".
    function test_modeString_taxonomy() public {
        assertEq(harness.modeStringFor(Deploy.Mode.Live), "live", "Live -> live");
        assertEq(harness.modeStringFor(Deploy.Mode.Testnet), "testnet", "Testnet -> testnet");
        assertEq(harness.modeStringFor(Deploy.Mode.Local), "local", "Local -> local");
        assertEq(harness.modeStringFor(Deploy.Mode.Fork), "fork", "Fork -> fork");
    }

    /// @notice A fork run STILL resolves its externals + O-6 guard (it is a real mainnet fork) while
    ///         keeping `mode:"fork"` — proves the label, not the deploy discipline, is what differs.
    function test_forkRun_resolvesExternals_butStaysFork() public {
        vm.chainId(4663);
        harness.setAffirm(false);
        (address weth,,,,, address treasury) = harness.loadAndResolveFrom(FORK_FIXTURE);
        assertEq(weth, MAINNET_WETH, "fork uses the canonical 12.28 WETH");
        assertTrue(treasury != address(0), "fork fixture treasury is a non-zero dev stand-in (O-6 passes)");
        assertEq(harness.modeStringFor(harness.currentMode()), "fork", "mode stayed fork through resolution");
    }

    function test_defaultConstantsPath_perMode() public {
        vm.chainId(46_630);
        assertEq(harness.defaultConstantsPath(), "../tools/m0/out/constants.testnet.json", "testnet default");
        vm.chainId(4663);
        // Both a live and a fork 4663 run default to the mainnet constants file (fork ↦ same
        // economics); the docker one-shot overrides to the fork fixture via ROBBED_CONSTANTS.
        harness.setAffirm(true);
        assertEq(harness.defaultConstantsPath(), "../tools/m0/out/constants.json", "live default");
        harness.setAffirm(false);
        assertEq(harness.defaultConstantsPath(), "../tools/m0/out/constants.json", "fork default");
        vm.chainId(31_337);
        assertEq(harness.defaultConstantsPath(), "../tools/m0/out/constants.json", "local default");
    }

    // ── (b) no account-0 fallback on ANY public chain ─────────────────────────

    function test_run_revertsWithoutDeployerAddress_onTestnet() public {
        vm.chainId(46_630);
        vm.expectRevert(Deploy.MissingDeployerAddress.selector);
        harness.run();
    }

    function test_run_revertsWithoutDeployerAddress_onLive() public {
        vm.chainId(4663);
        harness.setAffirm(true); // affirmed mainnet ⇒ Live ⇒ a real key is mandatory (no fallback)
        vm.expectRevert(Deploy.MissingDeployerAddress.selector);
        harness.run();
    }

    /// @notice A 4663 FORK run (no affirmation) does NOT demand a real key — it uses the keyless
    ///         anvil fallback like Local (the docker one-shot supplies account-0). It therefore
    ///         proceeds past the signer gate; with the default mainnet constants (zero treasury Safe,
    ///         O-6) it then fails closed at `TreasurySafeUnset`, never at `MissingDeployerAddress`.
    function test_run_forkMode_usesKeylessFallback_thenO6FailClosed() public {
        vm.chainId(4663);
        harness.setAffirm(false);
        vm.expectRevert(Deploy.TreasurySafeUnset.selector);
        harness.run();
    }

    // ── (c) testnet externals come from the constants file, never hardcodes ───

    function test_testnetExternals_readFromConstantsFile() public {
        vm.chainId(46_630);
        (address weth, address v3Factory, address npm, address swapRouter02, address quoterV2, address treasury) =
            harness.loadAndResolveFrom(FIXTURE);

        // Exactly the fixture's sentinel addresses…
        assertEq(weth, 0x1111111111111111111111111111111111111111, "weth from external.weth");
        assertEq(v3Factory, 0x2222222222222222222222222222222222222222, "v3Factory from external.v3Factory");
        assertEq(npm, 0x3333333333333333333333333333333333333333, "npm from external.positionManager");
        assertEq(swapRouter02, 0x4444444444444444444444444444444444444444, "swapRouter02 from external");
        assertEq(quoterV2, 0x5555555555555555555555555555555555555555, "quoterV2 from external");
        assertEq(treasury, 0x6666666666666666666666666666666666666666, "treasury from external.treasurySafe");

        // …and provably NOT the mainnet literals (no hardcoded fallback path exists).
        assertTrue(weth != MAINNET_WETH, "testnet weth must not fall back to the 4663 literal");
        assertTrue(v3Factory != MAINNET_V3_FACTORY, "testnet v3Factory must not fall back to the 4663 literal");
        assertTrue(npm != MAINNET_NPM, "testnet NPM must not fall back to the 4663 literal");
    }

    // ── (d) O-6 fail-closed treasury guard applies to testnet ─────────────────

    function test_testnetZeroTreasury_failsClosed() public {
        vm.chainId(46_630);
        vm.expectRevert(Deploy.TreasurySafeUnset.selector);
        harness.loadAndResolveFrom(FIXTURE_ZERO_TREASURY);
    }

    // ── (e) constants-file/chain pin ───────────────────────────────────────────

    function test_constantsChainIdMismatch_failsClosed() public {
        // The fixture declares chainId 46630; broadcasting it to 4663 must fail closed pre-spend.
        vm.chainId(4663);
        vm.expectRevert(abi.encodeWithSelector(Deploy.ConstantsChainIdMismatch.selector, 4663, 46_630));
        harness.loadAndResolveFrom(FIXTURE);
    }
}
