---
description: Drive docs/implementation-plan.md toward its Goal — verify done items, execute the next eligible item via the owning agent, update checkboxes with evidence, report progress and blockers.
---

You are driving the hoodpad master plan. Argument (optional) narrows scope: `$ARGUMENTS` — a phase id (`P0`, `M0`, `M1`, `M2`, `M3`, `I`, `T`, `P`), an item id (e.g. `M1-8`), or empty (whole plan, first eligible item). `--full-verify` forces re-running even expensive verification commands.

Read first, every invocation: `CLAUDE.md`, `docs/implementation-plan.md`, `docs/development-flow.md` §4–§6 (agent roster, iteration loop, cross-service protocol), and spec §12/§13 (a decision may have landed since the plan was written — the spec wins over the plan; if they conflict, fix the plan first).

## 1. Verify claimed-done items (trust nothing)

For every `[x]` item in scope (scope = the named phase, or the whole plan if unscoped):

- Re-run its `Verify:` command. In-flight Phase-0 items (P0-3 scaffold, P0-4 threat model) are owned by concurrent agents — verify only, **never create or edit their files**.
- Command passes → leave it. Fails → flip back to `[ ]`, strike the old evidence with `— REOPENED YYYY-MM-DD: <why>`, and treat it as the next candidate.
- Expensive commands (fork tests, mutation runs, full e2e — anything > ~2 min) may be skipped unless `--full-verify` or the current item directly depends on them — but every skip must be named in the final report. Never skip silently.

## 2. Select the next item

First unchecked item (plan order) satisfying all of:

1. Its phase's **entry criteria** hold (verify the referenced exit criteria, don't assume).
2. No unresolved **§13 blocker** named on the item. Check spec §13 + `docs/decisions.md` live — the plan's blocker notes may be stale in either direction.
3. Not **NEEDS-USER** (see §4) and not in the plan's "Explicitly OUT of this goal" list (M4/M5 work is never started from here).

If `$ARGUMENTS` names an item, select it but still enforce 1–3 (refuse with the reason if they fail).

## 3. Execute via the owning agent

Delegate to the agent named on the item (hoodpad-contracts / hoodpad-indexer / hoodpad-frontend / hoodpad-security / hoodpad-architect — path ownership per development-flow §4, including the plan's `tools/localstack` extension). Never implement a service item in the main session. The delegation prompt must include:

- The item id + full text, the doc section(s) it **transcribes** (the code is a transcription — development-flow §2), and the verification command that defines done.
- The standing loop obligations: docs-first (context7 MCP → WebFetch fallback for every library touched), service-doc coverage before code, the doc's test floor, self-check greps, report format.
- Relevant §12 rulings and any `pending §12` markers touching the item.

After the agent reports:

- Run the item's `Verify:` command yourself. Failing → the item stays `[ ]`; iterate or report the failure.
- Run `/spec-check` on the diff (every change, no exceptions — development-flow §5.7). High+ findings block.
- Diff under `contracts/` → dispatch **hoodpad-security** for the adversarial gate before considering the item done (development-flow §5.8); findings go back to hoodpad-contracts, dispositions recorded.
- Agent surfaced an ambiguity → route it to **hoodpad-architect** per development-flow §3 (spec §12/§13 + decisions.md), never resolve it yourself, never let the sub-agent self-resolve.

## 4. Human decisions: stop, don't invent

If the selected (or only remaining eligible) item is **NEEDS-USER** or blocked on a §13 human decision — Safe signer set (O-6), name/brand, WalletConnect projectId (web-6), moderation vendor (OI-A7), legal/ToS, git remote/push consent, beta caps (O-10) — **stop and surface it to the user** with: what's blocked, the exact decision needed, the plan's documented workaround (if any), and the next item that is *not* blocked (offer to proceed there instead). Never fabricate a signer set, brand, vendor, address, or credential to keep moving.

## 5. Record and report

On success, edit `docs/implementation-plan.md`: `- [x] … — done YYYY-MM-DD; evidence: <one-line verification result or commit ref>`. If the item resolved a §13 item, confirm hoodpad-architect recorded it in spec §12 + `docs/decisions.md` before marking done.

Final report, always:

- **Phase & progress:** current phase; per-phase `done/total` and overall %; Goal checklist (G-1…G-10) status.
- **This run:** item(s) executed, agents used, verification evidence, spec sections implemented, reopened items, skipped verifications.
- **Next:** the next eligible item and its owner.
- **Blockers for the user:** every NEEDS-USER / §13 human decision currently in the critical path, with what exactly is needed.
