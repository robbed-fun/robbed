# Contributing to ROBBED_

Thanks for contributing. This project is spec-driven: [`spec.md`](spec.md) is the single source of truth; [`../CLAUDE.md`](../CLAUDE.md) maps the repo and `.claude/rules/` distills the hard rules (path-scoped, loaded with the files they govern; per-workspace depth lives in nested `CLAUDE.md` files beside the code). When code and spec disagree, the spec wins — flag the conflict, don't reinterpret it.

## Authority chain

```
docs/spec.md                      ← root authority; §12 resolved decisions, §13 open items
  └── CLAUDE.md + .claude/rules/  ← repo map + distilled hard rules (violations are bugs, not style)
        └── docs/developers/*.md   ← implementable designs, one per component
              └── code            ← a transcription of the design doc; nothing more, nothing less
```

- **Docs precede code.** Every change must be traceable to a section of a `docs/developers/*.md` doc (or a spec §) that describes the behavior. New behavior → update the design doc first (same PR is fine; the doc diff must stand on its own).
- **Never self-resolve spec ambiguities.** If the spec is silent or self-contradictory, raise it — resolved decisions are recorded in spec §12 (numbered, dated), genuinely open questions in §13 with an owner. Until resolved, proceed only on paths the ambiguity doesn't touch.
- Official library documentation beats memory (always check current docs before coding), but the spec beats library docs.

## Hard rules (auto-enforced; violating them fails CI)

1. **Never use `block.number`** in contract logic — on Orbit chains it returns an L1 estimate. Only `ArbSys(address(100)).arbBlockNumber()` or `block.timestamp` (spec §2, §6.5).
2. **One exact compiler pin, no ranges** (`pragma solidity 0.8.35;` — no `^`, `>=`) across the whole Foundry workspace (spec §6.7).
3. **Sells can never be paused.** No flag, modifier, or code path may block curve sells. The only pause flags are `pauseCreates`/`pauseBuys`; zero pause authority post-graduation (spec §6.5, §12.12, §12.25).
4. **Fees are computed in-contract** — never caller-supplied (spec §4.1).
5. **LP copy is one exact sentence:** "LP principal permanently locked; trading fees claimable by treasury." Never "burned" (spec §12.14; grep-enforced).
6. **Never hardcode market metrics** (ETH/USD, TVL, volumes, thresholds) — cite source + timestamp or query live (spec §2).
7. **Immutable contracts, no proxies**; OZ v5 (SafeERC20/ReentrancyGuard/Ownable2Step); treasury = Gnosis Safe, never a bespoke multisig (spec §6, §6.6). MIT license everywhere.
8. **Anti-drift:** any cross-service type/schema/ABI lives once in `packages/shared` (Zod-first, types via `z.infer`); apps import, never redeclare. Internal deps use `workspace:*`.

These are enforced by `.claude/hooks/check-hard-rules.sh`, CI greps, and `scripts/doc-check.ts` — a violation is a bug, not a style issue.

## Branch & PR flow

- Branch from `main` (`feat/…`, `fix/…`, `docs/…`); PRs into `main`.
- The pre-commit hook (`.githooks/pre-commit`, installed by `pnpm install` via the `prepare` script) runs the **entire local CI mirror** — `scripts/validate.sh --staged`. Emergency bypass: `SKIP_VALIDATION=1 git commit …` (CI still enforces everything).
- Deviations forced by open items reference the item ID (e.g. `O-5`) in the commit message.
- Contract diffs additionally get an adversarial security review before merge (invariants in [spec.md](spec.md) §10; the review is recorded on the PR).

## Test requirements per tier

| Tier | Runner | Command | Floor |
|---|---|---|---|
| Contracts | Foundry | `cd contracts && forge fmt --check && forge build && forge test` | unit + fuzz + **invariant** suites green; fork tests vs live chain (`FOUNDRY_PROFILE=fork`) for lifecycle changes |
| Static analysis | Slither | `slither contracts --config-file contracts/slither.config.json --fail-low` | zero unexplained findings (triage DB dispositions required) |
| TS packages | Bun | `bun test` (per package) | every `packages/*` change ships tests; canonicalizer changes need exhaustive vectors |
| Web units | Vitest | `cd apps/web && bun run test` | copy-lint + component tests green |
| E2E | Playwright | `bun run e2e` (needs the local stack: `bun run dev:d`) | flows assert on-chain → indexed → UI |
| E2E coverage | static | `bun run e2e:coverage` | every flow in `apps/web/e2e/user-flows.md` has a 1:1 `@flow` spec asserting exactly its declared layers |
| Docs | static | `bun scripts/doc-check.ts` | links/anchors, § refs, LP copy, fences, env-sync, docs placement |

## validate.sh — the single local entrypoint

```bash
bun run validate        # everything fast (mirrors CI)
bun run validate:full   # + slow stages (web production build)
scripts/validate.sh --staged   # what the pre-commit hook runs
```

Stages skip gracefully (and say so) when a tool isn't installed — a skip is reported, never silent.

## Commit messages

Conventional Commits, enforced deterministically by `.githooks/commit-msg` (installed with the other hooks via `pnpm install` → `core.hooksPath=.githooks`):

- **Header:** `type(scope)?: subject` — types `feat|fix|docs|test|refactor|perf|chore|ci|build`; scope optional, lowercase, from the workspace vocabulary (`web`, `api`, `indexer`, `contracts`, `shared`, `e2e`, `ci`, `infra`, `docs`, `plan`); subject in imperative mood, no trailing period, header ≤ 72 chars.
- **Body:** explains WHAT and WHY (not how), wrapped ~100 cols, bullets welcome. Cite spec § refs where a change implements one (e.g. `spec §12.25`); reference open-item IDs (e.g. `O-5`) when a deviation is forced by one.
- **Scope discipline:** one logical change per commit; no `WIP` commits on `main`.
- AI-assisted commits keep their `Co-Authored-By:` trailer.
- `Merge …`, `Revert …`, `fixup!`/`squash!` headers pass the hook untouched.

Good:

```
fix(ci): pnpm installs in apps job, slither-action >=Py3.10
feat(web): reusable DataTable + EventTape stable-ref rewrite

Discover/Portfolio tables now share one TanStack Table v8 wrapper (spec §5.1 list
surfaces); EventTape re-renders dropped ~90% via stable row refs.
```

Bad:

```
Fixed stuff.                      ← no type, past tense, trailing period, says nothing
feat: WIP new trade widget + misc cleanups + CI fix   ← WIP; three unrelated changes
```

## Style

- Solidity: `forge fmt` (CI-enforced), custom errors, NatSpec on external surfaces.
- TypeScript: strict mode, Zod-first for wire-crossing shapes, no `any` in shared packages.
- Copy: confirmation tiers surfaced wherever tx state is shown; product is a soft-confirmed AMM — never claim "order book" / "real-time exchange" semantics.

## Adding documentation

Placement rules live in [README.md](README.md). Short version: protocol behavior → `docs/`; contributor process → this file; test catalogs → next to the tests; security reviews → the pull request that closes the gate; plans/trackers/status documents → nowhere (don't commit them).
