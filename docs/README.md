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
├── how-it-works/
│   ├── contracts.md            the six contracts: curve math, graduation, fee escrow, deploy
│   ├── indexer.md              event families, tables, candles, confirmation watermarks, WS channels
│   ├── api.md                  REST/WS surface, uploads, canonicalization, moderation, auth
│   └── web.md                  pages, trade lifecycle, copy rules, OG, wallet integration
├── security-properties.md      the protocol invariants + 10-gate program (points at the test suites)
├── threat-model.md             design-time threat model (adversaries, attack trees, obligations)
├── runbooks/                   operational procedures: docker, testnet, deploy, environments,
│                               toolchain, prod-images, env-inventory (machine-checked, see below)
├── design/                     product/visual design rationale (redesign directive)
└── Robbed.html                 design mockup — PATH FROZEN (40+ code comments cite docs/Robbed.html)

audits/
├── README.md                   index table: date / commit / reviewer / scope / report link
└── <date>_<review>.md          each review as delivered, findings + dispositions

<<<<<<< HEAD
apps/web/e2e/
├── user-flows.md               the e2e flow catalog (machine-parsed — see below)
└── user-flows-waivers.md       per-flow layer waivers (machine-parsed)
=======
Owner column per development-flow.md §4 plus the P-9 ownership ratifications (implementation-plan Conventions). "Machine consumers" names the script/tool that parses the file — a doc with a machine consumer has a **frozen path**.

| File | Genre | Owner | Machine consumers | Key relationships |
|---|---|---|---|---|
| `../launchpad-spec.md` | NORMATIVE | robbed-architect | `scripts/doc-check.ts` (§-ref resolution target); `.claude` hooks/agents hardcode the path | **Governs everything.** §12 = resolved decisions (fed by decisions.md), §13 = open items |
| `../CLAUDE.md` | NORMATIVE | robbed-architect | Claude Code session bootstrap; `.claude/hooks/check-hard-rules.sh` enforces its hard rules | Distills the spec; read alongside it every task |
| [`architecture.md`](architecture.md) | DESIGN | robbed-architect | — | Derived view of spec + service docs; if it drifts, it gets fixed, it never wins |
| [`services/contracts.md`](services/contracts.md) | DESIGN | robbed-contracts | doc-check named-doc refs; plan verify clauses cite the path | Transcribed by `contracts/**`; economics contract with M0 (`tools/m0`) |
| [`services/indexer.md`](services/indexer.md) | DESIGN | robbed-indexer | same | Transcribed by `apps/indexer`; owns event-family → table shapes |
| [`services/api.md`](services/api.md) | DESIGN | robbed-indexer | same | Transcribed by `apps/api`; §5 module map assigns `packages/shared` content ownership |
| [`services/web.md`](services/web.md) | DESIGN | robbed-frontend | same | Transcribed by `apps/web`; copy rules + e2e matrix source |
| [`threat-model.md`](threat-model.md) | DESIGN (adversarial) | robbed-security | plan verify clauses cite the path | Feeds gate-5 prompts, gate-6 scenarios, gate-10 known-risks (spec §10) |
| [`design/robbed-redesign-plan.md`](design/robbed-redesign-plan.md) | DESIGN (visual) | robbed-architect | — | Source: `Robbed.html` mockup; implemented by robbed-frontend; recorded spec §12.50 |
| [`development-flow.md`](development-flow.md) | PROCESS | robbed-architect | cited by `.claude/agents/*` + commands | The process contract: authority chain, docs-precede-code, ambiguity protocol, ratification |
| [`implementation-plan.md`](implementation-plan.md) | EXECUTION | robbed-architect | `/goal` command (checkbox state authority) | Master plan; per-service plans are detail under it, never a second source of truth |
| [`plans/*-plan.md`](plans/README.md) | EXECUTION | per service agent (plans/README table) | doc-check (unique basenames since 2026-07-12) | Detail keyed to master item IDs (`⇐ M1-8`); master plan wins disagreements |
| [`goal-completion-plan.md`](goal-completion-plan.md) | EXECUTION (goal-scoped) | robbed-architect | — | Cross-service sequencing + audit-remediation layer **subordinate to `implementation-plan.md`** (every checkbox flips only there, via `/goal`); its D-1…D-4 decision points are dispositioned in `decisions.md` §15. Lives at docs root beside the master plan (cross-service, architect-owned, referenced by the master plan); moves to `archive/` when the goal closes |
| [`decisions.md`](decisions.md) | LEDGER | robbed-architect | cited by `.claude/agents/*` + commands | Append-mostly register; decided items land in spec §12, open ones mirror §13 |
| [`traceability.md`](traceability.md) | LEDGER | robbed-architect (via `/trace`) | `/trace` command maintains it | Derived requirements matrix; gaps route to the architect, never patched around |
| [`security/findings-m1.md`](security/findings-m1.md) | LEDGER | robbed-security | plan verify clauses cite the path | Gate register; findings route back to robbed-contracts with dispositions |
| [`review/findings-*.md`](review/README.md) | LEDGER | robbed-architect | — | Disposition worklists feeding decisions.md / spec §12 and plan items |
| [`user-flows.md`](user-flows.md) | CATALOG | robbed-frontend (author) · robbed-architect (ratifier) | **`scripts/e2e-coverage.ts`** (I-5a gate, 44 flows) | Derived from spec §5 + web.md; sanctioned exception to root-architect ownership (P-9) |
| [`user-flows-waivers.md`](user-flows-waivers.md) | CATALOG | same pair | **`scripts/e2e-coverage.ts`** | Companion waiver table; P-7 layer-honesty rules |
| [`runbooks/env-inventory.md`](runbooks/env-inventory.md) | CATALOG (housed in runbooks/) | robbed-architect (P-1) | **`scripts/env-sync-check.ts`** (standalone + doc-check check g + `validate.sh` env-sync stage) | Authoritative per-variable table; `.env.example`s sync against it both directions |
| [`runbooks/deploy.md`](runbooks/deploy.md), [`deploy-komodo-cloudflare.md`](runbooks/deploy-komodo-cloudflare.md), [`environments.md`](runbooks/environments.md) | RUNBOOK | robbed-architect (P-9) | plan verify clauses cite these paths | Operator transcription of deploy/hosting decisions (spec §12.44–46 range, §12.52) |
| [`runbooks/toolchain.md`](runbooks/toolchain.md), [`testnet.md`](runbooks/testnet.md) | RUNBOOK | robbed-contracts (P-9) | same | Foundry/solc pin (O-5) + testnet lifecycle procedures |
| [`runbooks/docker.md`](runbooks/docker.md), [`prod-images.md`](runbooks/prod-images.md) | RUNBOOK | robbed-indexer (P-9) | same | Compose stack + production image procedures |
| [`archive/*`](archive/README.md) | ARCHIVE (ledger annex) | robbed-architect | — | Completed/superseded plans, provenance only; each entry names completion date + superseding record |
| `Robbed.html` | DESIGN asset (not md) | robbed-architect | 40+ code comments in `apps/web` + `apps/api` cite `docs/Robbed.html` — **path frozen** | Mockup source for `design/robbed-redesign-plan.md` |

All of `docs/**/*.md` plus the root docs are additionally checked mechanically by `scripts/doc-check.ts` (links/anchors, §-refs, canonical LP copy, fences, `m0:` constant markers, env-sync) on every CI push.

## 3. Relationship diagram

```mermaid
flowchart TD
  subgraph N[NORMATIVE]
    SPEC["launchpad-spec.md<br/>(§12 decided · §13 open)"]
    CM["CLAUDE.md<br/>(hard rules)"]
  end
  subgraph P[PROCESS]
    DF["development-flow.md"]
  end
  subgraph D[DESIGN]
    ARCH["architecture.md (derived)"]
    SVC["services/*.md"]
    TM["threat-model.md"]
    RD["design/redesign-plan + Robbed.html"]
  end
  subgraph E[EXECUTION]
    IP["implementation-plan.md (/goal)"]
    PP["plans/*-plan.md"]
  end
  subgraph L[LEDGERS]
    DEC["decisions.md"]
    TR["traceability.md (/trace)"]
    SF["security/findings-m1.md"]
    RF["review/findings-*.md"]
  end
  subgraph C[CATALOGS]
    UF["user-flows.md + waivers"]
    EI["runbooks/env-inventory.md"]
  end
  subgraph R[RUNBOOKS]
    RB["runbooks/*.md"]
  end
  CODE[("code: contracts/ · apps/ · packages/")]
  E2E[["scripts/e2e-coverage.ts"]]
  ENVS[["scripts/env-sync-check.ts"]]
  DCK[["scripts/doc-check.ts (all docs)"]]

  SPEC --> CM --> SVC --> PP --> CODE
  SPEC --> ARCH
  SPEC --> TM
  DF -. "governs how every layer changes" .-> SVC
  IP --> PP
  DEC -- "decided items land in §12" --> SPEC
  RF -- "dispositions" --> DEC
  SF -- "findings → plan items" --> IP
  TR -. "verifies coverage of" .- SPEC
  SVC --> UF --> E2E
  RD --> SVC
  EI --> ENVS
  SVC -- "transcribed into" --> RB
  C ~~~ DCK
>>>>>>> 3edcadd (docs(spec): §12.50(f) Discover deviation, §12.53 OG relocation, §12.48c read-derivation + D-2/D-3/D-4 rulings)
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

The `docs-placement` check in `scripts/doc-check.ts` enforces this mechanically: forbidden tracker-style files fail CI, and any `.md` under `docs/` outside the sanctioned set (`README.md`, `spec.md`, `architecture.md`, `security-properties.md`, `threat-model.md`, `how-it-works/`, `runbooks/`, `design/`) is rejected with a pointer to this table.

<<<<<<< HEAD
## Machine-consumed files — do not move these blindly
=======
- **NORMATIVE** — never a new file. New rules amend the spec (§12/§13 via the ambiguity protocol) or CLAUDE.md. Both stay at repo root.
- **DESIGN** — a new *service* gets `services/<service>.md` (owned by its agent); product/visual design artifacts go in `design/`; system-wide views amend `architecture.md`.
- **PROCESS** — amend `development-flow.md`; do not fork process docs.
- **EXECUTION** — new master items go in `implementation-plan.md`; per-service detail in `plans/<service>-plan.md`; a rare *cross-service, goal-scoped* sequencing doc (e.g. `goal-completion-plan.md`) sits at the docs root beside the master plan and is archived on completion. **Basenames must stay unique across `docs/`** (the `-plan` suffix exists because an `api.md` living in both `plans/` and `services/` broke doc-check named-doc resolution; decisions.md §14).
- **LEDGERS** — decisions → a row in `decisions.md` (spec §12 entry if it amends the spec); security gate findings → `security/`; review dockets → `review/findings-YYYY-MM-DD*.md`. Append-mostly: never rewrite dispositioned rows.
- **CATALOGS** — only with an accompanying script consumer and an architect ratification; document the parse contract in the file header (see `user-flows.md`).
- **RUNBOOKS** — `runbooks/<topic>.md`, authored by the owning item's agent per P-9, architect ratifies.
- **Completed/superseded plans** — move to `archive/` with completion date + superseding pointer; update all inbound references (grep) in the same change.
>>>>>>> 3edcadd (docs(spec): §12.50(f) Discover deviation, §12.53 OG relocation, §12.48c read-derivation + D-2/D-3/D-4 rulings)

| File | Parsed by | Breaks if moved |
|---|---|---|
| `docs/spec.md` | `scripts/doc-check.ts` (every `§N.M` reference in docs resolves against it) | § reference validation |
| `docs/runbooks/env-inventory.md` | `scripts/env-sync-check.ts` (⇄ every `.env.example`, both directions; also doc-check check g + the `env-sync` stage of `validate.sh`) | env drift enforcement |
| `apps/web/e2e/user-flows.md` + `user-flows-waivers.md` | `scripts/e2e-coverage.ts` (`bun run e2e:coverage` — 1:1 `@flow` spec per catalog ID, exact layer assertions) | the e2e coverage gate |
| `docs/Robbed.html` | 40+ code comments in `apps/web` + `apps/api` cite the exact path | design-source traceability |
| everything in `docs/**` + root `*.md` | `scripts/doc-check.ts` (links/anchors, § refs, canonical LP copy, fences, m0 markers, env-sync, docs-placement) | CI `docs` job |

Moving any of these requires updating every consumer in the same change and re-running: `bun scripts/doc-check.ts`, `bun scripts/env-sync-check.ts`, `bun run e2e:coverage`. The docs-placement check additionally asserts these paths exist, so an un-repointed move fails loudly in CI rather than silently disabling a gate.

Ground rule: **`docs/spec.md` wins every conflict.** Everything else here is a derived view — if it drifts, it gets fixed; it never wins.
