---
description: Run the mechanical doc-lint (bun scripts/doc-check.ts), fix trivial mechanical breakage directly, and route semantic contradictions to robbed-architect; never rewrite normative text.
allowed-tools: Bash, Read, Grep, Glob, Edit, Agent
---

Run the documentation lint and triage its findings.

## 1. Mechanical layer

Run `bun scripts/doc-check.ts` from the repo root. Exit 0 → report `CLEAN` and stop. Otherwise every finding is `file:line  [check]  message` with checks: `links`, `spec-ref`, `lp-copy`, `fences`, `m0`, `openapi`, `env-sync`, `docs-placement` (the check definitions live in the script header — read it before triaging).

## 2. LLM layer — triage every finding into exactly one bucket

**Fix directly (trivial mechanical breakage only).** The reference or link is stale but the intent is unambiguous — e.g. a broken anchor after a heading rename, a relative path after a file move, a cross-doc section reference pointing at the wrong heading where the intended target is obvious from surrounding text, an unclosed fence. Read enough context to be certain of the intended target, apply the smallest edit that restores it, and re-run the script to confirm the finding clears. Never "fix" a finding by weakening or deleting the referencing sentence.

**Route to robbed-architect (semantic contradictions).** The finding reflects a real disagreement between documents, not breakage: LP-copy deviations or `burn` in LP context (`lp-copy`), a cross-doc section reference whose intended target genuinely doesn't exist or is ambiguous, an `m0` number that disagrees with `tools/m0/out/constants.json`, a `docs-placement` finding where the right home for a doc is genuinely unclear, or any case where fixing would mean choosing between two normative statements. Hand the architect the findings verbatim plus the surrounding doc context; it arbitrates per the authority chain (`README.md` + `docs/developers/**` > derived docs — docs/CONTRIBUTING.md "Authority chain").

**Never** rewrite normative text yourself — authoritative design-doc sections, entries in the design decisions log, canonical copy strings, or any sentence a component doc declares authoritative. Repointing a reference at the section that already says the right thing is fine; changing what any section says is the architect's call.

## 3. Output

A findings table:

| # | File:Line | Check | Finding | Disposition |
|---|---|---|---|---|

Disposition: `fixed (<one-line what>)` · `routed → robbed-architect` · `pre-existing, already tracked (<where>)`. After the table: the final `bun scripts/doc-check.ts` result (must be clean unless findings were routed), and the list of anything routed with the architect's response if it ran this session.
