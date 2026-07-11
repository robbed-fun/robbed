# Plan — rename `hoodpad` → `ROBBED_`

**Status:** v1.0, 2026-07-10. Authored by hoodpad-architect. Implements **spec §12.46** (naming decision) and its `docs/decisions.md §9` row. This file is the *plan* — **nothing here is executed at authoring time.**

**User directive (authoritative):** "rename all project name mentions from hoodpad to robbed_ in the repo."

## 0. Convention (from §12.46 — apply verbatim)

- **Brand / display / copy / logo / OG / page titles → `ROBBED_`** (lowercase `robbed_` where the trailing blinking-cursor motif is intended). The trailing `_` is a **display motif only** — it never appears in an identifier.
- **Identifiers → `robbed` (NO underscore):** npm scope, package names, agent names/filenames, directory/service/volume names, Postgres db/role/password-var, Redis, MinIO/R2 identifiers, env-var prefixes, metric/label prefixes, Solidity generated identifiers. Rationale: `@robbed_` is not a valid npm scope and a trailing `_` is illegal/awkward in npm, Postgres, docker-compose, and Solidity grammars.
- **NOT renamed:** Solidity *type* names (`LaunchToken`, `BondingCurve`, `CurveFactory`, `Router`, `V3Migrator`, `LPFeeVault`, `CurveMath`) — product-neutral; only literal "hoodpad" NatSpec/comment strings change.

## 1. Timing gate (hard)

Execute this rename as **one focused pass** that runs:
- **AFTER** the `apps/web` redesign foundation lands (renaming `@hoodpad/*` or the live `hoodpad-*` agents mid-redesign breaks that build and the running agent identities), and
- **BEFORE** the Workers/OpenNext adaptation (P-3), so the new `wrangler.jsonc` / `open-next.config.ts` / OpenNext files and the Worker name (`robbed-web`) are authored against final `@robbed` names from the start.

## 2. Occurrence tally (2026-07-10, case-insensitive)

| Category | Editable-source matches |
|---|---|
| A. `@hoodpad/` scope specifiers (imports + deps + package names) | 214 |
| B. Agent-name refs `hoodpad-<role>` (across `.claude`, `CLAUDE.md`, docs, code) | 390 |
| C. `docs/**` prose (any-case) | 283 |
| E. `contracts/src|script|test|foundry.toml` NatSpec/comments | 54 |
| **Total editable-source (any-case, de-duped whole-repo)** | **769** |
| Generated artifacts (regenerate, do NOT hand-edit) | 496 |

Generated set (regenerate after source changes, never hand-edit): `apps/web/.next/**` (source maps — `.gitignored`), `contracts/out/**` (`forge build`), `contracts/reports/mutation/**` (gambit mutants), `pnpm-lock.yaml` (`pnpm install`), `tools/m0/out/**` (`bun tools/m0/derive.ts`).

## 3. Execution — atomic per category

Each lettered block is **one atomic commit**. Do A, B, D, E, C in that order; F is a rebuild after all source edits.

### A. npm scope `@hoodpad/*` → `@robbed/*` + EVERY consumer (single atomic commit)

If a single `@hoodpad/…` specifier is left dangling the whole workspace fails to resolve — so package renames and every consumer import land together.

1. **Package `name` fields:**
   - `package.json` → `"name": "robbed"` (root; identifier, no scope, no `_`)
   - `packages/shared/package.json` → `@robbed/shared`
   - `apps/web/package.json` → `@robbed/web`
   - `apps/api/package.json` → `@robbed/api`
   - `apps/indexer/package.json` → `@robbed/indexer`
   - `tools/m0/package.json` → `@robbed/m0`
2. **`workspace:*` deps** (`apps/{web,indexer,api}/package.json`): `"@hoodpad/shared": "workspace:*"` → `"@robbed/shared": "workspace:*"`.
3. **All import specifiers** — global replace `@hoodpad/` → `@robbed/` across every `.ts`/`.tsx`/`.json`/`.sol` under `apps/{web,indexer,api}`, `packages/shared`, `tools/m0`, `contracts/script`. Distinct subpaths that must all survive the replace: `@robbed/shared`, `@robbed/shared/abi`, `@robbed/shared/addresses`, `@robbed/shared/change24h`, `@robbed/shared/curve-quote`, `@robbed/shared/db-rows`, plus `@robbed/{api,indexer,web,m0}`.
4. **Codegen output targets** (the generators write `@robbed/…` headers/paths): `contracts/script/codegen-addresses.ts` (6 refs), `contracts/script/codegen-abi.ts`, `tools/m0/derive.ts` (generator header `@robbed/m0`). Their emitted files — `packages/shared/src/addresses.ts`, `apps/web/src/shared/config/addresses.ts`, `tools/m0/out/*` — are regenerated in step F, not hand-edited.
5. **`packages/shared` internal refs:** `packages/shared/src/index.ts`, `packages/shared/src/change24h.ts`.
6. **Command docs referencing the scope:** `.claude/commands/bootstrap.md`, `.claude/commands/m0-notebook.md`.
7. **tsconfig:** no `paths`/alias entries reference `@hoodpad` (pnpm workspace resolution handles it) — nothing to change; confirm with a grep.

Verify A: `pnpm install` (relinks workspace), then `grep -rn "@hoodpad/" --include='*.ts' --include='*.tsx' --include='*.json' --include='*.sol' . | grep -v node_modules` returns **zero**.

### B. Agent files `hoodpad-*.md` → `robbed-*.md` + EVERY reference (single atomic commit)

Rename files **and** every route reference in the same commit so no `subagent_type` dangles. Prefer `git mv` (history-preserving) over delete+create.

1. **`git mv` the six agent files:** `.claude/agents/hoodpad-{architect,contracts,indexer,frontend,security,shared}.md` → `.claude/agents/robbed-{…}.md`.
2. **Agent `name:` frontmatter** inside each file → `robbed-<role>`.
3. **Cross-agent mentions** inside each agent body (architect 2, contracts 6, frontend 5, indexer 7, security 4, shared 2).
4. **`CLAUDE.md` Agents section** (7 refs): `hoodpad-architect/contracts/indexer/frontend/security/shared` → `robbed-*`.
5. **`.claude/commands/*`** — `goal.md` hardcodes the five delegation targets (9 refs); `trace.md` (4), `doc-check.md` (3), `spec-check.md` (1), `bootstrap.md` (1), `m0-notebook.md` (1). (No `.claude/skills/` exist yet — the "goal skill" is `.claude/commands/goal.md`.)
6. **`.claude/hooks/check-hard-rules.sh`** header comment (1).
7. **Orchestrator call-sites:** every future `Agent(subagent_type: "hoodpad-*")` invocation switches to `robbed-*`. (Not a file edit — a behavioral switch that takes effect the moment the files are renamed; that is exactly why files + all refs must be one commit.)
8. **Docs/code prose naming agents as owners** (`docs/**`, `contracts/src/*` NatSpec "recorded for the hoodpad-security gate", `apps/**` owner comments, `tools/m0/derive.ts`) — fold into blocks C/D/E; they do not gate agent routing but must not lag.

Verify B: `grep -rn "hoodpad-" .claude CLAUDE.md` returns **zero**; `ls .claude/agents` shows six `robbed-*.md`.

### D. Infra / runtime identifiers (single atomic commit)

1. **`docker-compose.yml`:** project `name: hoodpad` → `robbed`; `POSTGRES_USER` default `hoodpad` → `robbed`; `POSTGRES_PASSWORD` default `hoodpad_dev_pw` → `robbed_dev_pw`; `POSTGRES_DB` default `hoodpad` → `robbed`; `MINIO_ROOT_USER` `hoodpad` → `robbed`; `MINIO_ROOT_PASSWORD` `hoodpad_dev_secret` → `robbed_dev_secret`; volume names `hoodpad_pgdata|redisdata|miniodata` → `robbed_*`; header comments. **Keep `R2_BUCKET` default `hoodpad-assets`? NO — set to `robbed-assets`** (matches the already-final external bucket, §12.45).
2. **`docker/postgres/init/01-pg_trgm.sql`** header comment.
3. **Env templates:** `.env.example`, `apps/indexer/.env.example`, `apps/web/.env.example` (header comments + the `api.hoodpad.example` / `ws.hoodpad.example` sample hostnames → `api.robbed.example` / `ws.robbed.example`).
4. **CI / hooks:** `.github/workflows/ci.yml`, `.githooks/pre-commit`, `.claude/hooks/check-hard-rules.sh` header comments.
5. **Scripts:** `scripts/doc-check.ts`, `scripts/validate.sh` header comments; `tools/m0/derive.ts` (11 refs — comments + generator identifiers, see E).
6. **Deploy runbook `docs/runbooks/deploy-komodo-cloudflare.md`:** header/body `hoodpad` prose; the `--filter @hoodpad/indexer` build commands → `@robbed/indexer`; **Worker `name: "hoodpad-web"` and `WORKER_SELF_REFERENCE service "hoodpad-web"` → `robbed-web`** (plan value, undeployed). R2 bucket `robbed-assets` and account id already correct — leave.

Verify D: `docker compose config` parses clean; `grep -niE 'hoodpad' docker-compose.yml docker/ .env.example apps/*/.env.example` returns zero.

### E. Contracts NatSpec + M0 generated identifiers (single atomic commit)

1. **`contracts/src/**` NatSpec/comment strings** only (54 matches across `LaunchToken.sol`, `BondingCurve.sol`, `CurveFactory.sol`, `Router.sol`, `V3Migrator.sol`, `LPFeeVault.sol`, `errors/Errors.sol`, `interfaces/*.sol`, `libs/CurveMath.sol`): `@title … hoodpad …` → `ROBBED_` (brand context) or `robbed` (agent-owner context, e.g. "recorded for the robbed-security gate"). **Do NOT touch contract/library/type identifiers** — only literal "hoodpad" strings.
2. **`contracts/foundry.toml`**, **`contracts/aderyn.toml`**, **`contracts/slither*.json`** header comments.
3. **`contracts/script/lib/V3Assertions.sol`**, **`contracts/script/Deploy.s.sol`** comments.
4. **M0 generator identifiers in `tools/m0/derive.ts`:** the emitted Solidity library `HoodpadConstants` → `RobbedConstants`; the TS `export const HOODPAD_CONSTANTS` → `ROBBED_CONSTANTS`; `export type HoodpadConstants` → `RobbedConstants`; console/plot title strings `hoodpad …` → `ROBBED_ …`. These are identifiers → no underscore in the CamelCase form; the SCREAMING_CASE const uses `ROBBED_CONSTANTS` (underscore is a word separator here, not the brand motif).

Verify E: `cd contracts && forge build` compiles; contract *type* names unchanged (`grep -rn 'contract \(LaunchToken\|BondingCurve\|CurveFactory\|Router\|V3Migrator\|LPFeeVault\)' contracts/src` still matches).

### C. Docs / spec prose (single atomic commit — may follow A/B/D/E)

Global `hoodpad` → `ROBBED_` (brand) or `robbed` (identifier context) across:
- **`launchpad-spec.md`** title "hoodpad — Pump.fun-style launchpad" → `ROBBED_ — Pump.fun-style launchpad`; body prose. (§12.46 itself already uses the final names.)
- **`CLAUDE.md`** title + body (agent refs already handled in B).
- **`README.md`**, **`docs/README.md`**, and all of **`docs/**`** (`architecture.md`, `decisions.md`, `development-flow.md`, `plans/*`, `services/*`, `runbooks/*`, `threat-model.md`, `traceability.md`, `user-flows*.md`, `review/findings-2026-07-09.md`). `docs/design/robbed-redesign-plan.md` already uses `robbed`.
- **DO NOT edit `docs/implementation-plan.md` in this turn's scope owner's pass without coordination** — it is actively owned by the plan/goal loop; sequence its 98 `hoodpad-*` owner refs + 2 `@hoodpad/` refs into block A/B mechanically at rename time, verified by the same greps.

### F. Regenerate artifacts (rebuild, no hand-edit)

After A–E land: `pnpm install` → `cd contracts && forge build` → `bun tools/m0/derive.ts` (regenerates `tools/m0/out/*` with `RobbedConstants`/`ROBBED_CONSTANTS`) → `pnpm --filter @robbed/web build` (regenerates `.next/`). `contracts/reports/mutation/**` regenerate only on the next mutation run — stale `hoodpad` NatSpec there is harmless and non-load-bearing.

## 4. Verify commands (whole-rename gate)

```
pnpm install                                  # workspace relinks under @robbed/*
grep -rn "@hoodpad/" . | grep -v node_modules # → zero
grep -rn "hoodpad-" .claude CLAUDE.md         # → zero (agent routes)
pnpm -r run typecheck                          # or root tsc --noEmit per package
pnpm --filter @robbed/web build                # web builds under new scope
cd contracts && forge build                    # contracts compile (types unchanged)
bun test  (across packages: shared, api, indexer, web vitest)
docker compose config                          # compose parses with robbed identifiers
```
Final gate: `grep -rniE 'hoodpad' . | grep -vE 'node_modules|/\.git/|/\.next/|contracts/out/|/reports/mutation/'` returns **zero** (regenerated artifacts excepted).

## 5. Risk flags

- **Agent-rename bootstrapping (highest):** the six file renames + every `subagent_type` call-site + CLAUDE.md/commands refs MUST be one atomic commit. A half-applied rename leaves the orchestrator routing to a non-existent `hoodpad-*` or `robbed-*` agent. Do B in isolation, verify `ls .claude/agents` + grep before continuing.
- **npm-scope validity:** `@robbed` is a valid npm scope; `@robbed_` is NOT (the `_` is dropped by design). Never write `@robbed_/…`.
- **Single-commit scope integrity:** any dangling `@hoodpad/…` import fails `pnpm install`/typecheck for the whole workspace — A is all-or-nothing.
- **Already-final external names — nothing must stay `hoodpad`:** R2 bucket `robbed-assets` ✓ and Cloudflare account ✓ are correct (§12.45). The only lingering `hoodpad` external identifier is the **planned, undeployed** Worker name `hoodpad-web` → rename to `robbed-web` here. Confirmed: no external/immutable resource requires staying `hoodpad`.
- **`git mv` preferred** for the agent files and any doc renames (history-preserving) over delete+create.
- **Live redesign / implementation-plan ownership:** `apps/web` (redesign agent) and `docs/implementation-plan.md` (goal loop) are actively owned — fold their `@hoodpad`/`hoodpad-*` refs into blocks A/B mechanically at rename time, coordinated with the owning pass, not edited ahead of the gate in §1.
- **Generated artifacts drift:** do not hand-edit `.next/`, `contracts/out/`, `contracts/reports/mutation/`, `pnpm-lock.yaml`, `tools/m0/out/` — regenerate (block F). Hand-edits there desync from their generators.
