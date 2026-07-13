# How this documentation is organized

ROBBED_ follows the documentation layout of flagship public DeFi repos (Uniswap, Aave, OpenZeppelin, Compound, Balancer, et al.): everything lives under **`docs/`**, split by audience into a **user-facing** part and a **developer** part, with no internal planning artifacts in the tree.

1. **User docs — the product in plain language — live in [`docs/users/`](users).** How token creation, trading, fees, and graduation work for someone *using* ROBBED_ (start at [`users/overview.md`](users/overview.md)).
2. **Developer docs — the technical reference — live in [`docs/developers/`](developers).** System architecture, the per-component designs (contracts, indexer, api, web), the threat model, and the operational [`runbooks/`](developers/runbooks) (for operators/maintainers). The normative [`spec.md`](spec.md) completes the developer surface.
3. **Contributor & security process docs also live in `docs/`** — [`CONTRIBUTING.md`](CONTRIBUTING.md) (process) and [`SECURITY.md`](SECURITY.md) (disclosure). GitHub still surfaces its *Contributing* and *Security* links when these live under `docs/`. The repo root keeps only the orientation [`README.md`](../README.md) and the AI-assistant guide `CLAUDE.md`; per-package usage docs colocate with their code (`contracts/README.md`, `apps/web/e2e/README.md`, `tools/deploy/komodo/README.md`, …).

Security reviews are not committed as files: each gate's review is recorded in the pull request that closes it (history in git).

## Map

```
README.md                       what ROBBED_ is; architecture; monorepo map; quickstart
CLAUDE.md                       distilled hard rules + stack facts for AI-assisted development

docs/
├── README.md                   how the docs are organized (this file)
├── spec.md                     THE protocol spec (single source of truth; §12 resolved decisions, §13 open items)
├── CONTRIBUTING.md             authority chain, PR/branch flow, test tiers, hard rules, validate.sh
├── SECURITY.md                 vulnerability disclosure, patch policy, bounty status
├── users/                      USER-FACING product docs — start here if you're using ROBBED_
│   ├── overview.md             the token lifecycle (create → curve → graduate) — start here
│   ├── token-creation.md       launching a token — inputs, costs, what deploys, creator limits
│   ├── trading.md              curve pricing, slippage, anti-snipe, sells-always-open, confirmations
│   ├── fees.md                 every fee with numbers + recipients; creator fees (0 in v1, §7)
│   └── graduation.md           threshold, ReadyToGraduate, permissionless graduate(), the V3 pool
└── developers/                 DEVELOPER technical reference (+ operational runbooks)
    ├── architecture.md         system overview: contracts ↔ indexer ↔ API ↔ web, data flows, infra
    ├── contracts.md            the six contracts — curve math, graduation, fee escrow, deploy
    ├── indexer.md              event families, tables, candles, watermarks, WS channels
    ├── api.md                  REST/WS surface, uploads, canonicalization, moderation, auth
    ├── web.md                  pages, trade lifecycle, copy rules, OG, wallet integration
    ├── threat-model.md         design-time threat model (adversaries, attack trees, obligations)
    └── runbooks/               operational procedures for operators/maintainers: docker, testnet,
                                testnet-lifecycle (on-chain tx-hash evidence record), deploy,
                                environments, toolchain, prod-images, env-inventory (machine-checked)

apps/web/e2e/
├── user-flows.md               the e2e flow catalog (machine-parsed — see below)
└── user-flows-waivers.md       per-flow layer waivers (machine-parsed)
```

## Adding a new doc? Decision table

| You are documenting… | It goes… |
|---|---|
| Protocol/system behavior (what the system *is*) | the owning `docs/developers/*.md` (user-facing behavior → `docs/users/*.md`) — or a spec amendment (§12/§13) if it changes a guarantee |
| A system-wide view or data flow | `docs/developers/architecture.md` |
| An operational procedure (deploy, run, recover) | `docs/developers/runbooks/<topic>.md` |
| Contributor process (branching, tests, style) | `docs/CONTRIBUTING.md` |
| A test catalog or harness guide | **next to the tests** (e.g. `apps/web/e2e/`), never in `docs/` |
| A security review / audit / gate report | the pull request that closes the gate (not a committed file; history in git) |
| How to use one package/app | a colocated `README.md` in that package |
| A plan, progress tracker, status report, decision ledger, traceability matrix | **nowhere — do not commit it.** No flagship public DeFi repo ships these (survey 2026-07-12); they live in issues/PRs/project tools. Removed from this repo 2026-07-12; history is in git. |

The `docs-placement` check in `scripts/doc-check.ts` enforces this mechanically: forbidden tracker-style files fail CI, and any `.md` under `docs/` outside the sanctioned set (`README.md`, `spec.md`, `CONTRIBUTING.md`, `SECURITY.md`, `users/`, `developers/` — the latter includes `developers/runbooks/`) is rejected with a pointer to this table.

## Machine-consumed files — do not move these blindly

| File | Parsed by | Breaks if moved |
|---|---|---|
| `docs/spec.md` | `scripts/doc-check.ts` (every `§N.M` reference in docs resolves against it) | § reference validation |
| `docs/developers/runbooks/env-inventory.md` | `scripts/env-sync-check.ts` (⇄ every `.env.example`, both directions; also doc-check check g + the `env-sync` stage of `validate.sh`) | env drift enforcement |
| `apps/web/e2e/user-flows.md` + `user-flows-waivers.md` | `scripts/e2e-coverage.ts` (`bun run e2e:coverage` — 1:1 `@flow` spec per catalog ID, exact layer assertions) | the e2e coverage gate |
| everything in `docs/**` + root `*.md` | `scripts/doc-check.ts` (links/anchors, § refs, canonical LP copy, fences, m0 markers, env-sync, docs-placement) | CI `docs` job |

Moving any of these requires updating every consumer in the same change and re-running: `bun scripts/doc-check.ts`, `bun scripts/env-sync-check.ts`, `bun run e2e:coverage`. The docs-placement check additionally asserts these paths exist, so an un-repointed move fails loudly in CI rather than silently disabling a gate.

Ground rule: **`docs/spec.md` wins every conflict.** Everything else here is a derived view — if it drifts, it gets fixed; it never wins.
