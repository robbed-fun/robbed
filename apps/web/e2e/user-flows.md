# ROBBED_ — User-Flow Catalog (`apps/web`)

**Owner:** hoodpad-frontend (author)
**Design docs:** `docs/developers/web.md` (product pages, trade widget, trust surface) · `docs/developers/architecture.md` (confirmation tiers) · `docs/developers/contracts.md` (sells-always-open, graduation, fees) · the design decisions log

## Purpose & conventions

This is the authoritative catalog of every user flow across the app's pages (three at authoring time; **four since the four-page redesign** — see section 8) plus every on-chain transaction type and every error path the product must handle. It is the coverage target for the **I-5 e2e harness** (env-gated, built later): each Playwright spec carries a `@flow:<ID>` tag, and `bun run e2e:coverage` diffs catalog IDs against tagged tests **and** checks each tagged test asserts its declared `assertable-layers` (honoring `user-flows-waivers.md`). This document is the deliverable now; the tests come with I-5a/I-5b.

**Stable IDs** never change once assigned (renaming = new ID + tombstone; IDs never encode routes). Groups: `DISC-*` (Discover), `TD-*` (Token Detail), `LAUNCH-*` (Launch), `PORT-*` (Portfolio — addendum in section 3b), `TX-*`/`COLLECT-*` (transaction types with no dedicated page surface), `ERR-*` (error/edge paths).

**`assertable-layers`** — which of the three truth layers a flow can be asserted at (P-7: error paths that produce no indexer record declare fewer):
- **on-chain** — a state change / revert observable via `eth_call` or receipt status on the fork.
- **indexed** — a record the indexer materializes (Trade/Launch/Graduated/holder/candle/verdict) reachable over REST/WS.
- **UI** — a DOM assertion in `apps/web` (rendered value, badge, disabled state, error surface).

Flows declaring fewer than three layers have a rationale row in `user-flows-waivers.md`.

**Non-negotiables carried into every trade flow** (CLAUDE.md; the product + contract hard rules): the sell path reads **no** pause flag (sells-always-open); every trade renders soft-confirmed first and reconciles to indexed truth, **never final while soft-confirmed, never dropped on contradiction**; slippage default 2% + deadline on every trade; no order-book / real-time-exchange framing; no USD/mcap/volume literals; the LP sentence renders only from the single shared constant.

---

## 1. Discover — `/`

### `@flow:DISC-1` — TRENDING carousel + token-card grid: Discover paints _(D-73: event tape retired; the D-70 grid is the browse surface below the carousel)_
- **Actors:** Visitor (no wallet required).
- **Preconditions:** ≥1 token exists; API `GET /v1/tokens?sort=volume24h` (TRENDING carousel — volume-weighted, **API-owned order**; frontend renders the returned order, never ranks) and `GET /v1/tokens?sort=trending&filter=all` (the grid's SSR seed) reachable.
- **Steps:** (1) SSR fetches both lists via **isolated fetches** (a TRENDING failure never blanks the grid and vice versa) and paints the TRENDING carousel — ranked full-bleed cards: image · #rank · name · ticker · 24h Δ% — over the **token-card grid** (D-70; primary browse surface, the carousel stays). (2) The grid renders the API's returned order **verbatim** — server-authoritative, the client never re-ranks (each `TokenCard` is `role="link"`, aria-label "`<name> (<ticker>)`"). (3) Carousel rank-1 card click → `/t/[address]`. Card metrics come from indexer payloads only — never client price math (no-market-metrics rule).
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:DISC-2` — A new launch surfaces in the Discover grid _(D-73: replaces the retired tape's WS "slide-in")_
- **Actors:** Visitor.
- **Preconditions:** Discover open; API `GET /v1/tokens` reachable. **The event tape is retired (D-73), so there is no WS "slide-in".** The `global:metrics` sync only PATCHES cards already cached by reference — it never INSERTS a net-new token (`views/discover/model/metrics.ts` `applyMetricToList`) — so a fresh launch surfaces in the grid via the tokens REST path (a fresh sort-tab fetch / SSR revalidate ~5s).
- **Steps:** (1) A token is launched while Discover is open. (2) The indexer materializes it into `GET /v1/tokens` (the grid's source). (3) Sorting the grid by **Newest** issues a client-side `getTokens({ sort: "newest" })` fetch → the just-launched token surfaces at the head as a `TokenCard`. (4) Card click → `/t/[address]`.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:DISC-3` — Discover grid: view-local sort/filter tabs + card navigation _(D-73: replaces the retired tape's tab filter; the grid regains the sort/filter surface)_
- **Actors:** Visitor.
- **Preconditions:** API `GET /v1/tokens?sort=&filter=` reachable (D-22). Grid controls are **view-local** (the Discover URL-state stays retired — only `?q=` is a URL param, D-50).
- **Steps:** (1) The grid renders `TokenCard`s seeded from `GET /v1/tokens` (default `sort=trending&filter=all`); card mcap/Δ%/status resolve **by reference from the indexer aggregates**, never fabricated (no-market-metrics rule). (2) **Sort tabs** {trending, newest, mcap, volume24h} dispatch a `?sort=` refetch — **Newest** floats a just-created token to the head (server order, verbatim). (3) **Filter tabs** {all, pregrad, graduated} dispatch a `?filter=` refetch — **Graduated** server-filters a pre-grad curve token OUT of the grid, **Pre-grad** returns it (never a client-side moderation). (4) Card click → `/t/[address]`.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:DISC-4` — Search (name / ticker / contract / creator)
- **Actors:** Visitor.
- **Preconditions:** API `GET /v1/search?q=` (pg_trgm) reachable.
- **Steps:** (1) Type ≥1 char → debounced 200ms request. (2) Dropdown shows token rows + creator rows. (3) Enter navigates to best match; a creator click deep-links `/?q=<creator>`, which seeds the header SearchBox from the URL (the retired grid's creator filter).
- **assertable-layers:** indexed · UI. _(No on-chain surface — search is a pure indexer query; see waivers.)_

---

## 2. Token Detail — `/t/[address]`

### `@flow:TD-1` — Venue-continuous candles: load, interval switch, live patch
- **Actors:** Visitor.
- **Preconditions:** token exists; `GET /v1/tokens/:address/candles?interval=&from=&to=` returns one merged series (curve `Trade` + V3 `Swap` events).
- **Steps:** (1) Render one `CandlestickSeries` (1s·15s·1m·5m·15m·1h; default 1m pre-grad / 5m post-grad). (2) Switch interval → backfill via TanStack Query. (3) WS `candle` on `token:{address}:candles:{interval}` patches the current bucket via `series.update()`. (4) Across graduation there is **no seam / gap / second series** — only a labeled annotation line at the graduation timestamp.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-2` — Buy pre-grad (curve): optimistic → reconcile  ·  tx type `buy`
- **Actors:** Trader (wallet connected).
- **Preconditions:** token `status = curve`; buys not paused; quote from on-chain `Router.quoteBuy` (shared math = display fallback/oracle).
- **Steps:** (1) Enter ETH in; widget shows expected out, min-received-after-2%-slippage, "1% curve fee → treasury", price impact. (2) Submit `Router.buy{value}` with a deadline. (3) Optimistic row appears in TradeFeed immediately (soft-confirmed STATE — no visible "soft-confirmed" chip) — never rendered final. (4) WS `trade` (match `txHash`, fallback `sender+nonce`) reconciles amounts/price to indexed truth. (5) `global:confirmations` watermark upgrades the row (soft-confirmed → posted → finalized) locally, surfacing the posted/finalized chip.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-3` — Sell pre-grad (curve)  ·  tx type `sell`
- **Actors:** Trader (holds tokens).
- **Preconditions:** token `status = curve`. **Sell path reads no pause flag — always live** (sells-always-open).
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
- **Preconditions:** `status = graduated`. No pause surface exists post-grad (sells-always-open).
- **Steps:** (1) Sell via `SwapRouter02` (multicall unwrap → user sees ETH out). (2) Optimistic → reconcile → watermark.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-6` — Graduation venue switch  ·  tx type `graduate()`
- **Actors:** Anyone (permissionless) triggers `graduate()`; Traders observe.
- **Preconditions:** curve reserves reach `GRADUATION_ETH`; token enters `ReadyToGraduate`.
- **Steps:** (1) Threshold crossed → status pill flips to "Graduating…" (see ERR-7). (2) `graduate()` executes → WS `graduated` on `token:{address}:events`. (3) Status flips to "Graduated → Uniswap V3", chart annotation appears, widget re-engines to V3 (TD-4/TD-5) — all WS-driven, no reload. _(SafetyStrip removal: the SafetyStrip/Trust post-grad rows were removed with the strip; the venue switch on the widget is the asserted surface.)_
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-6b` — Graduation succeeds despite a large curve donation (F-1 regression) · tx type `graduate()`
> _A curve donation above ~1% of `GRADUATION_ETH` (≈0.079 ETH on the M0 fixture) once pushed the V3Migrator's WETH-min floor to the donation-inflated `wethForMint`, so `NPM.mint` reverted “Price slippage check”, `graduate()` reverted, and the curve FROZE in `ReadyToGraduate`. The fix anchors `wethMin` to `min(wethForMint, W*)` where `W* = GRADUATION_ETH − CALLER_REWARD − GRADUATION_FEE`; the donated ETH has no paired token and surfaces as WETH dust to the treasury. Graduation is keeper-driven (uniform with GRAD-AUTO): the flow never calls graduate() — the compose keeper can only reach `Graduated` if the fix holds. Full three-layer; no waiver._
- **Actors:** Trader (funds the curve); the compose keeper (permissionlessly fires `graduate()`); Visitor observes.
- **Preconditions:** a token on the curve; the deployed `V3Migrator` carries the F-1 fix; the compose keeper is running (auto-graduates `ReadyToGraduate` curves).
- **Steps:** (1) Donate ETH to the CURVE address ABOVE the freeze threshold (≥0.2 ETH — well over ~1% of `GRADUATION_ETH`) via a raw value send (the curve's ungated `receive()`). (2) Buy the curve to `GRADUATION_ETH` → `ReadyToGraduate`. (3) The keeper fires `graduate()` and it SUCCEEDS despite the donation. (4) The donation surfaces as WETH dust to the treasury (`Graduated.wethDustToTreasury > 0`); the curve retains only its unswept fee escrow (`balance == accruedFees + accruedCreatorFees` — the donation did NOT strand); the LP-position NFT is owned by `LPFeeVault`. (5) The indexer flips `status=graduated` with the V3 pool set; token detail renders the graduated badge + the V3 venue.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-7` — Token detail: retired LP-destiny disclosure stays off the page
- **Actors:** Visitor.
- **Preconditions:** token indexed (SSR summary reachable).
- **Steps:** (1) `/t/[address]` renders `TokenInfo`. (2) The retired LP sentence is ABSENT from token detail, along with the deleted SafetyStrip's live reserves / graduation / ownerless / fixed-supply / metadata ticks. The LP sentence still renders only on surfaces that intentionally use the shared constant, e.g. LAUNCH-3.
- **assertable-layers:** UI. _(SafetyStrip + TokenInfo LP footnote removed; no chain read, indexed record, or token-detail LP display remains. On-chain + indexed waived; see waivers.)_

### `@flow:TD-8` — Advisory heuristic flags on the Top Holders table (heuristic)
- **Actors:** Visitor.
- **Preconditions:** indexer holder rows carry the advisory-flag vocabulary (`botFlags`/`flags`); `clusterId`/`botFlags` may be absent on a fresh fork token. **DATA-GAP-1** context: when no bot flags are present the chips simply omit — never a fabricated signal.
- **Steps:** (1) The Top Holders table renders; where a holder carries `botFlags`, they show as small **advisory** chips (sniper/programmatic/…), heuristic framing only — gating nothing. (2) The standalone organic-holder range + flow-quality % blocks are ABSENT from the public page (moved to the internal trust surface).
- **assertable-layers:** indexed · UI. _(No on-chain surface by design — advisory heuristics; see waivers.)_

### `@flow:TD-9` — Live trade feed: tier upgrades (soft-confirmed chip removed)
- **Actors:** Visitor.
- **Preconditions:** `GET /v1/tokens/:address/trades` (server-sorted `Paginated<TradeRow>`); WS `token:{address}:trades`; `global:confirmations` watermark.
- **Steps:** (1) Initial feed loads (common DataTable). (2) WS `trade` prepends into the live head; the user's own optimistic trades merge in (optimistic → reconcile). (3) A fresh (soft-confirmed) row shows **no** settlement chip; `ConfirmationBadge` surfaces only **posted to L1 → finalized** as the watermark advances; a row is **never** shown as unqualified-final.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-10` — Top Holders table (rank · address · label · amount · %)
- **Actors:** Visitor.
- **Preconditions:** `GET /v1/tokens/:address/holders` (server-sorted `Paginated<HolderRow>`, `{items, nextCursor}`).
- **Steps:** (1) Render rows **rank · address · label · amount · %**; label = Bonding curve / Creator / LP fee vault (+ advisory chips). (2) Column headers dispatch SERVER-SIDE sort (`?sort=&dir=`), never client sort; keyset pager over an opaque cursor. (3) Refresh on WS trade events (throttled ≥5s). Pre-first-trade: the bonding-curve row holds ~100%.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:TD-11` — Token info, Blockscout links, creator profile
- **Actors:** Visitor.
- **Preconditions:** token summary + metadata SSR-fetched.
- **Steps:** (1) Render description + user links (https-only allowlist, see ERR-12). (2) Contract + curve + pool Blockscout links (never `block.number`). (3) Creator profile link + created-at + metadata JSON link.
- **assertable-layers:** indexed · UI. _(Links/metadata are indexer-sourced display; no state change — see waivers.)_

### `@flow:TD-12` — SSR + per-token OG image (viral share unit)

- **Actors:** Crawler / messenger unfurl (no client JS).
- **Preconditions:** token exists and is indexed (summary reachable for SSR + the API OG data read).
- **Steps:** (1) Token Detail SSR HTML includes title/description/OG tags + meaningful above-the-fold (name/ticker/mcap/progress) with `javaScriptEnabled:false`; `generateMetadata` emits `og:image` as the **absolute API URL** `{API_ORIGIN}/v1/og/{address}.png` (`token-detail/model/metadata.ts`) — no web OG route exists post-relocation. (2) `GET {API_ORIGIN}/v1/og/{address}.png` returns `image/png` 1200×630 (API-rendered native satori + resvg, R2-cached `og/{address}/{version}.png`): token image + name/ticker + mini-candles sparkline + mcap ETH-first (USD only via live endpoint, else degrade to ETH) + graduation progress (or "Graduated → Uniswap V3") + soft-confirmed tagline. Unknown token → 404.
- **assertable-layers:** indexed · UI. _(Render output, not a chain state change — see waivers.)_

### `@flow:TD-13` — Token-detail tables: server-side sort + keyset pagination
- **Actors:** Visitor.
- **Preconditions:** `GET /v1/tokens/:address/trades` (and `/holders`) accept the shared allowlist (`tradeListQuerySchema`: `sort` ∈ {age,side,trader,amount,price}, `dir` ∈ {asc,desc}; out-of-allowlist ⇒ 400) and return the `Paginated<TradeRow>` `{items, nextCursor}` envelope; `nextCursor` is opaque + server-signed.
- **Steps:** (1) A column-header click dispatches a SERVER sort — the browser re-requests with `?sort=&dir=` and renders the returned order verbatim (`manualSorting`; never a client re-rank), the active header reflecting the sort (`aria-sort`). (2) The API applies the allowlisted `ORDER BY`; the returned order changes and is keyset-stable. (3) The pager's Next re-requests the next page carrying the opaque `?cursor=`; Prev returns — pages are disjoint and continue the active order across the seam.
- **assertable-layers:** indexed · UI. _(No chain state change — server sort/paging is a pure indexer read; see waivers.)_

---

## 3. Launch — `/create` (route renamed from `/launch` in the four-page redesign — `LAUNCH-*` IDs retained per the stable-ID rule)

### `@flow:LAUNCH-1` — Create token, no initial buy  ·  tx type `createToken`
- **Actors:** Creator (wallet connected).
- **Preconditions:** `pauseCreates` false (live Router read); form valid per shared zod (name ≤32 B, ticker ≤10 B, description ≤500, image ≤4 MB).
- **Steps:** (1) Fill form; image uploaded eagerly via `POST /v1/uploads/image` (API MIME-sniffs + re-encodes; no browser presign). (2) `POST /v1/metadata` → `{metadataHash, metadataUri, canonicalJson}`. (3) **Client re-verifies** its own `canonicalizeMetadata`+`keccak256` equals the API hash **before signing** (normative client re-verify). (4) Single `Router.createToken{value: deployFee}` — `deployFee` read live from factory config, never a constant; `minTokensOut = 0`. (5) LaunchProgress stepper: Uploading ✓ → Metadata pinned ✓ → Tx sent → **Tradeable** → redirect `/t/[address]` (address from receipt logs or WS `launch`, whichever first). Tradeable <1s. _(soft-confirmed-chip removal: the receipt-success node's visible "Soft-confirmed" label was DROPPED — `launchStepLabel("soft-confirmed")` now reads "Tradeable" (`features/launch-token/model/steps.ts`); the internal step name is unchanged and the shared `ConfirmationBadge` stays absent for the soft-confirmed tier. The e2e asserts the "Tradeable" node + the redirect.)_
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

## 3b. Portfolio — `/portfolio` (catalog addendum, 2026-07-11)

> **Portfolio is read-only:** it adds **no transaction types** (the 9-type table in section 6 stays exhaustive) and **no `collect()` surface** (COLLECT-1 waiver unchanged). Every `PORT-*` flow is therefore <3-layer by nature — there is no on-chain transaction to assert — and each has a P-7 waiver row in `user-flows-waivers.md`.
>
> **Data-freshness note:** Portfolio reads are advisory (see `api.md`) — TanStack Query with ~15s staleTime + refetch; **no WS channel patches them**, and the anticipated “live-patch” flow is deliberately **not** authored: `e2e:coverage` must never demand an assertion the product cannot produce (P-7 livelock rule). PORT-2's `ConfirmationBadge` renders indexed `confirmationState` (staleness only ever shows a *more conservative* tier — never premature finality). If a Phase-2 portfolio surface adds live patching, author the new `PORT-*` flow then (stable-ID rule).

### `@flow:PORT-1` — Connected-wallet portfolio: summary header + holdings (default tab)
- **Actors:** Holder (wallet connected).
- **Preconditions:** `GET /v1/portfolio/:address` (summary roll-up) and `GET /v1/portfolio/:address/holdings` reachable; the address holds ≥1 token.
- **Steps:** (1) Connect wallet → subject resolves to the connected address; the header renders avatar · address chip with the "· you" suffix · "first seen … · N trades" from the summary. (2) Stat cells render TOTAL VALUE (ETH-first with a `UsdAmount` mirror — live source + timestamp, never a USD literal — no-market-metrics rule) · LOOT ALL-TIME (the honest **nullable PnL range**, never a fabricated point value) · WALLET ETH — all from the `/v1/portfolio/:address` roll-up, never client price math. (3) Default HOLDINGS tab renders TOKEN / BALANCE / PRICE / VALUE / PNL rows from the holdings payload only; VALUE is client-sortable, default order stays the API's balance-DESC cursor. (4) Mobile: identity block + stat cells stack, the md+ column header hides, rows render as self-labelled cards. (5) Freshness is staleTime + refetch (advisory reads, see `api.md`) — no WS patch.
- **assertable-layers:** indexed · UI. _(Read-only page — no transaction; see waivers.)_

### `@flow:PORT-2` — Tab switch: ACTIVITY (historical per-address trade slice)
- **Actors:** Holder / Visitor with a resolved subject address.
- **Preconditions:** `GET /v1/portfolio/:address/activity` returns the **shared `TradeRow` shape** (no parallel model).
- **Steps:** (1) Click ACTIVITY — tab state is view-local, not URL (the address is the shareable unit). (2) Rows render AGE · SIDE · TOKEN · AMOUNT · PRICE. (3) Each row carries a `ConfirmationBadge` from the indexed `confirmationState` — a not-yet-finalized trade is never shown unqualified-final. **Soft-confirmed-chip removal:** the badge is now CONDITIONAL — the removed soft-confirmed chip means a soft-confirmed row shows NO settlement badge; posted-to-L1 / finalized surface as the watermark advances. This is a **historical read**, already reconciled to indexed truth — not the optimistic feed. (4) The token cell links to `/t/[address]`.
- **assertable-layers:** indexed · UI. _(The trades' on-chain legs are asserted in TD-2/TD-3/TD-4/TD-5; see waivers.)_

### `@flow:PORT-3` — Tab switch: CREATED (tokens created by this address)
- **Actors:** Holder / Visitor with a resolved subject address.
- **Preconditions:** `GET /v1/portfolio/:address/created` returns the **same `TokenCard` projection as `/v1/tokens`** (anti-drift — the `entities/token` card is reused verbatim); listing-gated server-side.
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
- **Preconditions:** the subject address has no trades, holdings, or created tokens; `api.md` guarantees any address resolves to at worst an **empty** portfolio, never a 404.
- **Steps:** (1) Summary renders honestly-empty values (zero/none — no fabricated numbers). (2) HOLDINGS → "No holdings yet" + Discover CTA (`/`). (3) ACTIVITY → "No trades yet". (4) CREATED → "No tokens created" + `/create` CTA. (5) Emptiness never gets error treatment.
- **assertable-layers:** indexed · UI. _(The empty payload is itself an indexer response; see waivers.)_

### `@flow:PORT-8` — Portfolio read failure → per-region error state + retry
- **Actors:** Holder / Visitor with a resolved subject address.
- **Preconditions:** a `/v1/portfolio/*` read fails (API unreachable, non-JSON, or error envelope).
- **Steps:** (1) The failing region renders its `ErrorState` ("Couldn't load summary / holdings / activity / created") with a retry action → refetch. (2) Regions degrade **independently** — a failing summary does not blank the tabs and vice versa. (3) No cached or fabricated substitute values are rendered (no-market-metrics rule).
- **assertable-layers:** UI. _(The failure produces no indexed payload and touches no chain state; the successful-read legs are PORT-1/2/3; see waivers.)_

---

## 4. Transaction types without a dedicated page surface

### `@flow:COLLECT-1` — LP fee sweep  ·  tx type `collect(tokenId)`
- **Actors:** Anyone (permissionless); proceeds go only to the fixed treasury.
- **Preconditions:** graduated token with accrued V3 LP fees; `LPFeeVault.collect(tokenId)` (no owner, no withdraw, sole external fn).
- **Steps:** (1) `collect(tokenId)` called. (2) Fees route to the Gnosis Safe treasury; LP principal stays permanently locked. **No v1 UI surface** triggers this (treasury-facing; the redesigned Portfolio page is read-only and exposes no collect surface).
- **assertable-layers:** on-chain · indexed. _(UI = N/A in v1 — no page surface; see waivers.)_

---

## 4a. Automated graduation — the compose keeper (`apps/keeper`)

### `@flow:GRAD-AUTO` — Compose keeper auto-fires `graduate()` on a ReadyToGraduate curve · tx type `graduate()` (keeper-driven)
> _The `apps/keeper` Bun service auto-fires the permissionless `graduate()` on `ReadyToGraduate` curves (detecting the on-chain `GraduationReady` event over WS, with a DB-poll fallback; dev signer = anvil account #4, chosen OUTSIDE e2e roles 0–3 so it never contends for nonces). This flow proves the end-to-end keeper path: a UI threshold-crossing buy LOCKS the curve and the KEEPER — not the test — graduates it and earns the caller reward. Complements TD-6 (which drives graduate() from the harness). The transient ReadyToGraduate interstitial is asserted at the on-chain layer (phase leaves Trading); the keeper races to clear it by design, so the deterministic graduating-interstitial UI stays owned by ERR-7 (which never graduates). Full three-layer; no waiver._
- **Actors:** Trader (sends the threshold-crossing buy through the UI); the compose keeper (permissionlessly fires `graduate()`); Visitor observes the venue switch.
- **Preconditions:** a token on the curve bought to just under `GRADUATION_ETH`; the compose keeper running (`/healthz` ok; `GraduationReady` WS watch + DB sweep).
- **Steps:** (1) The final threshold-crossing buy is sent through the trade widget (mock connector, real tx). (2) The curve LOCKS — on-chain `phase()` leaves `Trading` (`ReadyToGraduate`). (3) The keeper fires `graduate()` within ~1–2 blocks (WS reaction) or its DB-poll fallback interval — **the test never calls graduate()**. (4) On-chain: the `Graduated` event's `caller` is the keeper (anvil #4) and it earned `CALLER_REWARD` (balance delta ≥ reward − gas); the LP NFT is owned by `LPFeeVault`; the curve balance drains to its unswept fee escrow. (5) The indexer flips `status=graduated` + pool set; the widget re-engines to the V3 venue live (WS `graduated`, no reload — the TD-4/TD-5 surface).
- **assertable-layers:** on-chain · indexed · UI.

---

## 4b. Creator fees — post-graduation 0.5% split (the creator-fee generation)

> _A separate immutable factory generation (CurveFactory + BondingCurve + Router + pull-payment `CreatorVault` + creator-aware `LPFeeVault`) pays token creators **0.5% for the token's life** — venue-invariant: **0.5% pre-grad** as the additive curve leg (`creatorFeeBps = 50`, treasury 100 + creator 50 = 150 ≤ the 200/2% cap), and **0.5% post-grad** by splitting the graduated V3 pool's 1% trading fees **50/50** treasury/creator on BOTH legs. LP principal stays permanently locked (only fees are collected, never `decreaseLiquidity`). The creator's cut routes to the pull-payment `CreatorVault` (token-leg + WETH/ETH-leg); the creator claims it. Graduation target is the flat **G≈2.484 ETH**._
> _`CFEE-1` asserts **on-chain · indexed · UI:** the split-Collect/CreatorVault accrual materializes `creator_token_claimable`, the indexed API reconciles to the on-chain vault credit, and the Portfolio CREATED tab renders + submits the creator claim buttons. `CFEE-2` asserts the venue-invariant 0.5% rate at **on-chain · indexed** via `GET /v1/creators/:a/claimable`, `GET /v1/creators/:a/claimable/:token`, and the Portfolio list endpoint `GET /v1/creators/:a/token-claimable` (authoritative live vault balances). `CFEE-3`/`CFEE-4` remain on-chain invariants (pull-payment isolation / a set-once mapping) with no required indexed/UI surface._

### `@flow:CFEE-1` — Post-grad creator-fee accrual + claim (LP-fee 50/50 split → CreatorVault → claim) · tx type `collect(tokenId)` + `claim`
- **Actors:** Creator (claims); anyone (permissionless `collect()`); Trader (post-grad V3 volume).
- **Preconditions:** graduated token in the creator-fee generation; `LPFeeVault.creatorOf[tokenId]` registered at graduation; `creatorLpShareBps = 5000`.
- **Steps:** (1) Post-grad V3 swaps accrue fees in BOTH legs (WETH-leg on buys, token-leg on sells). (2) Permissionless `collect(tokenId)` harvests both legs and splits **50/50**: treasury share `safeTransfer`'d to the fixed treasury as ERC20 (treasury-first, keeps the odd wei), creator share credited to `creatorOf[tokenId]` in the `CreatorVault` — BOTH legs as ERC20 per `(creator, token)` via `depositERC20`, never unwrapped (`LPFeeVault._route`). (3) `creatorAmt + treasuryAmt == collected` EXACTLY per leg (per-leg conservation invariant); `creatorAmt = amount × 5000/10000` (floor). (4) The creator opens Portfolio → CREATED, sees `Creator earnings`, and clicks `Claim WETH` + `Claim <ticker>`; the UI submits `claimERC20(creator, WETH)` + `claimERC20(creator, token)`. (5) The creator receives both legs and the buckets drain to zero.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:CFEE-2` — Venue-invariant 0.5% creator rate end-to-end (curve pre-grad AND V3 post-grad)
- **Actors:** Creator; Trader (curve + V3 volume).
- **Preconditions:** creator-fee generation; `CREATOR_FEE_BPS = 50` on the curve; graduated pool for the post-grad leg.
- **Steps:** (1) Pre-grad: a known curve buy volume accrues EXACTLY 0.5% (`fee = gross × 50 / 10000`, computed in-contract) into the curve creator escrow; `sweepCreatorFees()` lands it in the `CreatorVault`. (2) Post-grad: a known V3 buy volume accrues a 1% pool fee; the 50/50 `collect()` split credits the creator ~0.5% of that volume. (3) The creator's absolute rate is ~0.5% BOTH pre- and post-grad — one honest "0.5% of your token's lifetime volume, on the curve and on Uniswap" story, no discontinuity at graduation.
- **assertable-layers:** on-chain · indexed. _(UI claim-button coverage is owned by CFEE-1.)_

### `@flow:CFEE-3` — Un-brickable post-grad: a hostile creator can't freeze `collect()` or trades; only its own claim reverts (retriable)
- **Actors:** Trader; a hostile/reverting creator address.
- **Preconditions:** graduated token in the creator-fee generation with a swept PRE-GRAD native-ETH creator leg (the curve leg) in the `CreatorVault`; the registered creator is (made) a reverting contract via `anvil_setCode` (a fork manipulation, like ERR-5 — never a contract change).
- **Steps:** (1) Post-grad V3 trades still succeed (the creator is never on the trade path). (2) `collect(tokenId)` still succeeds — it PUSHES the creator share to the non-reverting `CreatorVault`, never to the hostile EOA — and still credits the creator's ERC20 balance. (3) The creator's OWN PRE-GRAD native-ETH `claim()` reverts while hostile; the credit is NOT lost. (The post-grad legs are ERC20 — `claimERC20` transfers never call the creator, so a hostile creator can't even brick those; native-ETH `claim` is the only pull it bricks.) (4) After the address is restored to a plain EOA, the same `claim()` succeeds (retriable). The "accrue-in-contract, pull-withdraw, never push to a hostile address on a critical path" property.
- **assertable-layers:** on-chain. _(indexed · UI N/A — the un-brickable property is a chain-level pull-payment invariant; post-grad trades' indexed legs are asserted in TD-4/TD-5; see waivers.)_

### `@flow:CFEE-4` — Set-once, unspoofable creator registration (`tokenId → creator`)
- **Actors:** the V3Migrator (registers at graduation); an attacker (non-migrator).
- **Preconditions:** graduated token in the creator-fee generation.
- **Steps:** (1) `LPFeeVault.creatorOf[tokenId]` equals the graduating curve's creator (captured at the authoritative moment). (2) A NON-migrator caller cannot OVERWRITE the mapping (set-once → revert). (3) A NON-migrator caller cannot register a fresh, never-graduated tokenId (migrator-gated → revert). The mapping is unchanged throughout.
- **assertable-layers:** on-chain. _(indexed · UI N/A — a contract-level set-once mapping invariant with no indexed/UI surface; see waivers.)_

---

## 4c. Taking fees out — post-graduation withdrawal (creator + 2-of-4 treasury Safe)

> _The withdrawal counterpart to the creator-fee accrual flows (4b) and the LP-fee sweep (COLLECT-1): once a token has graduated and post-grad V3 volume has accrued fees, `collect(tokenId)` splits them 50/50 and PUSHES each side to its home — the creator share to the pull-payment `CreatorVault`, the treasury share (ERC20) to `LPFeeVault.treasury`. This flow proves BOTH sides are actually withdrawable in ONE graduation flow. The treasury is a canonical **2-of-4 Gnosis Safe v1.4.1** on the fork (`LPFeeVault.treasury` is an IMMUTABLE constructor value, so a Safe must be the treasury before the contracts deploy — the mainnet path is `tools/deploy/create-safe.ts` + the `external.treasurySafe` constant, rehearsed end-to-end by `tools/deploy/safe-drill.ts`; on the shared dev fork the harness instead installs a byte-identical canonical Safe onto the deployed contracts' immutable treasury ADDRESS via a pure anvil manipulation — like ERR-5's `setCode`, never a `contracts/src` change). The 2-of-4 withdrawal reuses the `tools/deploy/safe-tx.ts` EIP-712 primitives (`computeSafeTxHash`/`signSafeTxHash`/`orderSignatures`/`sendExecTransaction`)._

### `@flow:TREAS-1` — Post-grad fee withdrawal: creator pull + 2-of-4 treasury Safe `execTransaction` · tx type `collect(tokenId)` + `claimERC20`/`claim` + Safe `execTransaction`
- **Actors:** Creator (pulls its CreatorVault legs); the 2-of-4 treasury Safe owners (co-sign the withdrawal); any funded EOA (submits the assembled blob); Trader (post-grad V3 volume).
- **Preconditions:** a graduated token in the creator-fee generation with accrued post-grad V3 fees; the deployed contracts' immutable `LPFeeVault.treasury` address wired to a canonical **2-of-4 Safe v1.4.1** (4 anvil dev signers, threshold 2).
- **Steps:** (1) Graduate, generate two-sided post-grad V3 volume, and sweep the pre-grad curve creator leg. (2) Install/confirm the treasury is a canonical 2-of-4 Safe v1.4.1 (`VERSION()=="1.4.1"`, `getThreshold()==2`, `getOwners().length==4`) at the LIVE immutable `LPFeeVault.treasury()`. (3) Permissionless `collect(tokenId)` splits the fees 50/50: the treasury's ERC20 share (WETH + token) is PUSHED into the Safe; the creator's legs land in the `CreatorVault`. (4) **Creator withdrawal:** the creator PULLS both ERC20 legs (`claimERC20(creator, WETH)` + `claimERC20(creator, token)`) — wallet balances rise, buckets drain to zero — plus `claim(creator)` for the pre-grad native-ETH curve leg when present. (5) **Treasury 2-of-4 withdrawal:** a Safe `execTransaction` carrying **2 of the 4** owner signatures (ascending) transfers the Safe's WETH fee share OUT to a recipient — recipient balance up, Safe balance down, Safe nonce++. (6) **Threshold enforcement:** the SAME withdrawal with a **single** signature REVERTS (below threshold) and the Safe nonce is unchanged (no partial execution).
- **assertable-layers:** on-chain. _(indexed · UI N/A — the treasury Safe `execTransaction` has no indexer/UI surface (the indexer does not watch the Safe; treasury tooling has no v1 page — cf. COLLECT-1's UI waiver + CFEE-3/CFEE-4 on-chain-only invariants), and the creator-claim indexed drain is already asserted by CFEE-1; see waivers.)_

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

### `@flow:ERR-4` — Sell stays open while buys paused
- **Actors:** Trader.
- **Preconditions:** Router `pauseBuys = true` (and/or `pauseCreates = true`).
- **Steps:** (1) Buy tab disabled with exact copy "Buying is temporarily paused — selling remains open". (2) **Sell tab fully live, reads no pause flag**, submits `Router.sell` end-to-end → indexed Trade. This is the CLAUDE.md sells-always-open invariant.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:ERR-5` — Sell stays open while treasury reverts
- **Actors:** Trader.
- **Preconditions:** treasury fee-sink would revert on a push transfer (hostile/paused Safe); curve fee is a **pull-payment** accrual, so it does not push to the treasury on the trade path.
- **Steps:** (1) Submit `Router.sell`. (2) Sell **succeeds** because the fee accrues to a pull-payment balance rather than being pushed to the treasury inline — a reverting treasury can never wedge a sell. (3) Optimistic → reconcile → indexed Trade.
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:ERR-6a` — Metadata hash mismatch: client re-verify blocks signing
- **Actors:** Creator.
- **Preconditions:** API returns a `metadataHash` that ≠ the client's own `canonicalizeMetadata`+`keccak256`.
- **Steps:** (1) Client recomputes and detects the mismatch. (2) **Signing is blocked** — the user is never committed to metadata they did not write; error surfaced; no tx broadcast.
- **assertable-layers:** UI. _(Client-side guard prevents any tx → no on-chain / indexed record; see waivers.)_

### `@flow:ERR-6b` — Metadata mismatch verdict (server-side)
- **Actors:** (none visitor-facing — server-side verdict; no display surface post-SafetyStrip-removal).
- **Preconditions:** on-chain committed `metadataHash` ≠ indexer's keccak of the fetched canonical JSON (metadata changed after launch).
- **Steps:** (1) The indexer's metadata-hash verifier materializes the ⚠ MISMATCH verdict on `trust.metadataVerification` (`computedHash` ≠ `onchainHash`). (2) Wherever the frontend surfaces the verdict it renders the indexer's value and never recomputes-and-overrides — but post-SafetyStrip-removal there is no token-detail display surface for it.
- **assertable-layers:** on-chain · indexed. _(Metadata-verdict UI surface removed with the SafetyStrip; the verdict is proven at the immutable on-chain hash + the indexer verification. UI waived; see waivers.)_

### `@flow:ERR-7` — Graduating-window lock (ReadyToGraduate)
- **Actors:** Trader.
- **Preconditions:** curve at threshold, `graduate()` not yet executed (`status = graduating`).
- **Steps:** (1) Widget shows a two-sided "Graduating to Uniswap V3…" interstitial and disables **both** buy and sell inputs for the interstitial seconds. (2) Copy must **not** say "paused" — it is a deterministic, permissionlessly-exitable protocol state. (3) On WS `graduated`, flips to `graduated` (→ TD-6).
- **assertable-layers:** on-chain · indexed · UI.

### `@flow:ERR-8` — Launch blocked while creates paused
- **Actors:** Creator.
- **Preconditions:** Router `pauseCreates = true` (live read).
- **Steps:** (1) Submit disabled with "New launches are temporarily paused." (2) Sells and other surfaces elsewhere are unaffected (granular flags — pauseCreates only). No tx broadcast.
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
- **Preconditions:** socket drops or a `seq` gap is detected (no replay buffer).
- **Steps:** (1) Degraded banner "Live updates degraded — reconnecting"; backoff 0.5→8s. (2) On reconnect **or** seq gap, invalidate all live query keys (`tokens`, `token:*`, `trades:*`, `candles:*`) → REST re-serves resumable truth, closing the gap. WS is a patch stream; REST is the source of truth.
- **assertable-layers:** indexed · UI. _(Recovery is client + REST; no chain state change — see waivers.)_

### `@flow:ERR-12` — Stored-link XSS render safety (UM-5)
- **Actors:** Visitor viewing a token whose user links carry a `javascript:`/`data:` payload.
- **Preconditions:** malicious `links` reach the client (API already rejects non-`https:`; the frontend re-checks).
- **Steps:** (1) Links render only as `https:` anchors with `rel="noopener noreferrer"` under a strict CSP. (2) A `javascript:`/`data:` href **never** reaches the DOM; no script executes.
- **assertable-layers:** indexed · UI. _(Render-safety assertion; no chain state — see waivers.)_

### ~~`ERR-13`~~ — Trust-panel RPC read failure — RETIRED (SafetyStrip removal)
> _This flow asserted that the token-detail SafetyStrip's live-read rows degrade to “on-chain read unavailable — retry” and NEVER substitute the API's cached reserve values. That entire surface — the SafetyStrip `useCurveReads` display with its `allFailed` degradation — is DELETED, and no surviving surface reliably carries the assertion: the `TradeWidget` hides its quote on read failure (no “unavailable” copy to assert against); the /create `EconomicsPanel` shows “on-chain read unavailable” only on a query-level `isError`, which — with multicall3 intentionally omitted so reads fall back to per-call `allowFailure` `eth_call`s — never trips on a per-call read failure; the Discover `GraduationProgress` is fed CACHED indexer values, not a live browser read. Spec `flows/err-13.spec.ts` deleted; the ERR-13 waiver row removed. ID tombstoned (never reused)._

### `@flow:ERR-14` — WS silence on an optimistic trade
- **Actors:** Trader with a soft-confirmed optimistic row.
- **Preconditions:** RPC receipt success, but no WS `trade` within 10s.
- **Steps:** (1) Row kept; badge gains an "awaiting index" tooltip. (2) REST poll `GET /v1/trades/:txHash` fills in indexed truth. (3) Escalate to an error state only on indexer-confirmed absence after 30s — never silently promoted, never silently dropped.
- **assertable-layers:** on-chain · indexed · UI.

---

## 6. Traceability — every Discover / Token Detail / Launch feature bullet maps to ≥1 flow

### Discover _(D-73: event tape retired; the D-70 token-card grid is the browse surface below the carousel. KotH hero + URL-state stay retired; grid sort/filter are view-local — all remain API capabilities)_
| Surface bullet (Discover redesign) | Flow ID(s) |
|---|---|
| TRENDING carousel (volume-weighted, API-owned order) + token-card grid (D-70, ranked cards below it) | DISC-1 |
| Token grid: a new launch surfaces via the `GET /v1/tokens` path (tape's WS slide-in retired, D-73) | DISC-2 |
| Token grid: view-local sort/filter tabs (server `?sort=&filter=` refetch), registry-sourced metrics, navigate | DISC-3 |
| Search: name, ticker, contract, creator (pg_trgm) + `/?q=` creator deep link | DISC-4 |
| Carousel card / grid card fields (image · rank · name · ticker · Δ% / description · mcap · vol24h · status · creator · age) — indexer metrics only | DISC-1, DISC-3 |

### Token Detail
| Feature bullet | Flow ID(s) |
|---|---|
| Live candles 1s→1h, venue-continuous across graduation | TD-1 (continuity also asserted in TD-6) |
| Graduation venue switch — happy path / donation-resilient (F-1) / keeper-driven | TD-6 / TD-6b / GRAD-AUTO |
| Buy/Sell widget: curve pre-grad, V3 post-grad invisible switch; slippage 2% + deadline | TD-2, TD-3, TD-3b, TD-4, TD-5 |
| Token detail: retired LP-destiny disclosure stays off /t/[address] | TD-7 |
| Advisory heuristic flags on the Top Holders table (organic range/flow-quality blocks dropped → internal trust surface) | TD-8 |
| Live trade feed (soft-confirmed chip removed; posted/finalized surface) | TD-9 |
| Top Holders table: rank · address · label · amount · % — server-sorted + paginated | TD-10 |
| Token info, Blockscout links, creator profile | TD-11 |
| SSR + per-token OG image (chart snapshot + mcap + progress) | TD-12 |

### Launch
| Feature bullet | Flow ID(s) |
|---|---|
| Form: name, ticker ≤10, description ≤500, image required (≤4MB, re-encoded), optional links | LAUNCH-1 |
| Image through API (MIME sniff + re-encode); metadata canonicalized; client re-verifies hash before signing | LAUNCH-1 (mismatch path ERR-6a) |
| Optional atomic initial creator buy (anti-self-snipe) | LAUNCH-2 |
| One tx: `Router.createToken{value: deployFee + initialBuy}`; tradeable <1s soft-confirmed | LAUNCH-1, LAUNCH-2 |
| Economics displayed plainly + exact LP copy (never "burned") | LAUNCH-3 |

### Portfolio (addendum in section 3b)
| Surface bullet (Portfolio addendum / implemented page) | Flow ID(s) |
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
| `graduate()` | TD-6, TD-6b (donation-resilient, F-1 regression), GRAD-AUTO (compose-keeper-driven) |
| post-grad V3 buy | TD-4 |
| post-grad V3 sell | TD-5 |
| `collect(tokenId)` | COLLECT-1, CFEE-1, TREAS-1 |
| fee withdrawal — `claimERC20`/`claim` (creator) + Safe `execTransaction` (2-of-4 treasury) | TREAS-1 |

### Error-path coverage (task-required)
| Error path | Flow ID |
|---|---|
| Slippage revert | ERR-1 |
| Deadline expiry | ERR-2 |
| Anti-sniper cap hit | ERR-3 |
| Sells-open-while-buys-paused | ERR-4 |
| Sells-open-while-treasury-reverts | ERR-5 |
| Metadata hash mismatch (client pre-sign) | ERR-6a |
| Metadata mismatch verdict (server-side indexer verification; SafetyStrip UI removed) | ERR-6b |
| Graduating-window lock (ReadyToGraduate) | ERR-7 |
| Launch blocked while creates paused | ERR-8 |
| Wallet rejects tx | ERR-9 |
| Tx reverts on-chain (generic) | ERR-10 |
| WS reconnect / seq-gap heal | ERR-11 |
| Stored-link XSS render safety | ERR-12 |
| ~~Trust-panel RPC read failure~~ — RETIRED (SafetyStrip removed; no surviving surface) | ~~ERR-13~~ |
| WS silence on optimistic trade | ERR-14 |

**Coverage:** all Discover (5/5), Token Detail (8/8), Launch (5/5) bullets and all 9 transaction types + 14 active error paths map to a flow ID (ERR-13 RETIRED with the SafetyStrip removal). No gaps. The Portfolio surface maps to `PORT-1`–`PORT-8` (addendum in section 3b) — read-only, so the transaction-type and error-path tables above are unchanged.

## 7. Flow inventory

- Discover: DISC-1..4 (4)
- Token Detail: TD-1, TD-2, TD-3, TD-3b, TD-4, TD-5, TD-6, TD-6b, TD-7, TD-8, TD-9, TD-10, TD-11, TD-12, TD-13 (15)
- Launch: LAUNCH-1, LAUNCH-2, LAUNCH-3 (3)
- Portfolio (addendum in section 3b): PORT-1..8 (8)
- Transaction-only: COLLECT-1 (1)
- Automated graduation (compose keeper, section 4a): GRAD-AUTO (1)
- Creator fees (post-grad 0.5% split, section 4b; CFEE-1 on-chain · indexed · UI, CFEE-2 on-chain · indexed, CFEE-3/CFEE-4 on-chain invariants): CFEE-1..4 (4)
- Treasury/creator fee withdrawal (section 4c; on-chain — 2-of-4 Safe `execTransaction`): TREAS-1 (1)
- Errors/edges: ERR-1..ERR-14 with ERR-6 split a/b, ERR-13 RETIRED (SafetyStrip removal) → 14 active flows
- **Total: 51 catalogued flows.** The 46-flow baseline = the prior 44 + `TD-6b` (F-1 donation-freeze regression) + `GRAD-AUTO` (compose-keeper auto-graduation), both full three-layer; the four `CFEE-*` creator-fee flows extend it: `CFEE-1` is **on-chain · indexed · UI** (Portfolio CREATED renders and submits the creator claim buttons), `CFEE-2` is **on-chain · indexed** (the venue-invariant roll-up is served over REST; the Portfolio list endpoint exists), `CFEE-3`/`CFEE-4` are **on-chain invariants** (pull-payment isolation / a set-once mapping); `TREAS-1` (section 4c) completes the set as an **on-chain** flow — the full creator + 2-of-4 treasury-Safe fee WITHDRAWAL in one graduation flow (indexed · UI waived: the Safe `execTransaction` has no indexer/UI surface). The `e2e:coverage` gate reports 51/51.

See `user-flows-waivers.md` for every flow declaring fewer than three assertable layers.

## 8. Redesign reconciliation

The four-page redesign (recorded in the design decisions log) landed after this catalog was authored against the three-page Discover/Token-Detail/Launch baseline. Reconciliation record:

- **`/launch` → `/create` rename (redesign):** applied throughout this catalog (section 3 heading). `LAUNCH-*` flow IDs are **retained** — the stable-ID rule means IDs never encode routes; re-IDing to `CREATE-*` would churn every `@flow:` tag for zero information. New Create-page-specific flows (if any) may use either prefix; extend `LAUNCH-*` for continuity.
- **Portfolio `/portfolio` (Portfolio addendum) — coverage gap CLOSED:** the original gap record (this catalog contained no `PORT-*` flows; required addendum, owner robbed-frontend → architect, due before the I-5a `e2e:coverage` baseline is frozen; minimum expected flows: header stats render — TOTAL VALUE / LOOT ALL-TIME / WALLET ETH, indexer/API-sourced, never client price math, no USD literals per the no-market-metrics rule — HOLDINGS / ACTIVITY / CREATED tabs, disconnected-wallet + empty states, and live-patch behavior) is discharged. Portfolio is **read-only**: it adds **no transaction types** (the 9-type table above stays exhaustive) and **no `collect()` surface** (COLLECT-1 waiver unchanged).
  - **`PORT-*` addendum authored (section 3b):** eight flows `PORT-1`–`PORT-8` land in section 3b with a section 6 traceability table, the section 7 inventory update, and matching P-7 waiver rows in `user-flows-waivers.md` (every `PORT-*` flow is <3-layer — Portfolio has no on-chain transaction surface). Coverage of the “minimum expected” list: header stats → PORT-1; tabs → PORT-1/2/3; disconnected + empty states → PORT-4/PORT-7; pagination → PORT-5; arbitrary-address subject (`?address=`) → PORT-6; read-failure → PORT-8. **One deliberate deviation:** no **live-patch** flow exists, because the shipped implementation (and `api.md`) makes portfolio reads **advisory** — no WS channel patches them; freshness is ~15s staleTime + refetch. Authoring a live-patch flow would make `e2e:coverage` demand an assertion that can never exist (P-7's livelock rule); no portfolio WS-channel requirement is routed to robbed-indexer for v1.
- **Everything else:** re-skin only — the DISC-\*/TD-\* flows, all protocol/copy constraints (no-market-metrics, sells-always-open, the LP-destiny sentence on intentional surfaces, metadata integrity, confirmation tiers, pull-payment fees), and the waiver set are unaffected by the four-page redesign.
