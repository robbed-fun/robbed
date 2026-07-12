# ROBBED_ — Security Properties

The normative security invariants of the protocol and the gate program that proves them. Source of truth: [`spec.md`](spec.md) §10 (and the sections cited per property). The executable form of these properties is the Foundry test suite — `contracts/test/invariant/` (invariants), `contracts/test/fuzz/`, and `contracts/test/fork/` (lifecycle vs the real chain); this doc is the index, the tests are the proof.

## Protocol invariants (spec §10, gate 2)

1. **`k` is non-decreasing from trades** — the virtual-reserve product can never shrink from any buy/sell sequence.
2. **Curve solvency under any fill sequence** — `balance ≥ realEthReserves` at all times; any circulating token amount can be sold and paid.
3. **Exact fee accounting** — fees are computed in-contract (§4.1), accrue in-contract, and are withdrawn only by the permissionless, non-phase-gated `sweepFees()` (§12.25); accrued + swept always reconciles to the sum of per-trade fees.
4. **Sells can never be blocked** — no flag, pause, or code path gates curve sells; the only pause flags are `pauseCreates`/`pauseBuys`; zero pause authority post-graduation (§6.5). A reverting/hostile treasury cannot freeze sells (§12.25 pull-payment). The deterministic `ReadyToGraduate` lock (§12.12) is a protocol state exitable by permissionless `graduate()`, not a pause.
5. **Graduation fires exactly once and is always reachable** — single-fire, permissionless, caller-rewarded; a failed migration reverts retriably rather than bricking the curve.
6. **Post-graduation the curve holds zero value** — no residual ETH or tokens beyond swept fees and documented dust destinations (token dust → `0xdEaD`, WETH dust → treasury, §12.13).
7. **A pre-seeded/donated/swapped V3 pool cannot cause a hostile-ratio mint** — the pool is created+initialized at token creation at the deterministic graduation price; the migrator arbs a polluted price back within its bounded budget (§12.33) or reverts `PoolPriceUnrecoverable` — it never mints at a hostile ratio (§6.3).
8. **No actor sequence extracts ETH beyond fair curve value** — fuzzed adversarial sequences (snipe, sandwich, wash, grief) cannot net ETH beyond what curve math grants.
9. **LP principal is unreachable** — the LP NFT is held by `LPFeeVault`: no owner, no withdraw, sole external function `collect(tokenId)` paying accrued V3 fees to the fixed treasury (§6.3, §6.6). LP principal permanently locked; trading fees claimable by treasury.
10. **Confirmation-tier honesty** (off-chain) — indexed state is monotonic soft-confirmed → posted-to-L1 → finalized (§2.1, §12.20); nothing soft-confirmed ever renders as unqualified-final.

## The gate program (spec §10 — all 10 required before caps lift)

| # | Gate | Proof artifact |
|---|---|---|
| 1 | Static analysis: Slither zero-unexplained, Aderyn, solhint, `forge fmt` in CI | CI + `contracts/slither.config.json` triage DB |
| 2 | Foundry unit + fuzz + invariants (the list above) | `contracts/test/{unit,fuzz,invariant}` |
| 3 | Fork tests vs the live chain (real V3 factory/NPM, real WETH) | `contracts/test/fork` |
| 4 | Mutation testing on curve + migrator math — suite must kill the mutants | `contracts/reports/mutation/` |
| 5 | Multi-model LLM audit (≥3 frontier models) with a dispositioned findings register | `audits/` |
| 6 | Economic red-team on fork: sniper/sandwich/wash sims under FCFS, parameterized against observed bot patterns (§2.2) | gate report in `audits/` |
| 7 | **Capped beta (mandatory):** global TVL + per-token caps in factory config, invariant monitoring + alerting, kill-switch = pause creates/buys only | monitoring configs, `docker/monitoring/` |
| 8 | Public bug bounty live before caps lift | [SECURITY.md](../SECURITY.md) (terms TBD) |
| 9 | Explicit decision gate on commissioning an external firm review/contest before caps lift | recorded decision |
| 10 | Published known-risks doc: no-firm-audit disclosure, single-sequencer dependency, soft-confirmation semantics, centralized listing moderation, heuristic organic-activity metrics | public doc at beta |

Completed reviews and their findings live in [`audits/`](../audits/README.md).
