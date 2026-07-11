# ROBBED_ — User-Flow Catalog (`apps/web`)

**Owner:** hoodpad-frontend (author) · **Ratifier:** hoodpad-architect · **Status:** **RATIFIED** (M3-11) — including the §8 redesign-reconciliation addendum (PORT-\* flows authored §3b and **RATIFIED 2026-07-11**; 44-flow total is the I-5a coverage baseline)
**Spec:** `launchpad-spec.md` v1.1 §5.1–5.3, §2.1, §6.5, §12.12/§12.14/§12.19/§12.20/§12.25/§12.50 · **Driving doc:** `docs/services/web.md` §3/§4/§8 · **Plan row:** `docs/plans/web.md` M3-11

> **Architect sign-off:** `RATIFIED-BY: robbed-architect  DATE: 2026-07-11` — all 36 flows verified against spec §5.1 (5/5) / §5.2 (8/8) / §5.3 (5/5), the 9 transaction types, the 15 error paths (ERR-5 §12.25 confirmed full three-layer), and P-7 waiver completeness (every <3-layer flow has a waiver row). Ratified **as amended** for the §12.50 four-page redesign: route strings `/launch`→`/create` updated, `LAUNCH-*` IDs retained (stable-ID rule), and §8 records the required `PORT-*` addendum. Stable-ID rule is now in force.
>
> **`PORT-*` addendum sign-off:** `RATIFIED-BY: robbed-architect  DATE: 2026-07-11` — PORT-1..8 verified against the shipped Portfolio implementation (`apps/web/src/views/portfolio/**`, `entities/portfolio/**`, `app/portfolio/page.tsx`) and spec §12.50a: the §6 traceability table covers every §12.50a surface bullet; every layer declaration is honest per P-7 (read-only page ⇒ no on-chain layer anywhere; PORT-4/PORT-8 correctly UI-only — no subject/failed read produces no request/indexed payload); the 8 waiver rows match. **Advisory-read semantics RATIFIED** (no live-patch flow; disposition recorded in the §3b freshness note and decisions.md §13).

## Purpose & conventions

This is the authoritative catalog of every user flow across the app's pages (three at authoring time; **four since the §12.50 redesign** — see §8) plus every on-chain transaction type and every error path the product must handle. It is the coverage target for the **I-5 e2e harness** (env-gated, built later): each Playwright spec carries a `@flow:<ID>` tag, and `bun run e2e:coverage` diffs catalog IDs against tagged tests **and** checks each tagged test asserts its declared `assertable-layers` (honoring `docs/user-flows-waivers.md`). This document is the deliverable now; the tests come with I-5a/I-5b.

**Stable IDs** never change once ratified (renaming = new ID + tombstone; IDs never encode routes). Groups: `DISC-*` (Discover §5.1), `TD-*` (Token Detail §5.2), `LAUNCH-*` (Launch §5.3), `PORT-*` (Portfolio §12.50a — addendum §3b, ratified 2026-07-11), `TX-*`/`COLLECT-*` (transaction types with no dedicated page surface), `ERR-*` (error/edge paths).

**`assertable-layers`** — which of the three truth layers a flow can be asserted at (P-7: error paths that produce no indexer record declare fewer):
- **on-chain** — a state change / revert observable via `eth_call` or receipt status on the fork.
- **indexed** — a record the indexer materializes (Trade/Launch/Graduated/holder/candle/verdict) reachable over REST/WS.
- **UI** — a DOM assertion in `apps/web` (rendered value, badge, disabled state, error surface).

Flows declaring fewer than three layers have a rationale row in `docs/user-flows-waivers.md`.

**Non-negotiables carried into every trade flow** (CLAUDE.md · §1/§2/§6.5): the sell path reads **no** pause flag (§6.5/§12.25); every trade renders soft-confirmed first and reconciles to indexed truth, **never final while soft-confirmed, never dropped on contradiction** (§2.1/§4); slippage default 2% + deadline on every trade; no order-book / real-time-exchange framing; no USD/mcap/volume literals; the LP sentence renders only from the single shared constant.

---

## 1. Discover — `/` (§5.1)

### `@flow:DISC-1` — King of the Hill hero: render & navigate
- **Actors:** Visitor (no wallet required).
- **Preconditions:** ≥1 pre-grad token exists; API `GET /v1/tokens/king-of-the-hill` returns the ranked leader (rank formula `progress × ln(1+vol24h)`, §12.22 — API-computed, frontend renders, never computes).
- **Steps:** (1) SSR fetches the hero payload and paints avatar/name/ticker/creator + graduation ProgressBar + mcap + 24h volume. (2) WS `global:trades`/`global:launches` patch the hero's live metrics. (3) Click CTA → route to `/t/[address]`.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:DISC-2` — Live launch ticker (WebSocket)
- **Actors:** Visitor.
- **Preconditions:** WS connected on `global:launches`.
- **Steps:** (1) A new `launch` message arrives → entry slides in at the head (in-memory cap ~30). (2) A `graduated` message updates the corresponding entry. (3) Entry click → `/t/[address]`.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:DISC-3` — Token grid: sort / filter / paginate / live-patch (card fields)
- **Actors:** Visitor.
- **Preconditions:** API `GET /v1/tokens?sort=&filter=&cursor=&limit=48` reachable.
- **Steps:** (1) Choose sort (trending/newest/mcap/24h-volume/progress) and filter (pre-grad/graduated/all) → state syncs to URL `searchParams`, SSR-consistent. (2) Each card renders exactly image · name · ticker · mcap · progress bar · 24h Δ% · creator · age — metrics from indexer payload only, never client price math. (3) WS `global:trades`/`global:launches` patch visible cards (mcap/Δ%/progress); a new card flashes a highlight ring or, when scrolled, shows the "n new" pill. (4) Cursor infinite-scroll appends the next page.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:DISC-4` — Search (name / ticker / contract / creator)
- **Actors:** Visitor.
- **Preconditions:** API `GET /v1/search?q=` (pg_trgm) reachable.
- **Steps:** (1) Type ≥1 char → debounced 200ms request. (2) Dropdown shows token rows + creator rows. (3) Enter navigates to best match; creator click filters the grid by creator.
- **assertable-layers:** indexed · UI. _(No on-chain surface — search is a pure indexer query; see waivers.)_

---

## 2. Token Detail — `/t/[address]` (§5.2)

### `@flow:TD-1` — Venue-continuous candles: load, interval switch, live patch
- **Actors:** Visitor.
- **Preconditions:** token exists; `GET /v1/tokens/:address/candles?interval=&from=&to=` returns one merged series (curve `Trade` + V3 `Swap` events).
- **Steps:** (1) Render one `CandlestickSeries` (1s·15s·1m·5m·15m·1h; default 1m pre-grad / 5m post-grad). (2) Switch interval → backfill via TanStack Query. (3) WS `candle` on `token:{address}:candles:{interval}` patches the current bucket via `series.update()`. (4) Across graduation there is **no seam / gap / second series** — only a labeled annotation line at the graduation timestamp.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-2` — Buy pre-grad (curve): optimistic → reconcile  ·  tx type `buy`
- **Actors:** Trader (wallet connected).
- **Preconditions:** token `status = curve`; buys not paused; quote from on-chain `Router.quoteBuy` (shared math = display fallback/oracle).
- **Steps:** (1) Enter ETH in; widget shows expected out, min-received-after-2%-slippage, "1% curve fee → treasury", price impact. (2) Submit `Router.buy{value}` with a deadline. (3) Optimistic soft-confirmed row appears in TradeFeed immediately (badge amber, pulsing) — never rendered final. (4) WS `trade` (match `txHash`, fallback `sender+nonce`) reconciles amounts/price to indexed truth. (5) `global:confirmations` watermark upgrades the row soft-confirmed → posted → finalized locally (§12.20).
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-3` — Sell pre-grad (curve)  ·  tx type `sell`
- **Actors:** Trader (holds tokens).
- **Preconditions:** token `status = curve`. **Sell path reads no pause flag — always live** (§6.5).
- **Steps:** (1) Sell tab: token in, MAX button, quote from `Router.quoteSell`, min-received + deadline. (2) Submit `Router.sell`. (3) Optimistic → WS reconcile → watermark tiers, as TD-2.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-3b` — Sell pre-grad via permit (no prior approval)  ·  tx type `sellWithPermit`
- **Actors:** Trader with zero curve allowance.
- **Preconditions:** `status = curve`; allowance absent.
- **Steps:** (1) Widget detects missing allowance → offers one EIP-2612 permit signature instead of approve+sell. (2) Submit `Router.sellWithPermit` (single tx). (3) Optimistic → reconcile as TD-3.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-4` — Post-grad buy (Uniswap V3, invisible venue switch)  ·  tx type `post-grad V3 buy`
- **Actors:** Trader.
- **Preconditions:** token `status = graduated`; quote from `QuoterV2` (token/WETH 1% pool).
- **Steps:** (1) Same widget/visual; engine selected by indexed `status`, never a user choice. (2) Fee line reads "Uniswap V3 pool fee: 1%"; footnote "Trading on Uniswap V3" + pool link. (3) Submit `SwapRouter02 exactInputSingle`; native ETH in (router wraps). (4) Optimistic → reconcile → watermark.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-5` — Post-grad sell (Uniswap V3)  ·  tx type `post-grad V3 sell`
- **Actors:** Trader.
- **Preconditions:** `status = graduated`. No pause surface exists post-grad (§6.5).
- **Steps:** (1) Sell via `SwapRouter02` (multicall unwrap → user sees ETH out). (2) Optimistic → reconcile → watermark.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-6` — Graduation venue switch  ·  tx type `graduate()`
- **Actors:** Anyone (permissionless) triggers `graduate()`; Traders observe.
- **Preconditions:** curve reserves reach `GRADUATION_ETH`; token enters `ReadyToGraduate`.
- **Steps:** (1) Threshold crossed → status pill flips to "Graduating…" (see ERR-7). (2) `graduate()` executes → WS `graduated` on `token:{address}:events`. (3) Status flips to "Graduated → Uniswap V3", chart annotation appears, widget re-engines to V3 (TD-4/TD-5), Trust rows 3/4 flip to post-grad states — all WS-driven, no reload.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-7` — Trust panel: seven rows with exact sourcing
- **Actors:** Visitor.
- **Preconditions:** RPC reachable for live reads; indexer verdicts available.
- **Steps:** render (1) ownerless ✓ [indexer provenance], (2) fixed 1B supply ✓ [**live** `totalSupply()` = 1e27], (3) live curve reserves [**live** `BondingCurve.reserves()`, ~5s poll + refresh on each WS trade, **never** cached API values], (4) graduation threshold + progress [live reserves ÷ `GRADUATION_ETH`], (5) LP destination [the single shared LP constant, verbatim], (6) fee policy [live per-token `TRADE_FEE_BPS`, number never a string literal], (7) metadata hash verdict [indexer ✓/⚠, frontend never recomputes-and-overrides]. Post-grad: rows 3/4 show "curve retired — 0 ETH held" + "Graduated ✓".
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-8` — Organic-flow metrics & funding-cluster grouping (v1.2, advisory)
- **Actors:** Visitor.
- **Preconditions:** indexer `trust.organic` (`holderPctLow/High`, `volumePct`, `flaggedClusterVolPct24h`) and per-holder `clusterId`/`botFlags` present. **Blocked by DATA-GAP-1** until `packages/shared`/indexer ship these fields — until then rows render "estimating…"/omit, never a fabricated number.
- **Steps:** (1) Organic-holder estimate renders as a **RANGE** ("~55–70%"), never a point value, with a §8.5 methodology tooltip. (2) Flow quality: "X% organic curve volume (24h)" / "Y% from flagged clusters", neutral wording. (3) Holder rows sharing a `clusterId` visually grouped; `botFlags` render as small advisory badges. Heuristic framing only — gates nothing.
- **assertable-layers:** indexed · UI. _(No on-chain surface by design — §8.5; see waivers.)_

### `@flow:TD-9` — Live trade feed: soft-confirmed badges & tier upgrades
- **Actors:** Visitor.
- **Preconditions:** `GET /v1/tokens/:address/trades?limit=50`; WS `token:{address}:trades`; `global:confirmations` watermark.
- **Steps:** (1) Initial feed loads. (2) WS `trade` prepends; the user's own optimistic trades merge in (§4). (3) `ConfirmationBadge` shows soft-confirmed → posted → finalized as the watermark advances; a row is **never** shown as unqualified-final while soft-confirmed.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-10` — Holder distribution (top 20)
- **Actors:** Visitor.
- **Preconditions:** `GET /v1/tokens/:address/holders?limit=20`.
- **Steps:** (1) Render rank/address/balance/%/bar. (2) Flags: creator / bonding curve / LP fee vault. (3) Refresh on WS trade events (throttled ≥5s). Pre-first-trade: curve row ~100%.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-11` — Token info, Blockscout links, creator profile
- **Actors:** Visitor.
- **Preconditions:** token summary + metadata SSR-fetched.
- **Steps:** (1) Render description + user links (https-only allowlist, see ERR-12). (2) Contract + curve + pool Blockscout links (never `block.number`). (3) Creator profile link + created-at + metadata JSON link.
- **assertable-layers:** indexed · UI. _(Links/metadata are indexer-sourced display; no state change — see waivers.)_

### `@flow:TD-12` — SSR + per-token OG image (viral share unit)
- **Actors:** Crawler / messenger unfurl (no client JS).
- **Preconditions:** token exists; candles/summary reachable.
- **Steps:** (1) Token Detail SSR HTML includes title/description/OG tags + meaningful above-the-fold (name/ticker/mcap/progress/trust summary) with `javaScriptEnabled:false`. (2) `GET /t/[address]/opengraph-image` returns `image/png` 1200×630 (raw satori + resvg): token image + name/ticker + mini-candles (inline SVG, 12h/15m window) + mcap ETH-first (USD only via live endpoint, else degrade to ETH) + graduation progress (or "Graduated → Uniswap V3") + soft-confirmed tagline. Unknown token → 404.
- **assertable-layers:** indexed · UI. _(Render output, not a chain state change — see waivers.)_

---

## 3. Launch — `/create` (§5.3; route renamed from `/launch`, §12.50 — `LAUNCH-*` IDs retained per the stable-ID rule)

### `@flow:LAUNCH-1` — Create token, no initial buy  ·  tx type `createToken`
- **Actors:** Creator (wallet connected).
- **Preconditions:** `pauseCreates` false (live Router read); form valid per shared zod (name ≤32 B, ticker ≤10 B, description ≤500, image ≤4 MB).
- **Steps:** (1) Fill form; image uploaded eagerly via `POST /v1/uploads/image` (API MIME-sniffs + re-encodes; no browser presign, §12.19). (2) `POST /v1/metadata` → `{metadataHash, metadataUri, canonicalJson}`. (3) **Client re-verifies** its own `canonicalizeMetadata`+`keccak256` equals the API hash **before signing** (§12.19 normative). (4) Single `Router.createToken{value: deployFee}` — `deployFee` read live from factory config, never a constant; `minTokensOut = 0`. (5) LaunchProgress stepper: Uploading ✓ → Metadata pinned ✓ → Tx sent → **Soft-confirmed** → redirect `/t/[address]` (address from receipt logs or WS `launch`, whichever first). Tradeable <1s soft-confirmed.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:LAUNCH-2` — Create token with atomic initial creator buy  ·  tx type `createToken` (+ initial buy)
- **Actors:** Creator.
- **Preconditions:** as LAUNCH-1; `initialBuy > 0`.
- **Steps:** (1) Enter initial-buy ETH; live preview shows tokens received (shared curve math) + `minTokensOut` at 2% slippage (anti-self-snipe). (2) Single `Router.createToken{value: deployFee + initialBuy}`. (3) Stepper → soft-confirmed → redirect, as LAUNCH-1; the creator's initial buy appears as the first Trade.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:LAUNCH-3` — Economics panel display (LP copy verbatim + live reads)
- **Actors:** Visitor / Creator.
- **Preconditions:** factory config reachable for live fee/threshold reads.
- **Steps:** (1) EconomicsPanel renders creation fee (live), 1% trade fee → treasury, graduation threshold (live ETH — never the "$69k" figure as USD), LP tranche → Uniswap V3, and the LP-destiny sentence **verbatim from the single shared constant**. No hardcoded market metrics; the forbidden LP verb never appears (grep-enforced by the M3-9 copy-lint).
- **assertable-layers:** UI. _(Pure display of live reads + fixed copy; see waivers.)_

---

## 3b. Portfolio — `/portfolio` (§12.50a; catalog addendum, 2026-07-11)

> **Addendum provenance:** authored per the §8 reconciliation record — `AUTHORED-BY: robbed-frontend  DATE: 2026-07-11` · `RATIFIED-BY: robbed-architect  DATE: 2026-07-11` (verification detail in the sign-off block at the top of this file). Portfolio is **read-only** (§12.50a): it adds **no transaction types** (the 9-type table in §6 stays exhaustive) and **no `collect()` surface** (COLLECT-1 waiver unchanged). Every `PORT-*` flow is therefore <3-layer by nature — there is no on-chain transaction to assert — and each has a P-7 waiver row in `docs/user-flows-waivers.md`.
>
> **Data-freshness note — architect disposition (2026-07-11): ADVISORY-READ SEMANTICS RATIFIED.** Portfolio reads are advisory (`api.md` §3.4a) — TanStack Query with ~15s staleTime + refetch; **no WS channel patches them**, and the "live-patch behavior" flow the §8 addendum anticipated is deliberately **not** authored: `e2e:coverage` must never demand an assertion the product cannot produce (P-7 livelock rule). No portfolio WS-channel requirement is routed to robbed-indexer for v1 — spec §12.50a defines the page as read-only and imposes no live-patch requirement (§5's live-patch obligations are Discover/Token-Detail-specific), the implementation and `api.md` §3.4a already embody advisory reads, and PORT-2's `ConfirmationBadge` renders indexed `confirmationState` (staleness only ever shows a *more conservative* tier — never premature finality, §2.1/§12.20). If a Phase-2 portfolio surface adds live patching, author the new `PORT-*` flow then (stable-ID rule). Recorded in decisions.md §13.

### `@flow:PORT-1` — Connected-wallet portfolio: summary header + holdings (default tab)
- **Actors:** Holder (wallet connected).
- **Preconditions:** `GET /v1/portfolio/:address` (summary roll-up) and `GET /v1/portfolio/:address/holdings` reachable; the address holds ≥1 token.
- **Steps:** (1) Connect wallet → subject resolves to the connected address; the header renders avatar · address chip with the "· you" suffix · "first seen … · N trades" from the summary. (2) Stat cells render TOTAL VALUE (ETH-first with a `UsdAmount` mirror — live source + timestamp, never a USD literal, §2) · LOOT ALL-TIME (the honest **nullable PnL range**, never a fabricated point value) · WALLET ETH — all from the `/v1/portfolio/:address` roll-up, never client price math. (3) Default HOLDINGS tab renders TOKEN / BALANCE / PRICE / VALUE / PNL rows from the holdings payload only; VALUE is client-sortable, default order stays the API's balance-DESC cursor. (4) Mobile: identity block + stat cells stack, the md+ column header hides, rows render as self-labelled cards. (5) Freshness is staleTime + refetch (advisory reads, `api.md` §3.4a) — no WS patch.
- **assertable-layers:** indexed · UI. _(Read-only page — no transaction; see waivers.)_

### `@flow:PORT-2` — Tab switch: ACTIVITY (historical per-address trade slice)
- **Actors:** Holder / Visitor with a resolved subject address.
- **Preconditions:** `GET /v1/portfolio/:address/activity` returns the **shared `TradeRow` shape** (no parallel model).
- **Steps:** (1) Click ACTIVITY — tab state is view-local, not URL (the address is the shareable unit). (2) Rows render AGE · SIDE · TOKEN · AMOUNT · PRICE. (3) Each row carries a `ConfirmationBadge` from the indexed `confirmationState` — a not-yet-finalized trade is never shown unqualified-final (§2.1/§12.20). This is a **historical read**, already reconciled to indexed truth — not the optimistic feed. (4) The token cell links to `/t/[address]`.
- **assertable-layers:** indexed · UI. _(The trades' on-chain legs are asserted in TD-2/TD-3/TD-4/TD-5; see waivers.)_

### `@flow:PORT-3` — Tab switch: CREATED (tokens created by this address)
- **Actors:** Holder / Visitor with a resolved subject address.
- **Preconditions:** `GET /v1/portfolio/:address/created` returns the **same `TokenCard` projection as `/v1/tokens`** (anti-drift — the `entities/token` card is reused verbatim); listing-gated server-side (§8.4).
- **Steps:** (1) Click CREATED → grid of TokenCards (responsive 1/2/3 columns). (2) The client renders whatever the API lists — no client-side moderation logic. (3) Empty → "No tokens created" + CTA to `/create`. (4) Card click → `/t/[address]`.
- **assertable-layers:** indexed · UI. _(Creation's on-chain leg is asserted in LAUNCH-1/LAUNCH-2; see waivers.)_

### `@flow:PORT-4` — Disconnected: connect-wallet empty state
- **Actors:** Visitor (no wallet, no explicit subject).
- **Preconditions:** no wallet connected and no `?address=` query param.
- **Steps:** (1) `/portfolio` renders the "Connect a wallet" empty state with the connect button — **no portfolio request is issued** (queries stay disabled until a subject exists). (2) Connecting a wallet transitions to PORT-1 in place, no reload.
- **assertable-layers:** UI. _(No subject → no request → nothing on-chain or indexed exists to assert; see waivers.)_

### `@flow:PORT-5` — Cursor pagination (load-more) on the list tabs
- **Actors:** Holder / Visitor with a resolved subject address.
- **Preconditions:** a list endpoint (`/holdings`, `/activity`, or `/created`) returns a non-null `nextCursor` (page size 50).
- **Steps:** (1) The "Load more" button renders only while `nextCursor` is non-null. (2) Click → the next cursor page is fetched and **appended** (infinite query — prior rows keep identity, no re-order jump). (3) While fetching, the button shows "Loading…" and is disabled. (4) On the final page (`nextCursor: null`) the button disappears. Applies uniformly to HOLDINGS, ACTIVITY, and CREATED.
- **assertable-layers:** indexed · UI. _(Pure indexer-read paging; see waivers.)_

### `@flow:PORT-6` — Address-subject variant: viewing an arbitrary wallet (`?address=`)
- **Actors:** Visitor (wallet optional).
- **Preconditions:** `/portfolio?address=0x…` with a well-formed 40-hex address (validated in the server shell; malformed values are ignored and the subject falls back to the connected wallet).
- **Steps:** (1) The explicit `?address=` takes precedence over the connected wallet as the subject. (2) The header omits the "· you" suffix unless the subject equals the connected wallet. (3) The surface is identical and **read-only** — no trade or collect affordance appears for a foreign address. (4) Switching subjects swaps caches cleanly (query keys are namespaced by lowercased address — no cross-address bleed).
- **assertable-layers:** indexed · UI. _(Same read-only indexer reads with a different subject; see waivers.)_

### `@flow:PORT-7` — Empty portfolio (never-traded address; never a 404)
- **Actors:** Holder with a fresh wallet / Visitor viewing an unknown address.
- **Preconditions:** the subject address has no trades, holdings, or created tokens; `api.md` §3.4a guarantees any address resolves to at worst an **empty** portfolio, never a 404.
- **Steps:** (1) Summary renders honestly-empty values (zero/none — no fabricated numbers). (2) HOLDINGS → "No holdings yet" + Discover CTA (`/`). (3) ACTIVITY → "No trades yet". (4) CREATED → "No tokens created" + `/create` CTA. (5) Emptiness never gets error treatment.
- **assertable-layers:** indexed · UI. _(The empty payload is itself an indexer response; see waivers.)_

### `@flow:PORT-8` — Portfolio read failure → per-region error state + retry
- **Actors:** Holder / Visitor with a resolved subject address.
- **Preconditions:** a `/v1/portfolio/*` read fails (API unreachable, non-JSON, or error envelope).
- **Steps:** (1) The failing region renders its `ErrorState` ("Couldn't load summary / holdings / activity / created") with a retry action → refetch. (2) Regions degrade **independently** — a failing summary does not blank the tabs and vice versa. (3) No cached or fabricated substitute values are rendered (§2).
- **assertable-layers:** UI. _(The failure produces no indexed payload and touches no chain state; the successful-read legs are PORT-1/2/3; see waivers.)_

---

## 4. Transaction types without a dedicated page surface

### `@flow:COLLECT-1` — LP fee sweep  ·  tx type `collect(tokenId)`
- **Actors:** Anyone (permissionless); proceeds go only to the fixed treasury.
- **Preconditions:** graduated token with accrued V3 LP fees; `LPFeeVault.collect(tokenId)` (no owner, no withdraw, sole external fn).
- **Steps:** (1) `collect(tokenId)` called. (2) Fees route to the Gnosis Safe treasury; LP principal stays permanently locked. **No v1 UI surface** triggers this (treasury-facing; the §12.50 Portfolio page is read-only and exposes no collect surface).
- **assertable-layers:** on-chain · indexed. _(UI = N/A in v1 — no page surface; see waivers.)_

---

## 5. Error & edge paths

### `@flow:ERR-1` — Slippage revert (buy or sell)
- **Actors:** Trader.
- **Preconditions:** market moves so `amountOut < minReceived`.
- **Steps:** (1) Submit trade. (2) Tx reverts on the min-received guard. (3) UI shows an error state, refreshes the quote, keeps the widget usable; no optimistic row is promoted to indexed.
- **assertable-layers:** on-chain · UI. _(Reverted tx → no indexed Trade; see waivers.)_

### `@flow:ERR-2` — Deadline expiry
- **Actors:** Trader.
- **Preconditions:** the deadline (recomputed at submit) elapses before inclusion.
- **Steps:** (1) Submit. (2) Tx reverts on the deadline. (3) UI error + fresh quote; a stale quote can never ship an expired deadline (deadline recomputed at submit).
- **assertable-layers:** on-chain · UI. _(No indexed Trade; see waivers.)_

### `@flow:ERR-3` — Anti-sniper per-tx cap hit (early window)
- **Actors:** Trader inside the early-launch window.
- **Preconditions:** token younger than `EARLY_WINDOW_END`; buy exceeds `MAX_EARLY_BUY`.
- **Steps:** (1) Widget surfaces "Early-launch buy cap: max X ETH per transaction" (read live) to prevent the revert. (2) If submitted over cap anyway, tx reverts; UI shows the cap error.
- **assertable-layers:** on-chain · UI. _(Preventive UI + revert; no indexed Trade on the reverted attempt; see waivers.)_

### `@flow:ERR-4` — Sell stays open while buys paused (§6.5)
- **Actors:** Trader.
- **Preconditions:** Router `pauseBuys = true` (and/or `pauseCreates = true`).
- **Steps:** (1) Buy tab disabled with exact copy "Buying is temporarily paused — selling remains open". (2) **Sell tab fully live, reads no pause flag**, submits `Router.sell` end-to-end → indexed Trade. This is the CLAUDE.md sells-always-open invariant.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:ERR-5` — Sell stays open while treasury reverts (§12.25)
- **Actors:** Trader.
- **Preconditions:** treasury fee-sink would revert on a push transfer (hostile/paused Safe); curve fee is a **pull-payment** accrual (§12.25), so it does not push to the treasury on the trade path.
- **Steps:** (1) Submit `Router.sell`. (2) Sell **succeeds** because the fee accrues to a pull-payment balance rather than being pushed to the treasury inline — a reverting treasury can never wedge a sell. (3) Optimistic → reconcile → indexed Trade.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:ERR-6a` — Metadata hash mismatch: client re-verify blocks signing (§12.19)
- **Actors:** Creator.
- **Preconditions:** API returns a `metadataHash` that ≠ the client's own `canonicalizeMetadata`+`keccak256`.
- **Steps:** (1) Client recomputes and detects the mismatch. (2) **Signing is blocked** — the user is never committed to metadata they did not write; error surfaced; no tx broadcast.
- **assertable-layers:** UI. _(Client-side guard prevents any tx → no on-chain / indexed record; see waivers.)_

### `@flow:ERR-6b` — Metadata mismatch verdict on Trust panel (§8.3)
- **Actors:** Visitor.
- **Preconditions:** on-chain committed `metadataHash` ≠ indexer's keccak of the fetched canonical JSON (metadata changed after launch).
- **Steps:** (1) Indexer emits the ⚠ MISMATCH verdict. (2) Trust panel row 7 renders the red prominent "MISMATCH — metadata changed after launch", linking both hashes + the R2 JSON. Frontend renders the indexer verdict, never recomputes-and-overrides.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:ERR-7` — Graduating-window lock (ReadyToGraduate, §12.12)
- **Actors:** Trader.
- **Preconditions:** curve at threshold, `graduate()` not yet executed (`status = graduating`).
- **Steps:** (1) Widget shows a two-sided "Graduating to Uniswap V3…" interstitial and disables **both** buy and sell inputs for the interstitial seconds. (2) Copy must **not** say "paused" — it is a deterministic, permissionlessly-exitable protocol state. (3) On WS `graduated`, flips to `graduated` (→ TD-6).
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:ERR-8` — Launch blocked while creates paused
- **Actors:** Creator.
- **Preconditions:** Router `pauseCreates = true` (live read).
- **Steps:** (1) Submit disabled with "New launches are temporarily paused." (2) Sells and other surfaces elsewhere are unaffected (granular flags, §6.5). No tx broadcast.
- **assertable-layers:** on-chain · UI. _(Config read + disabled submit; no state change / indexed record; see waivers.)_

### `@flow:ERR-9` — Wallet rejects the transaction
- **Actors:** Trader / Creator.
- **Preconditions:** user declines the signature in-wallet (buy/sell/createToken).
- **Steps:** (1) The optimistic row (or Launch stepper) is removed/reset with a toast; form/quote state preserved. (2) Uploaded image/metadata hash reusable on retry (unchanged).
- **assertable-layers:** UI. _(No broadcast → no on-chain / indexed record; see waivers.)_

### `@flow:ERR-10` — Transaction reverts on-chain (generic)
- **Actors:** Trader / Creator.
- **Preconditions:** RPC receipt returns `reverted` (non-slippage/deadline cause).
- **Steps:** (1) The optimistic:pending row transitions to `failed` (error treatment + toast), quote refreshed. (2) Blockscout tx link shown; a soft-confirmed row is never left rendered as final.
- **assertable-layers:** on-chain · UI. _(Reverted tx → no indexed Trade; see waivers.)_

### `@flow:ERR-11` — WS reconnect / seq-gap heal
- **Actors:** Any live viewer.
- **Preconditions:** socket drops or a `seq` gap is detected (no replay buffer, §12.23).
- **Steps:** (1) Degraded banner "Live updates degraded — reconnecting"; backoff 0.5→8s. (2) On reconnect **or** seq gap, invalidate all live query keys (`tokens`, `token:*`, `trades:*`, `candles:*`) → REST re-serves resumable truth, closing the gap. WS is a patch stream; REST is the source of truth.
- **assertable-layers:** indexed · UI. _(Recovery is client + REST; no chain state change — see waivers.)_

### `@flow:ERR-12` — Stored-link XSS render safety (UM-5)
- **Actors:** Visitor viewing a token whose user links carry a `javascript:`/`data:` payload.
- **Preconditions:** malicious `links` reach the client (API already rejects non-`https:`; the frontend re-checks).
- **Steps:** (1) Links render only as `https:` anchors with `rel="noopener noreferrer"` under a strict CSP. (2) A `javascript:`/`data:` href **never** reaches the DOM; no script executes.
- **assertable-layers:** indexed · UI. _(Render-safety assertion; no chain state — see waivers.)_

### `@flow:ERR-13` — Trust-panel RPC read failure
- **Actors:** Visitor.
- **Preconditions:** RPC unavailable for the live reads (rows 2/3/4/6).
- **Steps:** (1) Affected rows show "on-chain read unavailable — retry". (2) The API's cached reserve values are **never** substituted (§5.2). `allowFailure: true` degrades one row, not the whole panel.
- **assertable-layers:** on-chain · UI. _(Failed read → nothing indexed for the failure; see waivers.)_

### `@flow:ERR-14` — WS silence on an optimistic trade
- **Actors:** Trader with a soft-confirmed optimistic row.
- **Preconditions:** RPC receipt success, but no WS `trade` within 10s.
- **Steps:** (1) Row kept; badge gains an "awaiting index" tooltip. (2) REST poll `GET /v1/trades/:txHash` fills in indexed truth. (3) Escalate to an error state only on indexer-confirmed absence after 30s — never silently promoted, never silently dropped.
- **assertable-layers:** on-chain · indexed · UI.

---

## 6. Traceability — every §5.1–5.3 feature bullet maps to ≥1 flow

### §5.1 Discover
| Spec bullet | Flow ID(s) |
|---|---|
| King of the Hill hero (closest to graduation, volume-weighted) | DISC-1 |
| Live launch ticker (WebSocket) | DISC-2 |
| Token grid: sorts trending/newest/mcap/24h-volume/progress; filters pre-grad/graduated/all | DISC-3 |
| Search: name, ticker, contract, creator (pg_trgm) | DISC-4 |
| Card: image, name, ticker, mcap, progress bar, 24h Δ%, creator, age | DISC-3 |

### §5.2 Token Detail
| Spec bullet | Flow ID(s) |
|---|---|
| Live candles 1s→1h, venue-continuous across graduation | TD-1 (continuity also asserted in TD-6) |
| Buy/Sell widget: curve pre-grad, V3 post-grad invisible switch; slippage 2% + deadline | TD-2, TD-3, TD-3b, TD-4, TD-5 |
| Trust panel (7 rows) | TD-7 |
| Organic-flow metrics: organic-holder range, flow quality, funding-cluster grouping | TD-8 |
| Live trade feed (soft-confirmed badge) | TD-9 |
| Holder distribution (top 20; creator/curve/vault flagged) | TD-10 |
| Token info, Blockscout links, creator profile | TD-11 |
| SSR + per-token OG image (chart snapshot + mcap + progress) | TD-12 |

### §5.3 Launch
| Spec bullet | Flow ID(s) |
|---|---|
| Form: name, ticker ≤10, description ≤500, image required (≤4MB, re-encoded), optional links | LAUNCH-1 |
| Image through API (MIME sniff + re-encode); metadata canonicalized; client re-verifies hash before signing | LAUNCH-1 (mismatch path ERR-6a) |
| Optional atomic initial creator buy (anti-self-snipe) | LAUNCH-2 |
| One tx: `Router.createToken{value: deployFee + initialBuy}`; tradeable <1s soft-confirmed | LAUNCH-1, LAUNCH-2 |
| Economics displayed plainly + exact LP copy (never "burned") | LAUNCH-3 |

### §12.50a Portfolio (addendum §3b — ratified 2026-07-11)
| Surface bullet (§12.50a / implemented page) | Flow ID(s) |
|---|---|
| Address header (avatar · address · "· you" · first-seen / trade count) | PORT-1, PORT-6 |
| Stat cells TOTAL VALUE / LOOT ALL-TIME / WALLET ETH (ETH-first, live USD mirror, nullable PnL range) | PORT-1 |
| HOLDINGS tab (table; mobile card layout) | PORT-1 |
| ACTIVITY tab (per-address `TradeRow` slice, confirmation badges) | PORT-2 |
| CREATED tab (`TokenCard` grid, listing-gated) | PORT-3 |
| Disconnected-wallet connect prompt | PORT-4 |
| Cursor pagination / load-more (all three list tabs) | PORT-5 |
| Arbitrary-address subject (`?address=`) | PORT-6 |
| Empty portfolio (never a 404) | PORT-7 |
| Read-failure states + retry | PORT-8 |

### Transaction-type coverage (task-required)
| Transaction type | Flow ID |
|---|---|
| `createToken` (no initial buy) | LAUNCH-1 |
| `createToken` + initial buy | LAUNCH-2 |
| `buy` | TD-2 |
| `sell` | TD-3 |
| `sellWithPermit` | TD-3b |
| `graduate()` | TD-6 |
| post-grad V3 buy | TD-4 |
| post-grad V3 sell | TD-5 |
| `collect(tokenId)` | COLLECT-1 |

### Error-path coverage (task-required)
| Error path | Flow ID |
|---|---|
| Slippage revert | ERR-1 |
| Deadline expiry | ERR-2 |
| Anti-sniper cap hit | ERR-3 |
| Sells-open-while-buys-paused | ERR-4 |
| Sells-open-while-treasury-reverts (§12.25) | ERR-5 |
| Metadata hash mismatch (client pre-sign) | ERR-6a |
| Metadata mismatch verdict (Trust panel §8.3) | ERR-6b |
| Graduating-window lock (§12.12) | ERR-7 |
| Launch blocked while creates paused | ERR-8 |
| Wallet rejects tx | ERR-9 |
| Tx reverts on-chain (generic) | ERR-10 |
| WS reconnect / seq-gap heal | ERR-11 |
| Stored-link XSS render safety | ERR-12 |
| Trust-panel RPC read failure | ERR-13 |
| WS silence on optimistic trade | ERR-14 |

**Coverage:** all §5.1 (5/5), §5.2 (8/8), §5.3 (5/5) bullets and all 9 transaction types + 15 error paths map to a flow ID. No gaps. The §12.50a Portfolio surface maps to `PORT-1`–`PORT-8` (addendum §3b, ratified 2026-07-11) — read-only, so the transaction-type and error-path tables above are unchanged.

## 7. Flow inventory

- Discover: DISC-1..4 (4)
- Token Detail: TD-1, TD-2, TD-3, TD-3b, TD-4, TD-5, TD-6, TD-7, TD-8, TD-9, TD-10, TD-11, TD-12 (13)
- Launch: LAUNCH-1, LAUNCH-2, LAUNCH-3 (3)
- Portfolio (addendum §3b, 2026-07-11 — ratified): PORT-1..8 (8)
- Transaction-only: COLLECT-1 (1)
- Errors/edges: ERR-1..ERR-14 with ERR-6 split a/b → 15 flows
- **Total: 44 flows** (36 ratified M3-11 + 8 `PORT-*` addendum flows ratified 2026-07-11) — **this 44-flow total is the I-5a `e2e:coverage` baseline.**

See `docs/user-flows-waivers.md` for every flow declaring fewer than three assertable layers.

## 8. Redesign reconciliation — ratification addendum (robbed-architect, 2026-07-11)

The ratified four-page redesign (**spec §12.50**, `docs/design/robbed-redesign-plan.md`) landed after this catalog was authored against the three-page §5 baseline. Reconciliation record:

- **`/launch` → `/create` rename (§12.50b):** applied throughout this catalog (§3 heading). `LAUNCH-*` flow IDs are **retained** — the stable-ID rule means IDs never encode routes; re-IDing to `CREATE-*` would churn every `@flow:` tag for zero information. New Create-page-specific flows (if any) may use either prefix; extend `LAUNCH-*` for continuity.
- **Portfolio `/portfolio` (§12.50a) — coverage gap CLOSED (authored + ratified 2026-07-11):** the original gap record (this catalog contained no `PORT-*` flows; required addendum, owner robbed-frontend → architect, due before the I-5a `e2e:coverage` baseline is frozen; minimum expected flows: header stats render — TOTAL VALUE / LOOT ALL-TIME / WALLET ETH, indexer/API-sourced, never client price math, no USD literals per §2 — HOLDINGS / ACTIVITY / CREATED tabs, disconnected-wallet + empty states, and live-patch behavior) is discharged. Portfolio is **read-only**: it adds **no transaction types** (the 9-type table above stays exhaustive) and **no `collect()` surface** (COLLECT-1 waiver unchanged).
  - **GAP CLOSED — `PORT-*` addendum authored (§3b):** `AUTHORED-BY: robbed-frontend  DATE: 2026-07-11` · `RATIFIED-BY: robbed-architect  DATE: 2026-07-11`. Eight flows `PORT-1`–`PORT-8` land in §3b with a §6 traceability table, the §7 inventory update (36 → 44), and matching P-7 waiver rows in `docs/user-flows-waivers.md` (every `PORT-*` flow is <3-layer — Portfolio has no on-chain transaction surface). Coverage of the "minimum expected" list: header stats → PORT-1; tabs → PORT-1/2/3; disconnected + empty states → PORT-4/PORT-7; pagination → PORT-5; arbitrary-address subject (`?address=`, implemented in the route shell) → PORT-6; read-failure → PORT-8. **One deliberate deviation from the expectation list, DISPOSITIONED BY THE RATIFIER:** no **live-patch** flow exists, because the shipped implementation (and `api.md` §3.4a) makes portfolio reads **advisory** — no WS channel patches them; freshness is ~15s staleTime + refetch (recorded in the flows). Authoring a live-patch flow would make `e2e:coverage` demand an assertion that can never exist (P-7's livelock rule). **Architect disposition (2026-07-11): advisory-read semantics RATIFIED as-is; no portfolio WS-channel requirement is routed to robbed-indexer for v1** (rationale in the §3b freshness note; recorded in decisions.md §13).
- **Everything else:** re-skin only — the DISC-\*/TD-\* flows, all protocol/copy constraints (§2, §6.5, §12.14, §12.19, §12.20, §12.25), and the waiver set are unaffected by §12.50.
