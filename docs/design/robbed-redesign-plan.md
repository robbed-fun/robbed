# ROBBED_ Redesign Plan — rebuild `apps/web` to match `docs/Robbed.html`

**Source:** `docs/Robbed.html` (mockup, "Terminal — all four pages"). Reference renders: `mobile-full.png` / `desktop-full.png` (in the job tmp). **Directive:** match the mockup **exactly**, **mobile-first**, only the pages in the mockup, build with `hoodpad-frontend` in parallel.

## Design language (extracted from the mockup)

**It is a DARK terminal/monospace aesthetic** (the cream in the render is the mockup's canvas; each page card is near-black). Brand **`ROBBED_`** with a trailing blinking-cursor `_` motif (`rob responsibly_`, `in green we trust_`).

- **Type:** monospace everywhere (`ui-monospace` / JetBrains-Mono-style); uppercase micro-labels with letter-spacing (TRENDING, ALL, LAUNCHES, YOU PAY, PRICE); tabular numerals for all numbers/prices.
- **Palette (agent to sample exact hex from the HTML computed styles):** bg near-black `~#0d0d0d`; surface `~#141414`; hairline borders `~#242424`; text `~#e8e8e3` / muted `~#8a8a82`; **primary green** `~#4ade80` (BUY / positive % / LAUNCH·BUY solid buttons with dark text; `+ CREATE` = green **outline**, transparent); **red** `~#f0564a` (SELL / negative %); **purple** `~#a78bfa` (GRADUATE); trending cards carry their own vivid gradients.
- **Density:** tight rows, thin dividers, table-like layouts, small radii (≈2–4px), flat (no heavy shadows). Terminal, not glossy.

## Pages (EXACTLY these four — nothing else)

1. **Discover `/`** — header · TRENDING carousel (4 ranked token cards w/ image + ticker + Δ%) · event tape (filter tabs ALL/LAUNCHES/TRADES/GRADUATIONS + LIVE dot; rows: age · colored SIDE · token · amount ETH · mcap · Δ%).
2. **Token Detail `/t/[address]`** — header · token id row (avatar, NAME TICKER, addr·created·creator) · stat cells (PRICE/VOL24H/24H/MCAP/HOLDERS/BONDING+progress) · chart (1H/4H/1D/ALL, "price / ETH") · trades table (AGE/SIDE/TRADER/AMOUNT/PRICE) · right-rail Buy/Sell (toggle, YOU PAY + 0.1/0.5/1/MAX chips, YOU RECEIVE, price-impact/fee/slippage, green action) · `rob responsibly_`.
3. **Create `/create`** *(renamed from `/launch`)* — header · LAUNCH A TOKEN · logo 512×512 upload · NAME · TICKER (x/8) · DESCRIPTION (opt) · INITIAL BUY (opt) · summary (deploy cost/starting price/supply) · green LAUNCH TOKEN · `in green we trust_`.
4. **Portfolio `/portfolio`** *(NEW — was §5.4 Phase-2)* — header · address·you + first-seen·trades · stat cells (TOTAL VALUE/LOOT ALL-TIME/WALLET ETH) · tabs HOLDINGS/ACTIVITY/CREATED · holdings table (TOKEN/BALANCE/PRICE/VALUE/PNL).

Header (all pages): `ROBBED_` wordmark · nav `discover` · `portfolio` · search input · `+ CREATE` (green outline) · wallet chip. **Mobile-first:** header collapses (bottom-nav or compact bar), tables become stacked cards / horizontal-scroll, the token-detail right-rail stacks under the chart.

## Strategy — RE-SKIN, don't rebuild the data layer

The existing FSD **data layer stays** (wagmi/viem chain config, WS client, typed REST client, `entities/trade` optimistic reducer, `@robbed/shared` types/ABIs/curve-quote, on-chain reads). We **replace the visual layer** (`shared/ui` design system + widgets/views UI), **add Portfolio** (entity + view + API/holder reads), and **rename Launch→Create**. Protocol/copy discipline is UNCHANGED: sell-never-gated, exact LP sentence, no hardcoded metrics (§2 — the mockup's `$610K` etc. are MOCK; wire live data), soft-confirmed semantics, `@robbed/shared` as the only type/ABI/math source.

## Decomposition — Atomic Design × FSD

Atomic layers map onto FSD `shared/ui` (atoms/molecules) and `widgets` (organisms); `views` = templates; `app/*` routes = pages.
- **Atoms (`shared/ui`):** `MonoText`/label, `Button` (solid-green / outline-green / ghost), `Chip` (0.1/0.5/1/MAX), `Tab`/`TabBar`, `Input`/`TextArea`, `SideBadge` (BUY green / SELL red / LAUNCH / GRADUATE purple), `Delta` (±%), `StatCell`, `TokenAvatar`, `ProgressBar` (bonding), `CursorTag` (`_` motif), `Divider`, `AddressChip`, `LiveDot`.
- **Molecules (`shared/ui` or entity `ui`):** `TrendingCard`, `EventRow`, `TradeRow`, `HoldingRow`, `StatRow` (cell group), `SearchBox`, `AmountInput` (input + unit + chips).
- **Organisms (`widgets`):** `AppHeader`, `MobileNav`, `TrendingCarousel`, `EventTape`, `TokenStatHeader`, `PriceChart`, `TradesTable`, `TradeWidget`, `LaunchForm`, `PortfolioHeader`, `HoldingsTable`, `ActivityTable`.
- **Templates (`views`):** `discover`, `token-detail`, `create`, `portfolio`.
- **Entities:** `token`, `trade`, `holder`, `curve` (exist), **+ `portfolio`/`address`** (new).

## Build order (foundation → parallel pages)

- **Phase F (foundation, 1 agent, FIRST — shared dependency):** rebrand → `ROBBED_`; rewrite `globals.css`/Tailwind `@theme` to the terminal-mono token set (mobile-first); build the atomic `shared/ui` kit + `AppHeader`/`MobileNav`; set routes: keep `/`, `/t/[address]`, **rename `/launch`→`/create`**, **add `/portfolio`**; update the copy/token-lint allowlist for the new tokens (dark-only stays; the LP-sentence/forbidden-terms rules stay). Verify tsc/test/build green.
- **Phase P (4 agents, PARALLEL after F):** Discover · Token-Detail · Create · Portfolio — each re-skins its view/widgets to the mockup exactly, reusing the data layer, mobile-first, against the new `shared/ui`.

## Spec deviations to record (→ hoodpad-architect §12; user-directed, authoritative)
1. **4 pages incl. Portfolio** overrides §5 "exactly three pages" + §5.4 (Portfolio was Phase-2). 2. **`/launch` → `/create`** route/label. 3. **Brand** ROBBED_ → `ROBBED_`. 4. **Terminal-mono skin** supersedes the shadcn/§12.24 look (shadcn primitives may remain under the hood, restyled to tokens). 5. **Mobile-first** is now the primary layout target (§9 stays dark-first — consistent). Data/protocol rules (§2, §6.5 sells-open, LP copy, §12.19/§12.20) are UNCHANGED.
