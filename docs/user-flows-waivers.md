# ROBBED_ — User-Flow Layer Waivers

**Owner:** hoodpad-frontend (author) · **Ratifier:** hoodpad-architect · **Companion to:** `docs/user-flows.md` (M3-11)

> **Architect sign-off:** `RATIFIED-BY: robbed-architect  DATE: 2026-07-11` — 16 waiver rows cross-checked against the catalog: exactly the 16 flows declaring <3 `assertable-layers` are listed, each with a valid P-7 rationale; the 20 unlisted flows all declare three layers. ERR-4/ERR-5 correctly held at full three layers (the §6.5/§12.25 invariants are *proven at the indexed layer* — a waiver there would gut the point). COLLECT-1 rationale amended for the §12.50 Portfolio page (read-only, no collect surface — waiver stands).

> **`PORT-*` addendum (catalog §3b):** `AUTHORED-BY: robbed-frontend  DATE: 2026-07-11` · `RATIFIED-BY: robbed-architect  DATE: 2026-07-11` — 8 `PORT-*` waiver rows appended below (table total now 24). Cross-checked at ratification: exactly the 8 `PORT-*` flows declaring <3 layers in the catalog are listed, each N/A layer matches its catalog declaration (PORT-1/2/3/5/6/7 = indexed·UI; PORT-4/PORT-8 = UI-only), and each rationale is a valid P-7 ground verified against the shipped implementation. Portfolio is a **read-only** page (§12.50a): no flow has an on-chain transaction surface, so every `PORT-*` flow declares <3 layers by nature and is waived here per P-7 so `e2e:coverage` can never livelock on an assertion that cannot exist.

## Purpose

`docs/user-flows.md` declares an `assertable-layers` set per flow (on-chain / indexed / UI). Happy paths assert all three; some flows legitimately assert fewer (P-7: an error path that produces no indexer record cannot be asserted at the indexed layer). This file records **every** flow that declares fewer than three layers, the **N/A layer(s)**, and the rationale — so the `e2e:coverage` gate treats those absences as intentional and does **not** livelock `/goal` waiting for an assertion that can never exist.

A flow **not listed here** is asserted at all three layers.

## Waiver table

| Flow ID | Declared layers | N/A layer(s) | Rationale |
|---|---|---|---|
| `DISC-4` | indexed · UI | on-chain | Search is a pure indexer query (`GET /v1/search`, pg_trgm over name/ticker/contract/creator). It reads no chain state and changes none — there is nothing to assert via `eth_call`/receipt. |
| `TD-8` | indexed · UI | on-chain | Organic-flow metrics are advisory heuristics sourced **entirely** from the indexer (§8.5); spec is explicit that they add **no new on-chain surface** and gate nothing. Asserted at indexed (`trust.organic`/holder `clusterId`) + UI (range render, cluster grouping) only. |
| `TD-11` | indexed · UI | on-chain | Token info / Blockscout links / creator profile are display of indexer-sourced metadata (links, timestamps, addresses). No state change; `block.number` is never read (CLAUDE.md). Nothing to assert on-chain. |
| `TD-12` | indexed · UI | on-chain | SSR HTML + OG PNG are render outputs from indexed data (summary + candles). The assertion is DOM/meta + image bytes/dimensions; no chain state change exists to assert. |
| `LAUNCH-3` | UI | on-chain, indexed | Economics panel is pure display: live fee/threshold **reads** feed a rendered value and the LP sentence is fixed copy from the shared constant. No transaction, no indexed record. (The underlying live reads themselves are exercised on-chain in TD-7; here the assertion is UI-render — LP copy verbatim, no market-metric literal.) |
| `COLLECT-1` | on-chain · indexed | UI | `collect(tokenId)` is permissionless and treasury-facing; it has **no surface in the four v1 pages** (the §12.50 Portfolio page is read-only — holdings/activity/created — and exposes no collect surface; treasury tooling stays out of scope). Asserted on-chain (fees route to the fixed treasury, principal stays locked) + indexed (collect event), never UI. |
| `ERR-1` | on-chain · UI | indexed | Slippage revert: the tx reverts on the min-received guard, so the indexer materializes **no** Trade record. Asserted via receipt `reverted` (on-chain) + error surface (UI). |
| `ERR-2` | on-chain · UI | indexed | Deadline expiry reverts the tx → no indexed Trade. Receipt + UI error only. |
| `ERR-3` | on-chain · UI | indexed | Anti-sniper cap: primarily a preventive UI surface; if forced, the tx reverts → no indexed Trade. Receipt + UI. |
| `ERR-6a` | UI | on-chain, indexed | Client hash re-verification **blocks signing** on mismatch → no transaction is ever broadcast, so there is no on-chain or indexed record. Assertion is purely the UI-blocked-signing state. |
| `ERR-8` | on-chain · UI | indexed | `pauseCreates` is a live config **read** that disables the submit button; no `createToken` is sent → no indexed record. On-chain (flag read) + UI (disabled submit + copy). |
| `ERR-9` | UI | on-chain, indexed | Wallet-rejected signature → nothing is broadcast; the optimistic row/stepper is reset. No on-chain or indexed record. UI only. |
| `ERR-10` | on-chain · UI | indexed | A reverted transaction (generic cause) produces no indexed Trade. Receipt `reverted` (on-chain) + the `failed` row treatment (UI). |
| `ERR-11` | indexed · UI | on-chain | WS reconnect / seq-gap heal is a client-recovery concern: invalidate live keys → REST re-serves indexed truth. No chain state changes during recovery. Indexed (heal correctness) + UI (banner, gap closed). |
| `ERR-12` | indexed · UI | on-chain | Stored-link XSS is a render-safety assertion (no `javascript:`/`data:` href reaches the DOM). The malicious payload arrives via indexed `links`; there is no chain surface. |
| `ERR-13` | on-chain · UI | indexed | Trust-panel RPC read failure: the failing live read yields nothing indexed for the failure, and the API's cached values are **never** substituted (§5.2). On-chain (the read attempt/failure) + UI ("read unavailable"). |
| `PORT-1` | indexed · UI | on-chain | Portfolio is read-only (§12.50a): summary + holdings are pure `/v1/portfolio/*` indexer reads rendered to the DOM. No transaction, no chain-state change exists to assert. |
| `PORT-2` | indexed · UI | on-chain | ACTIVITY is a historical per-address slice of already-indexed trades (shared `TradeRow`); the flow performs no transaction — the trades' on-chain legs are asserted in TD-2/TD-3/TD-4/TD-5. |
| `PORT-3` | indexed · UI | on-chain | CREATED lists indexer-materialized tokens (the `/tokens` `TokenCard` projection, listing-gated §8.4); the creations' on-chain legs are asserted in LAUNCH-1/LAUNCH-2. |
| `PORT-4` | UI | on-chain, indexed | Disconnected state: no subject address → **no portfolio request is issued at all** — nothing on-chain or indexed exists to assert. The connect prompt is a pure UI state. |
| `PORT-5` | indexed · UI | on-chain | Cursor pagination (`nextCursor`, page size 50) is a pure indexer-read paging concern; no chain surface. |
| `PORT-6` | indexed · UI | on-chain | Viewing an arbitrary address (`?address=`) is the same read-only indexer read with a different subject; no transaction and no self-only affordance to exercise. |
| `PORT-7` | indexed · UI | on-chain | An empty portfolio is itself an indexer response (any address resolves to at worst EMPTY, never a 404 — api.md §3.4a): asserted as the indexed empty payload + the UI empty states. No chain surface. |
| `PORT-8` | UI | on-chain, indexed | Portfolio API read failure: the failure produces no indexed payload and touches no chain state; the assertion is the per-region error surface + retry affordance. The successful-read legs are covered by PORT-1/2/3. |

## Notes

- Flows **not** in this table (`DISC-1`, `DISC-2`, `DISC-3`, `TD-1`, `TD-2`, `TD-3`, `TD-3b`, `TD-4`, `TD-5`, `TD-6`, `TD-7`, `TD-9`, `TD-10`, `LAUNCH-1`, `LAUNCH-2`, `ERR-4`, `ERR-5`, `ERR-6b`, `ERR-7`, `ERR-14`) assert all three layers and need no waiver.
- `ERR-5` (sells-open-while-treasury-reverts, §12.25) is deliberately a **full three-layer** flow: the sell must **succeed** and be **indexed** even when the treasury sink would revert, because the curve fee is a pull-payment accrual — proving that at the indexed layer is the point of the invariant.
- `ERR-4` (sells-open-while-buys-paused) is likewise full three-layer: the sell produces a real indexed Trade while the buy path is disabled.
- The `e2e:coverage` script (I-5a) must read this file and count a flow as covered when its tagged test asserts exactly its declared (non-N/A) layers.
