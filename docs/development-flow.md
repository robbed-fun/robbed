# hoodpad — Development Flow (spec-driven)

**Status:** v1.0, 2026-07-09. This is the process contract for every agent and human working on hoodpad. It is not advisory; violating it is a process bug, reviewable like any other bug.

---

## 1. Authority chain

```
launchpad-spec.md (v1.1)          ← root authority; §12 resolved decisions, §13 open items
  └── CLAUDE.md                   ← distilled hard rules (violations are bugs, not style)
        └── docs/services/*.md    ← implementable designs, one per service; owned by the service agent
              └── code            ← a TRANSCRIPTION of the service doc; nothing more, nothing less
```

Rules of precedence, mechanical:
1. Spec beats everything. If code, a doc, or a library's own documentation disagrees with the spec, the spec wins — flag the conflict, don't reinterpret.
2. Service docs beat code. Code that does something its doc doesn't describe is wrong even if it works.
3. `docs/architecture.md` and `docs/decisions.md` are derived views; if they drift from spec/service docs, they get fixed, they never win.
4. Official library documentation beats memory (CLAUDE.md docs-first rule: context7 MCP → WebFetch fallback), but the spec beats library docs.

## 2. The docs-precede-code rule

- **No code change lands without a covering doc section.** Every PR must be traceable to specific section(s) of a `docs/services/*.md` (or spec §) that describe the behavior being implemented. "Covering" means the doc describes the behavior — not merely mentions the file.
- **Doc changes precede code changes.** New behavior → update the service doc first (same PR is acceptable, but the doc diff must be reviewable as sufficient on its own; the code must transcribe it). If mid-implementation you discover the doc is wrong or incomplete, stop, fix the doc (or escalate, §3), then continue.
- Deviations forced by open items reference the item ID (e.g. `O-5`, `OI-8`) in the commit message, and once resolved, in spec §12.

## 3. Ambiguity protocol

Implementing agents **never self-resolve** spec ambiguities, contradictions, or silences. The pipeline:

1. Implementing agent hits an ambiguity → records it in their service doc's "Open items" table with an ID, a recommendation, and status `pending`, and reports it to the orchestrator for **hoodpad-architect**.
2. hoodpad-architect arbitrates:
   - **Decided** → one-line entry in spec **§12** (numbered, dated), amend any conflicting spec section text, propagate into every affected service doc, cross-reference in `docs/decisions.md`.
   - **Genuinely open** → spec **§13** with an owner and a latest-decision milestone; `docs/decisions.md` mirrors it.
3. Until arbitrated, the agent may proceed only on paths the ambiguity doesn't touch, or implement the documented *recommended default* clearly marked `pending §12` — never silently.

What counts as an ambiguity (non-exhaustive): spec sections that contradict (the §6.2/§6.5 sell-lock case, resolved §12.12), values the spec leaves unnumbered (candle intervals, §12.17), interface shapes the spec doesn't pin (event ABIs, §12.15), anything in §13.

## 4. Agent roster & path ownership

| Agent | Owns (writes) | Authoritative doc | Never touches |
|---|---|---|---|
| **hoodpad-architect** | `launchpad-spec.md`, `CLAUDE.md`, `docs/*.md` (root), `.claude/**` | spec §12/§13, docs/decisions.md | application code |
| **hoodpad-contracts** | `contracts/**`, `tools/m0/**` (with M0), `docs/services/contracts.md` | contracts.md | apps/, packages/shared TS |
| **hoodpad-indexer** | `apps/indexer/**`, `apps/api/**`, `docs/services/indexer.md`, `docs/services/api.md` | indexer.md, api.md | contracts/, apps/web |
| **hoodpad-frontend** | `apps/web/**`, `docs/services/web.md` | web.md | contracts/, apps/indexer, apps/api |
| **hoodpad-shared** | `packages/*` (the package structure, `workspace:*` deps, pnpm workspace config + catalogs — §12.29), generated codegen wiring | api.md §5 module map + spec §12.29 | app/service business logic (it owns the interface zone + workspace, not the consumers) |
| **hoodpad-security** | findings registers, gate reports, `test/` additions by agreement | spec §10 | production code (it refutes, it does not fix) |

**`packages/shared` is a ratified-interface zone**, not a free-for-all: the **package + workspace config are owned by hoodpad-shared** (§12.29 — pnpm workspaces, `workspace:*`, catalogs), while module *content* ownership follows api.md §5 (indexer owns `events.ts`/`db-rows.ts`/`channels.ts`/`ws-messages.ts`; API owns `metadata.ts`/`api-types.ts`; `constants.ts`/`confirmation.ts` are architect-ratified). Any change there follows the cross-service protocol (§6). Generated files (ABIs, `addresses.ts`) are produced by their source pipeline (contracts M1-14) and never hand-edited.

**`docs/user-flows.md` + `docs/user-flows-waivers.md`** are a sanctioned exception to "docs/*.md root = architect-owned": **authored by hoodpad-frontend** (owner of the flow/e2e surface), **ratified by hoodpad-architect**. They are a normative verification artifact (the e2e coverage contract) but are *derived from* spec §5 + the service docs — if they disagree with the spec/service docs, those win and the catalog gets fixed.

## 5. The iteration loop (every task)

1. **Read**: `CLAUDE.md` + the relevant spec sections + your service doc section. Check `docs/decisions.md` for rulings touching your task.
2. **Docs-first**: pull current official docs for every library touched (context7 MCP; fallback WebFetch). Never code from memory.
3. **Doc**: ensure the service doc covers the change; update it first if not (§2); escalate ambiguities (§3).
4. **Implement**: transcribe the doc.
5. **Test**: the doc's testing section defines the floor (Foundry gates for contracts; Vitest/integration for indexer/API; Vitest+Playwright for web). `bun test` / `forge test` green before any report.
6. **Self-check**: run your service's grep obligations (e.g. contracts: `block.number`, `\^0\.8`, `checkFee`, `Pausable`; web: copy-lint greps in web.md §8.3) plus build.
7. **`/spec-check`**: run on the diff. **Every PR/change runs it — no exceptions.** Findings of severity High+ block; ambiguities it surfaces go through §3.
8. **Security gate (contracts only)**: any diff under `contracts/` additionally gets **hoodpad-security adversarial review** before merge — it refutes, findings go back to hoodpad-contracts with dispositions recorded. Gate applicability per spec §10 (all 10 gates before caps lift; capped beta mandatory).
9. **Report**: what changed, doc sections implemented, open items touched (by ID), test/gate evidence.

## 6. Cross-service interface changes

Interfaces (event ABIs, REST paths/DTOs, WS channels/messages, shared types, table shapes read by another service) are **contracts, ratified in docs before any code**:

1. The proposing agent writes the change into the **owning** service's doc (the owner per architecture.md §4) as a proposal.
2. The **consuming** agent(s) review and record concurrence in their own doc (or the same PR updates both docs coherently).
3. **hoodpad-architect signs off** — checks spec compliance, updates §12/§13 and `docs/decisions.md` if the change embodies a decision.
4. Only then does code change, in both services, against the now-identical doc text. The owning doc remains the single normative statement; consumer docs mirror and link, never fork.

Precedent: the 2026-07-09 ratification round (spec §12.15–§12.22) — contracts' event shapes gained `metadataUri` on indexer's requirement; web's proposed channel/route names were corrected to the indexer/API canon; web's `GET /v1/trades/:txHash` need was added to api.md. That is the template.

## 7. Standing hard rules (verbatim from CLAUDE.md — enforced by `/spec-check` and CI greps)

No `block.number` in contract logic · one exact compiler pin · sells never pausable, only `pauseCreates`/`pauseBuys`, zero pause authority post-graduation · fees in-contract only · LP copy = the canonical sentence, never "burned" · no hardcoded market metrics anywhere · immutable contracts, no proxies · OZ v5, Safe treasury, Ownable2Step · LPFeeVault collect-only · confirmation tiers surfaced · MIT, verified on Blockscout, repo public · `creator`/`creatorFeeBps(=0)` tracked from day 1.

## 8. Milestone discipline

Work proceeds in spec §11 order (M0 → M5); a milestone's driving docs (architecture.md §7) must be internally green — DoD checklist satisfied, open items either resolved or explicitly non-blocking — before the next milestone's implementation starts. Handoff artifacts (constants.json, deploy artifacts → shared codegen, ratified shared types) are the only sanctioned way state crosses a milestone boundary.
