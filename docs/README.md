# How this documentation is organized

ROBBED_ follows the documentation layout of flagship public DeFi repos (Uniswap, Aave, OpenZeppelin, Compound, Balancer, et al.): a **two-bucket split** with no internal planning artifacts in the tree.

1. **Protocol docs — "how everything works" — live in `docs/`.** The spec, per-component designs, security properties, threat model, and operational runbooks.
2. **Developer docs live at the repo root and next to the code.** README (orientation), CONTRIBUTING (process), SECURITY (disclosure), plus colocated per-package READMEs (`contracts/README.md`, `apps/web/e2e/README.md`, `tools/deploy/komodo/README.md`, …).

Security reviews get their own top-level home: **`audits/`**, with an index row per review.

## Map

```
README.md                       what ROBBED_ is; architecture; monorepo map; quickstart
CONTRIBUTING.md                 authority chain, PR/branch flow, test tiers, hard rules, validate.sh
SECURITY.md                     vulnerability disclosure, patch policy, bounty status
CLAUDE.md                       distilled hard rules + stack facts for AI-assisted development

docs/
├── spec.md                     THE protocol spec (single source of truth; §12 resolved decisions, §13 open items)
├── architecture.md             system overview: contracts ↔ indexer ↔ API ↔ web, data flows, infra
├── how-it-works/               two tiers: user-facing pages first, engineer references after
│   ├── overview.md             user-facing: the token lifecycle (create → curve → graduate) — start here
│   ├── token-creation.md       user-facing: launching a token — inputs, costs, what deploys, creator limits
│   ├── trading.md              user-facing: curve pricing, slippage, anti-snipe, sells-always-open, confirmations
│   ├── fees.md                 user-facing: every fee with numbers + recipients; creator fees (0 in v1, §7)
│   ├── graduation.md           user-facing: threshold, ReadyToGraduate, permissionless graduate(), the V3 pool
│   ├── contracts.md            engineer reference: the six contracts — curve math, graduation, fee escrow, deploy
│   ├── indexer.md              engineer reference: event families, tables, candles, watermarks, WS channels
│   ├── api.md                  engineer reference: REST/WS surface, uploads, canonicalization, moderation, auth
│   └── web.md                  engineer reference: pages, trade lifecycle, copy rules, OG, wallet integration
├── security-properties.md      the protocol invariants + 10-gate program (points at the test suites)
├── threat-model.md             design-time threat model (adversaries, attack trees, obligations)
├── runbooks/                   operational procedures: docker, testnet, testnet-lifecycle
│                               (on-chain tx-hash evidence record), deploy, environments,
│                               toolchain, prod-images, env-inventory (machine-checked)
└── Robbed.html                 design mockup — PATH FROZEN (40+ code comments cite docs/Robbed.html)

audits/
├── README.md                   index table: date / commit / reviewer / scope / report link
└── <date>_<review>.md          each review as delivered, findings + dispositions

apps/web/e2e/
├── user-flows.md               the e2e flow catalog (machine-parsed — see below)
└── user-flows-waivers.md       per-flow layer waivers (machine-parsed)
```

## Adding a new doc? Decision table

| You are documenting… | It goes… |
|---|---|
| Protocol/system behavior (what the system *is*) | the owning `docs/how-it-works/*.md` — or a spec amendment (§12/§13) if it changes a guarantee |
| A system-wide view or data flow | `docs/architecture.md` |
| An operational procedure (deploy, run, recover) | `docs/runbooks/<topic>.md` |
| Contributor process (branching, tests, style) | `CONTRIBUTING.md` |
| A test catalog or harness guide | **next to the tests** (e.g. `apps/web/e2e/`), never in `docs/` |
| A security review / audit / gate report | `audits/`, plus an index row in `audits/README.md` |
| How to use one package/app | a colocated `README.md` in that package |
| A plan, progress tracker, status report, decision ledger, traceability matrix | **nowhere — do not commit it.** No flagship public DeFi repo ships these (survey 2026-07-12); they live in issues/PRs/project tools. Removed from this repo 2026-07-12; history is in git. |

The `docs-placement` check in `scripts/doc-check.ts` enforces this mechanically: forbidden tracker-style files fail CI, and any `.md` under `docs/` outside the sanctioned set (`README.md`, `spec.md`, `architecture.md`, `security-properties.md`, `threat-model.md`, `how-it-works/`, `runbooks/`) is rejected with a pointer to this table.

## Machine-consumed files — do not move these blindly

| File | Parsed by | Breaks if moved |
|---|---|---|
| `docs/spec.md` | `scripts/doc-check.ts` (every `§N.M` reference in docs resolves against it) | § reference validation |
| `docs/runbooks/env-inventory.md` | `scripts/env-sync-check.ts` (⇄ every `.env.example`, both directions; also doc-check check g + the `env-sync` stage of `validate.sh`) | env drift enforcement |
| `apps/web/e2e/user-flows.md` + `user-flows-waivers.md` | `scripts/e2e-coverage.ts` (`bun run e2e:coverage` — 1:1 `@flow` spec per catalog ID, exact layer assertions) | the e2e coverage gate |
| `docs/Robbed.html` | 40+ code comments in `apps/web` + `apps/api` cite the exact path | design-source traceability |
| everything in `docs/**` + root `*.md` | `scripts/doc-check.ts` (links/anchors, § refs, canonical LP copy, fences, m0 markers, env-sync, docs-placement) | CI `docs` job |

Moving any of these requires updating every consumer in the same change and re-running: `bun scripts/doc-check.ts`, `bun scripts/env-sync-check.ts`, `bun run e2e:coverage`. The docs-placement check additionally asserts these paths exist, so an un-repointed move fails loudly in CI rather than silently disabling a gate.

Ground rule: **`docs/spec.md` wins every conflict.** Everything else here is a derived view — if it drifts, it gets fixed; it never wins.
