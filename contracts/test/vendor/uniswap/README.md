# Vendored Uniswap V3 artifacts (test-only)

PRECOMPILED official Uniswap V3 creation bytecode, deployed locally via `vm.getCode` in
`test/harness/V3Fixture.sol` for the gate-2 invariant-6 (pool-griefing) and migrator/vault unit
suites. This is the only way to exercise the REAL `slot0`/`swap`/`mint` math under the single
`solc 0.8.35` pin — Uniswap v3-core is `0.7.6` and cannot be compiled in this workspace.

| File | Source | Notes |
|---|---|---|
| `UniswapV3Factory.json` | unpkg `@uniswap/v3-core@1.0.1` (`artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json`) | constructor pre-enables the 1% tier (10000→200); embeds the pool creation code |
| `NonfungiblePositionManager.json` | unpkg `@uniswap/v3-periphery@1.4.4` (`artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json`) | constructor `(factory, WETH9, tokenDescriptor)`; baked-in `POOL_INIT_CODE_HASH` matches the core above |

Both artifacts have empty `linkReferences` (no library linking needed). These are TEST FIXTURES —
production deploys read the -confirmed on-chain addresses from `tools/m0/out/constants.json`,
and gate-3 fork tests (M1-12) hit the real deployment + real WETH `0x0Bd7…AD73`.

Committed intentionally so the suite runs offline and reproducibly.
