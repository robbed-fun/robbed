# contracts/ — Solidity + Foundry (owner: robbed-contracts)

LaunchToken, CurveFactory, BondingCurve, Router, V3Migrator, LPFeeVault, CreatorVault + `interfaces/`, `errors/`, `libs/`; OZ v5 vendored in `lib/` (committed). Architecture template: Gnad.fun (spec §4.1) — take Factory→Curve→Token, the router entrypoint, virtual-reserve math, custom errors, the event taxonomy; drop its caller-supplied fees, V2 graduation, bespoke multisig, version ranges, and UNLICENSED.

Read first: spec §2, §4.1, §6 (all subsections), §10. The hard rules for this subtree load with it (`.claude/rules/solidity-orbit.md`); `contracts/README.md` has the deeper tour.

## Commands

- `forge fmt --check && forge build && forge test` — tier floor: unit + fuzz + **invariant** suites green
- `FOUNDRY_PROFILE=fork forge test` — fork tests vs the live chain; required for lifecycle changes
- `slither . --config-file slither.config.json --fail-low` — zero unexplained findings; dispositions live in `slither.triage.json` / `slither.db.json` (re-triage after line shifts)
- `bun script/codegen-abi.ts` / `bun script/codegen-addresses.ts` — regenerate the COMMITTED artifacts in `packages/shared` after any interface/deploy change (owned by robbed-shared; never hand-edit)
- Deploys: `script/Deploy.s.sol`; testnet env emit: `bun script/emit-testnet-env.ts`

## Security gates (spec §10 — all 10 required before caps lift)

Invariants the suite must hold: `k` non-decreasing from trades; curve solvency under any fill sequence; exact fee accounting; graduation single-fire and reachable; post-grad curve holds zero value; pre-seeded/donated/swapped V3 pool cannot cause hostile-ratio mint; no actor sequence extracts ETH beyond fair curve value.

Gate sign-off = **robbed-security** (adversarial: it refutes, never fixes — findings come back here). Every contract diff gets an adversarial security review before merge, recorded on the PR.

## Deploy-time asserts (§12.28)

Uniswap v3 is confirmed on 4663, but still assert at deploy: `factory.feeAmountTickSpacing(10000) == 200`, `NPM.factory()` / `NPM.WETH9()`. Trade fee stays 1%. Compiler pin `0.8.35` must be confirmed against Robinhood Blockscout verification before first deploy (§6.7).
