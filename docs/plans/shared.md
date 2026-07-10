# Per-Service Plan — Shared Package + Workspace

**Owner:** hoodpad-shared · **Zone:** `packages/*` + workspace config (pnpm) · **Regenerated:** 2026-07-10

> **Authority (do not override).** `docs/implementation-plan.md` is the single `/goal` checkbox authority. This file is DETAIL keyed to its item IDs (`⇐ M2-1`) and the findings IDs (`⇐ X-1`, `⇐ X-6`, `⇐ X-13`) plus their ratified §12 decisions (§12.28/§12.30/§12.31). It never contradicts the master plan or a §12 decision; if it ever does, the master plan/spec win and this file is corrected (plans/README §authority, development-flow §1). Anti-drift rule (CLAUDE.md): every cross-service type/schema/ABI lives here ONCE, Zod-first, TS types via `z.infer`; apps consume, never redeclare. Shared-shape changes follow the development-flow ratification protocol — the decisions below are already ratified (§12.28–§12.31 / decisions.md §5), so this is execution, not re-litigation.

---

## 1. Current state — frozen + green

Interface-freeze + §12.29 pnpm conversion landed (`bun test packages/shared` green, 6 test files: `metadata`, `ws-messages`, `api-types`, `confirmation`, `channels`, `abi`). On disk:

- **`packages/shared/src/`** — `abi/events.ts`, `events.ts`, `confirmation.ts`, `channels.ts`, `ws-messages.ts`, `api-types.ts`, `metadata.ts` (+ `metadata.fixtures.ts` golden vectors), `constants.ts`, `db-rows.ts`, `index.ts` (barrel).
- **`apps/api/openapi.yaml`** — endpoint-for-endpoint transcription of api.md §3.
- **`pnpm-workspace.yaml`** — `packages: [apps/*, packages/*]`; catalog pinning `zod: 4.4.3`, `viem: 2.55.0`. `packages/shared/package.json` consumes both via `catalog:`. One `pnpm-lock.yaml`.

**Already satisfied inside the frozen set** (do NOT redo — verify only):
- `metadata.ts` `tokenMetadataSchema.version` is already `z.literal(METADATA_VERSION)` and every golden fixture already carries `version:1` inside the canonical preimage → **§12.31's schema+preimage leg is DONE**; the outstanding X-13 work is the negative test + comment cleanup (task 3).
- `api-types.ts` `TokenDetail.creator` is already the `{ address, tokensCreated }` object and `TokenCard.creator` is the plain address → **X-13's creator-shape leg is DONE** at the schema level; outstanding work is stripping the "flagged to hoodpad-architect" comment now that it is ratified.
- `constants.ts` `LP_COPY` already carries the exact §12.14 sentence **with trailing period**; `METADATA_TICKER_MAX = 10`, `METADATA_DESCRIPTION_MAX = 500`, `MAX_TRADE_FEE_BPS = 200`, candle intervals/seconds all present.
- `channels.ts` taxonomy comment already lists `fee_collected` under `token:{address}:events` — the *channel* exists; the *message schema* does not yet (task 2).

---

## 2. Outstanding schema changes — the actual work (all under `⇐ M2-1`)

Four task rows. Each is a ratified §12 decision; none needs a fresh ratification. "Consumers to notify" = the agents whose code re-imports after the shape moves (development-flow change-report requirement).

### Task 1 — Byte-length name ≤ 32 / ticker ≤ 10  · `⇐ X-1 / §12.30`

On-chain `createToken` validates `bytes(name).length ∈ [1,32]` and `bytes(symbol).length ∈ [1,10]` (contracts.md §2.2). Today the shared/API/OpenAPI layer caps **name at 64 characters** (`METADATA_NAME_MAX = 64`, `.max(64)`), so a 33–64-char (or multibyte) name passes the API, gets canonicalized + hashed + written to R2, then **reverts at `createToken`**. Replace character `.max()` with **UTF-8 byte-length** refinements so nothing the API accepts can revert on-chain.

| | |
|---|---|
| **Files** | `packages/shared/src/constants.ts` (change `METADATA_NAME_MAX 64 → 32`; document that both maxes are **byte** limits matching Solidity `bytes(x).length`), `packages/shared/src/metadata.ts` (`tokenMetadataSchema.name`/`.ticker`: drop `.max()`, add byte-length `.refine`), `packages/shared/src/api-types.ts` (`metadataRequestSchema.name`/`.ticker`: same refinement, import the constants instead of hardcoded `64`/`10`), `apps/api/openapi.yaml` (`MetadataRequest.name.maxLength 64 → 32` + description note that the true gate is 32 **UTF-8 bytes**, server-enforced — see decision D1 for the JSON-Schema caveat) |
| **Proven by** | `bun test packages/shared`: a 32-byte name accepted, a 33-byte name rejected; a 10-byte ticker accepted, an 11-byte one rejected; a **multibyte** case that is under the char limit but over the byte limit rejected (e.g. `"ÜÜÜÜÜ"` = 5 chars / 10 bytes accepted, `"ÜÜÜÜÜÜ"` = 6 chars / 12 bytes rejected for ticker≤10); the existing `Ünïcødé 🚀 猫` / `ÜNÏ` golden fixture still hashes to its frozen value (byte-count change must not perturb canonicalization). Confirm `new TextEncoder().encode(x).length` agrees with a Foundry `bytes(x).length` reference vector at the 32/33 and 10/11 boundaries. |
| **Consumers to notify** | **api** (server-side request validation — `POST /v1/metadata`), **web** (client-side launch-form zod, must reject before signing per §12.19), **indexer** (metadata verifier — parses the same schema; no on-chain gate but must not diverge) |

### Task 2 — `fee_collected` WS message  · `⇐ X-6`

The channel taxonomy promises `fee_collected` on `token:{address}:events`, but the frozen `wsMessageSchema` discriminated union has no such member → fee-dashboard live updates are silently dropped. Add the payload schema + union arm.

| | |
|---|---|
| **Files** | `packages/shared/src/ws-messages.ts` (add `wsFeeCollectedDataSchema` + `type:'fee_collected'` arm to `wsMessageSchema`; export `WsFeeCollectedData`), `packages/shared/src/channels.ts` (taxonomy comment already lists it — leave, or tighten the doc line) |
| **Proven by** | `bun test packages/shared`: a `fee_collected` envelope parses under `wsMessageSchema`; the union stays exhaustive (`WsMessageType` includes `'fee_collected'`); round-trip parse/serialize is stable |
| **Consumers to notify** | **indexer** (publisher — emits it on `LPFeeVault.Collect`/`FeeCollected`), **web** (consumer — `/fees` dashboard live tile) |

Payload shape decision: **D2** below (mirror the REST `feeCollectionEntrySchema` so there is one fee-collection shape, not two).

### Task 3 — Freeze metadata `version:1` (negative test) + de-flag ratified comments  · `⇐ X-13 / §12.31`

The `z.literal(1)` and fixtures are already in place (§1). Close the loop: prove the literal actually *rejects* drift, and strip the now-stale "flagged to hoodpad-architect" notes now that §12.30/§12.31 are ratified so the code cites the decision, not an open question.

| | |
|---|---|
| **Files** | `packages/shared/src/metadata.ts` (add negative-path coverage via the test), `packages/shared/test/metadata.test.ts` (new vectors), `packages/shared/src/constants.ts` (rewrite the `METADATA_NAME_MAX` "NOTE (flagged to hoodpad-architect)" block to cite **§12.30 DECIDED — 32 bytes**), `packages/shared/src/api-types.ts` (rewrite the `TokenDetail.creator` "flagged to hoodpad-architect" note to cite **§12.31 RATIFIED — object supersedes card address**) |
| **Proven by** | `bun test packages/shared`: metadata with `version` omitted rejected; `version:2` rejected; `version:0` rejected; a valid `version:1` object still hashes to the frozen golden value (preimage unchanged) |
| **Consumers to notify** | **api** (canonicalizer producer), **web** (client re-verify), **indexer** (verifier) — no shape change, so re-import is a no-op; this is a comment/test-only close-out |

### Task 4 — V3 external addresses + constants completeness  · `⇐ §12.28`

`constants.ts` does not yet carry the §12.28-confirmed Uniswap V3 addresses. Add them as an `external`-scoped block so indexer startup assertions and the M0 `external.*` cross-check have a single shared source (spec §12.28; CLAUDE.md chain facts). Keep the LP sentence, intervals, and size caps intact.

| | |
|---|---|
| **Files** | `packages/shared/src/constants.ts` (add the four §12.28 addresses as `as const` exports; keep them lowercase-normalized or checksummed consistently with `WETH_ADDRESS`) |
| **Proven by** | `bun test packages/shared`: each address present and equals the §12.28 literal (Factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, NPM `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`, SwapRouter02 `0xcaf681a66d020601342297493863e78c959e5cb2`, QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7`); `LP_COPY` literal exact match (a period-less variant fails); `MAX_IMAGE_BYTES`/`MAX_METADATA_JSON_BYTES` present |
| **Consumers to notify** | **contracts** (deploy-time runtime assertions read the same values — `factory.feeAmountTickSpacing(10000)==200`, `NPM.factory()`/`NPM.WETH9()`), **indexer** (startup non-zero assertion), **web** (V3 widget), **all** |

> **Boundary note (§12.28 ownership):** the *canonical* V3 addresses also flow into the M1-14 codegen (`packages/shared` generated `addresses` from `Deploy.s.sol`) owned by the contracts pipeline. This task adds the **registry constants** (the fixed 4663 Uniswap deployment, from spec §12.28), which are distinct from the per-deployment ROBBED_ contract addresses that codegen emits. No overlap; if the contracts codegen later wants to source these too, they import from here — not redeclare.

---

## 3. Workspace-config maintenance (ongoing rules)

| Task | Trigger | Rule (source) |
|---|---|---|
| Add `workspace:*` internal dep | an app first imports `@robbed/shared` | the app's `package.json` declares `"@robbed/shared": "workspace:*"`; pnpm's strict non-flat `node_modules` makes a **missing** declaration fail loudly (a phantom-dependency import errors) — that failure is the point, never paper over it (pnpm/workspaces; §12.29) |
| Catalog a shared lib | ≥ 2 packages depend on the same third-party lib | add it to the `pnpm-workspace.yaml` `catalog:`; consumers reference `catalog:` so versions can't diverge (single-version policy — pnpm/catalogs). Currently cataloged: `zod`, `viem` |
| **Never** | to silence a resolution error | no `shamefully-hoist`, no broad `public-hoist-pattern` — declare the missing dependency instead (pnpm/settings; CLAUDE.md anti-drift rule 4) |
| Lockfile discipline | any dep/catalog edit | run `pnpm install`, commit the single `pnpm-lock.yaml`; never introduce a second lockfile (`bun.lock`/`yarn.lock`/`package-lock.json`). Bun stays the *runtime + test runner* only (§12.29 / spec §8/§9) |

---

## 4. Decide-it-yourself decisions (own these; research → safest option → comment → test → implement)

### D1 — Byte-length validation mechanism

- **Research (docs-first, verified 2026-07-10):** Zod has **no** built-in byte-length check; `.max()` counts UTF-16 code units, not bytes (zod.dev/api). The established pattern is `z.string().refine(s => new TextEncoder().encode(s).length <= N, { error })`. `TextEncoder` emits UTF-8, and Solidity `bytes(str).length` is the UTF-8 byte count — so `new TextEncoder().encode(x).length` is **byte-identical** to the on-chain measure. This is the single correct measure; it makes API-vs-chain drift impossible by construction (anti-drift rule 2).
- **Decision:** `.refine()` with `TextEncoder`, keep a `.min(1)` for the non-empty floor. Factor the predicate into a small `utf8ByteLen(x)` helper in `metadata.ts` (or a tiny internal util) so metadata + api-types share **one** implementation, not two copies (extraction rule 3).
- **OpenAPI caveat:** JSON-Schema `maxLength` is defined over Unicode code points, so it **cannot** express "32 bytes" exactly. Set `maxLength: 32` (a safe upper bound — no ASCII input the byte-check accepts is rejected by it) and add a `description` stating the authoritative constraint is 32 UTF-8 bytes enforced server-side. The zod refinement is the real gate; OpenAPI documents intent. Record this caveat in the OpenAPI description so it doesn't read as drift.
- **Proving test:** boundary vectors at 32/33 name bytes and 10/11 ticker bytes, plus a multibyte case (char-count under limit, byte-count over) that must reject; cross-checked against a Foundry `bytes(x).length` reference vector.

### D2 — `fee_collected` payload shape

- **Research:** api.md `/fees` endpoint + `feeCollectionEntrySchema` (already in `api-types.ts`: `amountToken`, `amountWeth`, `recipient`, `blockTimestamp`, `txHash`, `confirmationState`) is the canonical fee-collection record; indexer.md §8.2 event shapes; the WS envelope already standardizes `v/type/channel/seq/ts/data` and every event carries `confirmationState`.
- **Decision:** the WS `data` mirrors the REST entry so there is **one** fee-collection shape across REST + WS (anti-drift). Concretely `wsFeeCollectedDataSchema = { token: addressSchema, amountToken, amountWeth, recipient, blockNumber, txHash, logIndex?, confirmationState }` — i.e. the REST fields plus the `token` address (WS rows are per-token but the message is self-describing) and the block coordinates the other event payloads carry. Reuse the existing `decimalStringSchema`/`addressSchema`/`hex32Schema` scalars; do **not** invent new ones. This keeps the fee dashboard reading identical fields whether it hydrates from REST or a live WS push.
- **Proving test:** an indexer-published fixture parses under `wsMessageSchema` **and** its `data` also validates the REST `feeCollectionEntrySchema`'s shared fields (round-trip parity, so the two can never drift).

### D3 — Catalog scope (`typescript` and beyond)

- **Research:** pnpm/catalogs — catalog anything ≥ 2 packages share to enforce a single version.
- **Decision:** catalog a lib the moment a second package adopts it. `zod`/`viem` are cataloged today. Add `typescript` to the catalog once ≥ 2 packages carry a TS toolchain (apps land in M2/M3); until then it stays uncataloged (single consumer). Do not pre-catalog unused libs.
- **Proving test:** `pnpm ls -r <lib>` (or `pnpm why`) shows exactly one resolved version once ≥ 2 packages depend on it.

---

## 5. Lockstep obligations (do not ship a half-change)

- **OpenAPI ↔ shared zod:** any `api-types.ts` shape edit updates `apps/api/openapi.yaml` in the same change (M2-2 sync test is the enforcer). Task 1 touches `MetadataRequest`; Task 3's creator note is doc-only but confirm the OpenAPI `TokenDetail.creator` object already matches.
- **`events.json` ↔ WS/ABI:** `events.json` is the contracts-pipeline codegen (canonical ABI shapes, spec §12.15, generated at M1-3/M1-14 — **not** hand-edited here). Task 2's `fee_collected` is a *WS projection* of the `LPFeeVault.Collect`/`FeeCollected` on-chain event; when that ABI lands in `events.json`, confirm the WS payload's field names/units reconcile with the decoded struct. If they can't be reconciled, that's a ratification question for hoodpad-architect (interface meaning), not a self-resolved edit.

---

## 6. Definition of done

- **Zero drift, grep-verified:** no `apps/*` file redeclares a shared shape (`rg` for duplicated schema/const/type names across `apps/`); every consumer imports from `@robbed/shared`.
- **Zod-first:** every wire-crossing shape is a zod schema with its TS type via `z.infer`; no hand-written parallel type. Byte-length is a `.refine`, not a duplicated char cap.
- **All four outstanding tasks implemented + proven** by the tests named in §2; the negative vectors (33-byte name, 11-byte ticker, `version≠1`, missing `version`) all reject; `fee_collected` parses and round-trips to the REST shape.
- **Canonicalization dual-computation vectors green (§12.19 normative):** the golden fixtures still hash byte-identically after the byte-length change — the metadata preimage is untouched (validation ≠ serialization). This is the same function the indexer verify path runs, so byte-identity across producer/verifier is preserved by construction.
- **Workspace discipline:** internal deps `workspace:*`; shared libs `catalog:`; no hoist shims; single `pnpm-lock.yaml` in sync (`pnpm install` clean).
- **Lockstep:** OpenAPI updated with each api-types edit; events.json reconciliation confirmed for `fee_collected`.
- **Change report** (per development-flow) names every consuming service and any re-import/migration step: Task 1 → api/web/indexer re-import + tighten their own request validation; Task 2 → indexer publishes / web consumes the new union arm; Tasks 3–4 → no shape migration (comment/test/const-add only).
- **`bun test packages/shared` green** (spec §8/§9 — Bun is the test runner; pnpm manages the graph).

Spec ambiguities or any need to change what a ratified shape *means* → hoodpad-architect (ratification protocol). *How* to encode these already-decided shapes → owned here.
