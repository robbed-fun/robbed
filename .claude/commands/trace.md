---
description: Re-derive the requirements-traceability matrix for the spec sections named in $ARGUMENTS (default; sections touched by the current diff), diff it against docs/traceability.md, update changed rows, and report new orphans. Genuine gaps are routed to robbed-architect, never resolved here.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Agent
---

Maintain `docs/traceability.md` — the matrix mapping every normative requirement in `launchpad-spec.md` to its designing service-doc section(s) → implementation-plan item(s) → verification (plan Verify command, test file/suite, e2e flow, or CI job).

## Scope resolution

- If **$ARGUMENTS** names spec sections (e.g. `§6.5 §8.3`, `6.5 8.3`, `gates`, `decisions`, or `all`), re-derive exactly those sections of the matrix. `all` = the full walk: §2.1, §5.1–5.3, §6.1–6.7, §7, §8, §8.3, §8.4, §10 gates, §12 decisions.
- If **$ARGUMENTS** is empty, derive scope from the current diff: `git diff HEAD --name-only` plus staged plus untracked (`git status --porcelain`). Map touched files to spec sections:
  - `launchpad-spec.md` → the spec §§ whose text changed (read the diff hunks; a §12/§13 change also re-scopes every matrix row citing that decision/item).
  - `docs/services/contracts.md` / `contracts/**` / `tools/m0/**` → §6.1–6.7, §7, §10 gates 1–4, §12.1/.3/.4/.9–.13/.15/.18.
  - `docs/services/indexer.md` / `apps/indexer/**` → §2.1, §8, §8.3, §12.15–.17/.20/.23.
  - `docs/services/api.md` / `apps/api/**` → §5.1, §5.3, §8, §8.3, §8.4, §12.19/.21/.22.
  - `docs/services/web.md` / `apps/web/**` → §2.1, §5.1–5.3, §12.2/.12/.14/.19/.23/.24.
  - `docs/implementation-plan.md` → every section whose Build/Verify columns cite a changed item, **plus** a full orphan-B re-scan.
  - If the working tree is clean, use the last commit (`git show --name-only`).
- Always announce the resolved scope before proceeding.

## Procedure

1. **Read the sources** (scoped sections in full, never from memory): `launchpad-spec.md`, `docs/implementation-plan.md`, the relevant `docs/services/*.md`, and the current `docs/traceability.md` (its Legend and ID scheme are the format contract — `R-<§>-<n>` / `R-10-G<n>` / `R-12.<n>`, one-line requirement statements with § anchors, columns Design / Build / Verify / Status).
2. **Re-derive** each in-scope requirement row from scratch — do not trust the existing row:
   - **Requirement**: every normative statement in the spec section (MUST-shaped facts, constants, guarantees, event shapes, copy rules). One row per requirement; keep the statement to one line with its § anchor.
   - **Design**: the service-doc section(s) that *describe the behavior* (development-flow.md §2 — mention ≠ coverage). architecture.md/decisions.md are derived views and never count as the designing doc.
   - **Build**: implementation-plan item ID(s) whose "Transcribes:" line or scope covers it. An item covers a requirement only if its Transcribes/scope text does — do not stretch (the §5.1-search/M2-9 gap was found exactly this way).
   - **Verify**: the concrete contract — the plan item's `Verify:` command, a named test file/suite (forge match-path, `bun test` suite, `*.test.ts(x)`), an e2e scenario (web.md §8.2 or a `@flow:` ID), a CI job, or a G-# end-state check. "Tests exist somewhere" is not a verification.
   - **Status** per the matrix Legend: FULL / PARTIAL (say exactly what's missing) / DEFERRED (out-of-goal M4/M5) / DOC-ONLY / OPEN-§13 annotations on PARTIAL rows.
3. **Diff against `docs/traceability.md`**: for each in-scope row — unchanged, changed (any column), added (new requirement in the spec text), or removed (requirement deleted/superseded — e.g. a §13 item resolved into §12 moves rows, never silently drops them).
4. **Update the file**: rewrite exactly the changed/added/removed rows in place (keep IDs stable; a removed requirement's ID is retired, not reused), update the two orphan tables and the Row-counts table, and bump the `**Generated:**` date. Touch nothing outside the resolved scope except orphan tables and counts. `docs/traceability.md` is the **only** file this command may write.
5. **Orphan re-scan** (always, regardless of scope):
   - **A (real gaps):** in-scope spec requirements with no designing doc section, no plan item, or no verification → add/refresh rows in orphan table A with what exists / what's missing / severity.
   - **B:** plan items in scope whose Transcribes-line points at no spec/doc requirement → label them (Process / verification scaffolding / ops) in orphan table B; only unlabeled, non-process items are findings.

## Routing gaps — never invent mappings

- If a requirement has **no designing doc section**, **no plan item**, or the spec is ambiguous about what the requirement even is: record it in orphan table A and **route it to `robbed-architect`** (Agent tool, subagent_type `robbed-architect`) with the requirement text, § anchor, and what's missing — the architect owns spec §12/§13 arbitration and plan fixes (development-flow.md §3). Do **not** fabricate a Design/Build/Verify cell to make a row look FULL, do not edit the spec, service docs, or the plan, and do not implement anything.
- If a service doc and the spec disagree while mapping, the spec wins — flag the conflict as an A-row and route it; never reinterpret (development-flow.md §1).

## Report

1. Resolved scope (sections + why).
2. Row delta table: `ID | change (added/updated/removed/unchanged-count) | what changed`.
3. **New or changed orphans**, tables A and B, verbatim as written to the file. State explicitly if there are none.
4. Anything routed to robbed-architect (with the message sent).
5. Updated totals (rows, FULL/PARTIAL/DEFERRED/DOC-ONLY, orphan counts).

This command reports and maintains the matrix; it fixes nothing else.
