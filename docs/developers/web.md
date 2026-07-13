# ROBBED_ web frontend — service design (`apps/web`)

**Status:** Design v1.0 — drives M3 implementation. Documentation-first: building from this doc should be a transcription exercise.
**Owner:** robbed-frontend. Consumes contract types from `packages/shared` only; any missing indexer/API data is a gap reported to robbed-indexer via the orchestrator — never faked client-side.
**Spec:** `docs/spec.md` v1.1 — §1, §2, §2.1, §5.1–5.4, §8, §8.3, §9. `CLAUDE.md` hard rules apply.

---

## 1. Purpose & spec coverage

The product is **soft-confirmed trading UX** on Robinhood Chain (chain ID 4663): ~100ms blocks with a single FCFS sequencer mean a trade is reflected in the UI in well under a second (§1, §2). Positioning language is fixed:

> This is an **AMM / bonding curve with soft confirmations** — never an order book, never a "real-time exchange." Copy, marketing strings, tooltips, and docs must not claim order-book or exchange semantics (§1).

We win on **perceived speed, transparency, and a tight, focused product** (§1). The v1 app ships **four pages** (§5, as ratified by the ROBBED_ redesign — spec §12.50/§12.56/§12.57/§12.58; the fourth, Portfolio, is a read-only surface that supersedes the earlier §5.4 Phase-2 deferral):

| Page | Route | Spec |
|---|---|---|
| Discover | `/` | §5.1 |
| Token Detail | `/t/[address]` | §5.2 |
| Create | `/create` | §5.3 (renamed from `/launch`) |
| Portfolio | `/portfolio` | §5.4 (read-only) |

**Portfolio ships read-only** (spec §5.4/§12.50): it introduces **no new transaction types and no `collect()` UI** — it renders holdings/activity for an address from live data only. ERC-4337 is still Phase 2 (§12.2) — no AA code paths, classic wagmi/RainbowKit only.

Cross-cutting product rules implemented by this app:

- **Confirmation semantics (§2.1):** three explicit states — `soft-confirmed` → `posted-to-l1` → `finalized` — tracked by the indexer and surfaced in the UI where it matters. The **tier machinery is unchanged**, but per **§12.56 the soft-confirmed tier no longer renders a status chip** — a fresh trade makes no finality claim; **posted/finalized still surface**, and large-value (≥1 ETH) displays disclose them. See §4 of this doc.
- **Optimistic UI reconciled by WebSocket (§2.1, §5):** every trade renders immediately at the soft-confirmed tier (**no finality chip — §12.56**) and reconciles to indexed truth when the WS event arrives. Never rendered as final; never dropped when the WS contradicts it.
- **Transparency surface (§5.2, §8.3; redesign §12.57/§12.58):** the first-class **Trust panel is deleted (§12.57)**. The differentiator vs hood.fun is now the **Top Holders table** (`widgets/holder-table`, §12.58) plus a compact **safety strip** (`widgets/safety-strip`) that relocates the hard-rule must-render floor — the §12.14 LP-copy sentence, graduation progress, and live curve reserves — so those signals never vanish.
- **Sells always work (§6.5):** no UI path ever gates a curve sell on `pauseBuys`/`pauseCreates`. If buys are paused, the sell side stays fully live.
- **No hardcoded market metrics (§2):** no inline ETH/USD, TVL, volume, or mcap constants anywhere in code or copy. Everything is computed from live on-chain reads or indexer data, or cited with source + timestamp.
- **Per-token OG image (§5.2, §9):** the viral share unit; SSR'd, renders with zero client JS.

Stack (§9): Next.js 16 + React 19 (exact majors, no ranges — spec §12.37) App Router on Bun · wagmi v2 + viem + RainbowKit (custom chain 4663) · TanStack Query + WS · `lightweight-charts` · Tailwind dark-first · satori OG · Playwright e2e on fork + Vitest units.

---

## 2. App structure

### 2.1 Directory layout — Feature-Sliced Design (FSD)

`apps/web` is structured with **Feature-Sliced Design** (https://feature-sliced.design). This is a hard rule for all frontend work (M3-2 onward); consult the FSD docs (Layers, Slices & Segments, Public API, and the **Next.js guide**) before placing code — do not improvise the methodology.

**Layers & the strict downward import rule** (top → bottom): `app → views → widgets → features → entities → shared`. A module may import ONLY from layers strictly below it — never upward, never sideways between two sibling slices on the same layer. Cross-slice access goes ONLY through each slice's `index.ts` **public API**; intra-slice files use relative imports (and must not import their own barrel, to avoid cycles).

**Next.js App Router adaptation** (per the FSD Next.js guide): the Next `app/` directory is **routing only** — thin `page.tsx`/`layout.tsx` files that re-export a `views/*` screen. All real components + logic live under `src/`. Since a root-level `app/` is present, Next ignores `src/app/`, so FSD's canonical `app` layer safely lives at `src/app/` and the `pages` layer is renamed **`views`** to avoid the Next `pages` collision.

```
apps/web/
├── app/                          // Next 16 router — ROUTING ONLY (thin re-exports)
│   ├── layout.tsx                //   html.dark + self-hosted IBM Plex Mono (src/app/fonts.ts) + ROBBED_ metadata
│   ├── page.tsx                  //   Discover: `export { default } from "@/views/discover"`
│   ├── not-found.tsx             //   global 404 boundary
│   ├── t/[address]/              //   Token Detail (M3-6/8): page.tsx → @/views/token-detail; opengraph-image.tsx
│   ├── create/page.tsx           //   Create (RENAMED from /launch — ROBBED_ redesign): → @/views/create
│   └── portfolio/page.tsx        //   Portfolio (NEW — ROBBED_ redesign): → @/views/portfolio
│       //   /launch → /create redirect lives in next.config.ts (non-permanent)
└── src/
    ├── app/                      // FSD app layer: providers.tsx (Wagmi→Query→RainbowKit(green/none)→Ws),
    │                             //   globals.css (ROBBED_ tokens), fonts.ts + fonts/ (vendored Plex Mono, OFL)
    ├── views/                    // FSD pages layer (renamed): one composed screen per route
    │   ├── discover/             //   ui/DiscoverView (SSR shell + islands), ui/DiscoverControls; index.ts
    │   ├── token-detail/         //   ui/TokenDetailView (SSR) + client island; model/metadata.ts
    │   ├── create/               //   ui/CreateView (renamed from views/launch — ROBBED_ redesign)
    │   └── portfolio/            //   ui/PortfolioView — Phase-F SHELL; Portfolio page agent fills it
    ├── widgets/                  // large self-contained page regions; each = ui/ + optional model/ + index.ts
    │   ├── app-header/           //   ROBBED_ header (wordmark·nav·search·+CREATE·wallet), mobile-first collapse;
    │   │                         //     search = UrlSeededSearchBox under Suspense (?q= creator deep link)
    │   ├── mobile-nav/           //   bottom nav < md (discover · portfolio · + create)
    │   ├── trending-carousel/    //   §12.50(f) Discover: server-rendered CSS marquee of API-ranked cards
    │   ├── event-tape/           //   §12.50(f) Discover: seeded LAUNCH snapshot + live WS rows, tab filters
    │   │                         //     (RETIRED with §12.50(f): token-grid/, king-of-the-hill-hero/,
    │   │                         //      launch-ticker/, site-header/; token-og/ moved with OG → API, §6)
    │   ├── price-chart/ · trade-widget/ · trade-feed/ · safety-strip/ · holder-table/
    │   │                         //     (§12.57 deleted trust-panel/; safety-strip/ holds the relocated
    │   │                         //      must-render floor, holder-table/ is the §12.58 Top Holders table)
    │   ├── live-status-banner/
    │   └── network-banner/       //   onboarding-friction strip (all views): composes switch-network +
    │                             //     get-testnet-eth with wrong-network-first precedence; e2e-inert
    ├── features/                 // user actions / interactions
    │   ├── search-tokens/        //   ui/SearchBox + search query logic
    │   ├── launch-token/         //   the create-token flow (slice name unchanged by the /create route rename)
    │   ├── connect-wallet/       //   ui/WalletConnectButton (RainbowKit ConnectButton wrapper)
    │   ├── switch-network/       //   wrong-network guard: model/use-network-guard (one-shot auto
    │   │                         //     useSwitchChain + manual retry) + presentational WrongNetworkBanner
    │   └── get-testnet-eth/      //   faucet CTA (TESTNET target only): config/faucets (official §12.52
    │                             //     URLs, ?address= prefill) + zero-balance trigger + ui/FaucetCta
    ├── entities/                 // business-domain models: ui/ + model/ + (api/ when a slice needs its own) + index.ts
    │   ├── token/ · trade/ · holder/ · curve/
    │   └── //   FUTURE (Phase P): entities/portfolio (holdings/activity per address)
    └── shared/                   // business-agnostic; importable by everything, imports nothing above it
        ├── ui/                   //   ROBBED_ atomic kit (MonoText/MonoLabel, Chip, Tab/TabBar, SideBadge, Delta,
        │   │                     //     StatCell, CursorTag, Wordmark, Divider, AddressChip, LiveDot, AmountInput)
        │   │                     //     + pre-redesign display atoms (Amount, UsdAmount, ProgressBar, RelativeTime,
        │   │                     //     EmptyState, ErrorState, AddressLink, TokenAvatar) + index.ts
        │   └── kit/              //   vendored shadcn primitives (button, input, textarea, …) restyled to the
        │                         //     terminal tokens — color-lint EXEMPT
        ├── lib/                  //   chain.ts (defineChain, env-selected target 4663|46630 per §12.55;
        │                         //     WETH from the shared per-chain registry), wagmi.ts, ws.tsx,
        │                         //     ws-client.ts, query-keys.ts, format.ts, env.ts, utils.ts, wallets/, og/
        ├── api/                  //   index.ts — typed REST client over the frozen @robbed/shared contract
        └── config/              //   addresses.ts (hand-authored derivation over the GENERATED
                                  //     @robbed/shared map — NOT a codegen target), copy.ts (LP/AMM copy + BRAND)

apps/web/tests/                   // Vitest units (outside the layer graph)
apps/web/e2e/                     // Playwright specs (§8 of this doc)
```

**Placement decision rule** (apply when unsure): business-agnostic → `shared`; a domain noun → `entity`; a user verb/action → `feature`; a page-region composition of several → `widget`; a whole screen → `view`. Notable calls made in the M3 restructure: the optimistic trade reducer lives in `entities/trade/model` (the trade domain model); the event-tape's pure event model (WS→row mapping, registry enrichment, tab filters) lives in `widgets/event-tape/model` (it shapes the tape's row buffer, a widget concern); the base REST client stays in `shared/api` (business-agnostic typed client), so entities do not each shatter it into per-entity `api/` files unless a real need arises. (The former `entities/token/model/params` sort/filter URL-state and `widgets/token-grid/model` were deleted with the §12.50(f) Discover deviation — sort/filter remain API capabilities with no web consumer.)

**Path alias:** `@/*` → `src/*` (tsconfig `paths` + vitest `resolve.alias`). Root `app/` files reach into `src` via `@/…` too (e.g. `@/app/globals.css`, `@/views/discover`).

**Import-boundary linter:** TODO — wire the FSD `steiger` linter (or `eslint-plugin-boundaries`) once the frontend gains an ESLint/lint pipeline; deferred from the M3 restructure to avoid touching the shared pnpm lockfile. Boundaries are currently enforced by review + the layer layout above.

### 2.2 Route map — SSR vs client boundaries

| Route | Rendering | Client islands |
|---|---|---|
| `/` | Server component (§12.50(f) surface); TRENDING (`sort=volume24h`) + newest lists fetched server-side via **isolated fetches** (short revalidate, ~5s) so the page paints with content; `TrendingCarousel` is server-rendered (CSS-only marquee, no hydration) | `EventTape` (WS), header `UrlSeededSearchBox` (reads `?q=` under Suspense) |
| `/t/[address]` | **SSR required** (§5.2): server component fetches token summary + metadata for full HTML + OG/meta tags (og:image → the API-served PNG, §6); must be meaningful without client JS (crawlers see name, ticker, mcap, progress, description) | `PriceChart`, `TradeWidget`, `SafetyStrip` (live on-chain reads — the relocated must-render floor, §12.57), `TradeFeed` (WS), `HolderTable` (§12.58) |
| `/create` | (renamed from `/launch` — ROBBED_ redesign; `/launch` redirects) Server shell (economics copy is static-per-deploy except fee values, which are read live); form is a client component | `LaunchForm` (entire flow) |
| `/portfolio` | NEW (ROBBED_ redesign; was §5.4 Phase-2). Phase-F shell; Phase-P page agent fills: address header, stat cells, HOLDINGS/ACTIVITY/CREATED tabs, holdings table — live data only (§2) | wallet-derived content (entire screen) |

Rules:
- Server components fetch via `lib/api.ts` with `fetch` caching (`revalidate`), never through TanStack Query.
- Client components hydrate TanStack Query with `initialData` passed from the server component (no double-fetch flash).
- URL state after §12.50(f): the Discover sort/filter `searchParams` surface is **retired** (sorts/filters remain API capabilities). URL state remains for the `?q=` search deep link (`UrlSeededSearchBox` reads it via `useSearchParams` under a Suspense boundary — Next 16 static-prerender rule) and `/portfolio?address=`.

### 2.3 Chain config — `lib/chain.ts` (§2, §9, §12.55)

```ts
import { defineChain } from "viem";
import { getDeployment } from "@robbed/shared/addresses";

const TARGET_CHAIN_ID = env.chainId();          // NEXT_PUBLIC_CHAIN_ID (registry-validated) | 4663
const facts = CHAIN_FACTS[TARGET_CHAIN_ID];     // official name + explorer per chain — transcribed, never invented

export const robinhoodChain = defineChain({
  id: TARGET_CHAIN_ID,                          // 4663 mainnet (default) | 46630 testnet
  name: facts.name,                             // "Robinhood Chain" | "Robinhood Chain Testnet"
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.rpcHttp()] /* + optional webSocket */ } },
  blockExplorers: { default: { name: "Blockscout", url: facts.explorerUrl } },
  contracts: { weth9: { address: getDeployment(TARGET_CHAIN_ID)?.external.weth } },
});
```

- **Per-target chain selection (§12.55, fixed 2026-07-12):** one build compiles exactly ONE chain. `env.chainId()` reads `NEXT_PUBLIC_CHAIN_ID`; when set it must resolve in the shared deployment registry (`getDeployment` — env *selects*, the registry *defines*; unknown id throws), unset ⇒ the compile-time mainnet `CHAIN_ID` (4663). Official facts (name/explorer) live in a per-chain map inside `lib/chain.ts` — 4663 from CLAUDE.md, 46630 from runbooks/testnet.md §1 — a registered chain without recorded facts (31337) fails loud. The testnet compose stack injects `NEXT_PUBLIC_CHAIN_ID=46630` (docker-compose.testnet.yml `web.environment`); `apps/web/.env.testnet` is the value sheet for the Workers testnet build. **Why the whole object must be official:** wagmi 2.18's injected connector `switchChain` falls back to `wallet_addEthereumChain` built from this object (name/nativeCurrency/`rpcUrls.default.http[0]`/blockExplorers — verified from installed source 2026-07-12), so wallets receive exactly these params. Proven in `tests/chain.test.ts`.
- RPC endpoints from env only. `NEXT_PUBLIC_RPC_HTTP`, `NEXT_PUBLIC_RPC_WS` (Alchemy per §8). On testnet the WS JSON-RPC is the key-gated Alchemy endpoint or nothing — **never** the sequencer feed `wss://feed.testnet…` (a block feed, not JSON-RPC).
- **Split-horizon API base (SSR vs browser, fixed 2026-07-12):** every data-plane REST fetch (`src/shared/api` + `src/entities/portfolio/api`) resolves its origin through ONE point — `env.apiFetchBaseUrl()` in `src/shared/lib/env.ts`. Server-side (`typeof window === "undefined"`) it prefers the **server-only** `API_BASE_URL_INTERNAL` (no `NEXT_PUBLIC_` prefix ⇒ never inlined into the client bundle; runtime-read on the server — nextjs.org env-variables guide, v16.2.10, verified 2026-07-12), falling back to `NEXT_PUBLIC_API_BASE_URL` when unset; browsers always use the public base. Rationale: inside the compose stack (dev + CI e2e) the public base is a HOST-mapped port (`http://localhost:4001`) that is ECONNREFUSED from within the web container — compose sets `API_BASE_URL_INTERNAL=http://api:3001`; host-run dev and prod (Workers) leave it unset and behave exactly as before. **Exception — og:image stays PUBLIC:** `views/token-detail/model/metadata.ts` builds the `og:image` absolute URL from `env.apiBaseUrl()` on purpose; `generateMetadata` runs server-side but the URL is fetched by external crawlers from outside our network, so the internal base must never be used there. Not touched by the split: the WS client (browser-only), wagmi RPC transports (client-side). Resolution order proven in `tests/env.test.ts`.
- **Zero inline address literals in the entire app (tightened 2026-07-12):** WETH now also resolves from the shared per-chain deployment registry (`getDeployment(chainId).external.weth` — 46630's WETH differs from mainnet's, §12.52), and `shared/config/addresses.ts` derives the robbed six + the V3 set + `WETH` for the TARGET chain (testnet build → the §12.52 testnet V3 set, mainnet → §12.28). Consumers (`entities/curve` V3 builders, trade-widget spender) import `V3`/`WETH` from `@/shared/config/addresses` — never `UNISWAP_V3`/`WETH_ADDRESS` from `@robbed/shared` directly (those are mainnet-only constants). The pre-commit/CI grep enforces this (§8.3 of this doc).
- Never use `block.number` anywhere, including UI display of "block height" — it is an L1 estimate on Orbit (CLAUDE.md). If a block/sequence number is ever displayed, it comes from the indexer's event metadata.

### 2.4 Wallet config — `lib/wagmi.ts` (§9, §12.2)

```ts
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, robinhoodWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
```

- Wallet groups: **injected · Robinhood Wallet · WalletConnect** — exactly these (§9). `robinhoodWallet` is in RainbowKit's wallet list; verify behavior on chain 4663 during M3 (it is WalletConnect-based under the hood).
- `WALLETCONNECT_PROJECT_ID` from env (open item, this doc §9.6).
- Single-chain app: `chains: [robinhoodChain]` (the env-selected target, §2.3); RainbowKit's ConnectButton still shows its built-in "Wrong network" chip when the wallet is elsewhere.
- **Wrong-network popup + auto-switch (2026-07-12, `features/switch-network` + `widgets/network-banner`):** on connect and on every `chainChanged` (both surfaced by `useAccount().chainId` re-renders), a wallet chain ≠ target renders a terminal-mono banner and fires **exactly one** automatic `useSwitchChain().switchChain({ chainId: target })` per mismatch episode (keyed connector.uid + wrong chain id — never a popup loop); a declined request leaves a manual "Switch network" retry. The injected connector's `wallet_addEthereumChain` fallback (error 4902) proposes the official params straight from the chain object; WalletConnect wallets receive the same request over the WC session. Complements (never fights) RainbowKit's built-in chip; the single `useNetworkGuard` instance lives in the widget so the banner stays presentational. E2E-inert: the mock connector is always on the configured chain AND both features hard-gate on `NEXT_PUBLIC_E2E`. Proven in `tests/network-banner.test.tsx`.
- **Faucet CTA (testnet target only, `features/get-testnet-eth`):** wallet connected on the testnet target with native balance exactly 0 (wagmi `useBalance`, gated query) → banner linking the official faucet with the connected address prefilled (`https://faucet.testnet.chain.robinhood.com/?address=…`) + the verified Chainlink/QuickNode fallbacks (spec §12.52; runbooks/testnet.md §1/§3). URLs live in the slice's `config/` segment, double-gated on registry `mode === "testnet"` — never rendered on mainnet/local; all links go through the shared https-only `ExtLink` guard (ERR-12). Dismissible per session (`sessionStorage`); wrong-network takes precedence (widget order + the CTA's own on-target requirement). Proven in `tests/faucet-config.test.ts` + `tests/faucet-cta.test.tsx`.
- No ERC-4337, no smart-account connectors, no gas sponsorship paths (Phase 2, §5.4/§12.2).

### 2.5 Providers — `app/providers.tsx`

Order (outermost first): `WagmiProvider` → `QueryClientProvider` → `RainbowKitProvider (theme=darkTheme())` → `WsProvider`.

- **QueryClient defaults:** `staleTime: 5_000`, `refetchOnWindowFocus: true`, `retry: 2`. Live-ness comes from WS cache patching, not aggressive polling; polling is the degraded fallback (this doc §2.6).
- **WsProvider** owns one multiplexed WebSocket to the Bun WS service (§8):
  - Channels (**ratified contract** — indexer.md §8.1 is authoritative; builders imported from `packages/shared` `channels.ts`): `global:launches`, `global:trades`, `global:confirmations`, `token:{address}:trades`, `token:{address}:candles:{interval}`, `token:{address}:events`. Message types (indexer.md §8.2): `launch`, `trade`, `candle`, `graduated`, `confirmations`, `reorg`, `metadata_verified`. Envelope `{ v, type, channel, seq, ts, data }`; `seq` gap ⇒ REST-heal (no replay buffer, spec §12.23).
  - Subscription is ref-counted per channel; components declare `useWsChannel(channel, handler)`.
  - Reconnect: exponential backoff (0.5s → 8s cap, jitter). **On reconnect, invalidate all live query keys** (`tokens`, `token:*`, `trades:*`, `candles:*`) to close the gap of missed events — WS is a patch stream, REST is the source of resumable truth.
  - Message handlers patch the TanStack Query cache via `queryClient.setQueryData` (prepend trade, upsert candle, bump token summary) — no component-level socket state.

### 2.6 Data-source rules

| Data | Source | Why |
|---|---|---|
| Token lists, search, candles, trades, holders, confirmation states, metadata-hash verdict, mcap/volume/Δ% | Indexer REST API + WS | Indexed truth (§8) |
| Curve reserves, graduation threshold, pause flags, deploy fee, quote inputs | **On-chain via viem/wagmi** | the safety strip demands live chain reads, not cached API values (§5.2); fees/thresholds are contract constants (§6.4) — reading them live is how we avoid hardcoding |
| ETH/USD | `GET /v1/eth-usd` → `{ price, source, asOf }` (api.md §3.5; backed by `eth_usd_snapshots`) | §2: never hardcode; display always carries source + timestamp |

ABIs: imported from the **full read-function ABIs in `packages/shared/src/abi/`** — the compilation-time codegen artifact ratified in spec §12.38 (emitted from `contracts/out/*.json` by `forge build`, no deploy needed; contracts.md §7.4). This is what unblocks every M3-5 live read (`reserves()`, `phase()`, `quoteBuy/quoteSell`, per-token `TRADE_FEE_BPS`, `totalSupply()`, factory `config()`); the deployed **addresses** come from the separate deploy-time codegen (`lib/addresses.ts`). **No ABI duplicated or hand-written in `apps/web`.** The safety-strip trade-fee figure is read live from the **curve's per-token `TRADE_FEE_BPS`** (never the factory config, which governs future curves only — §12.40d), matching the API's `trust.feePolicy.tradeFeeBps` source.

Degraded modes: WS down → banner "Live updates degraded — reconnecting", queries fall back to 5s polling on visible views. RPC down → the safety strip's live reads show explicit "on-chain read unavailable" (never silently substitute API values for the reserve figures). API down → SSR error boundary with retry.

---

## 3. Page specs (point-for-point from §5)

### 3.1 Discover `/` (§5.1)

> **SUPERSEDED by §12.50(f) (D-1 user-ratified 2026-07-12; spec entry being recorded by robbed-architect):** the shipped Discover is the **TRENDING carousel + live event tape** — the KotH hero, token grid, 5 sorts / 3 filters, and Discover URL-state below are **retired from the page** (they remain API capabilities). Authoritative surface description: `src/views/discover/ui/DiscoverView.tsx` + `docs/user-flows.md` DISC-1..DISC-4 (amended 2026-07-12). The creator click now deep-links `/?q=<creator>` into the header search (DISC-4). The tree below is kept as the pre-redesign design record only.

**Component tree** *(pre-§12.50(f) — superseded, see banner)*

```
DiscoverPage (server)
├── KingOfTheHillHero            // §5.1: closest to graduation, volume-weighted
│   ├── TokenAvatar / name / ticker / creator
│   ├── ProgressBar (graduation %)  + mcap + 24h volume
│   └── CTA → /t/[address]
├── LaunchTicker (client, WS)    // §5.1: live launch ticker
├── ControlsRow (client)
│   ├── SortTabs: trending | newest | mcap | 24h volume | progress
│   ├── FilterTabs: pre-grad | graduated | all
│   └── SearchBox (debounced 200ms, API pg_trgm)
└── TokenGrid (client, hydrated from SSR initialData)
    └── TokenCard × n            // §5.1 card fields, exactly:
        image · name · ticker · mcap · progress bar · 24h Δ% · creator · age
```

**Data requirements**

| Component | Endpoint / channel | Notes |
|---|---|---|
| Hero | `GET /v1/tokens/king-of-the-hill` | Ranking formula ratified (spec §12.22): `progress × ln(1+vol24h)` — indexer/API-owned; frontend renders whatever the API returns |
| Ticker | WS `global:launches` — `launch`, `graduated` messages | New launches slide in left; each entry links to `/t/…`; cap ~30 in memory |
| Grid | `GET /v1/tokens?sort=&filter=&cursor=&limit=48` cursor-paginated; WS `global:trades` + `global:launches` patch mcap/Δ%/progress for visible cards | `trending = vol24h × e^(−age/24h)` ratified (spec §12.22), API-computed |
| Search | `GET /v1/search?q=` over name/ticker/contract/creator (`pg_trgm`, §5.1/§8) | Results dropdown: token rows + creator rows; Enter navigates to best match |

Card metrics (mcap, 24h Δ%, volume) come exclusively from the indexer — computed values, never client-side price math, never constants (§2). USD renditions only via the live ETH/USD endpoint; primary denomination is ETH.

**States**
- Loading: skeleton hero + 12 skeleton cards (fixed heights, zero layout shift).
- Empty (filter/search yields nothing): "No tokens match." + clear-filters action. Pre-launch empty chain: hero hidden, grid empty-state with `/launch` CTA.
- Error: inline `ErrorState` with retry per section — hero failure must not blank the grid and vice versa.
- New-token flash: card entering via WS gets a brief highlight ring (≤1s), no reflow of the user's scroll position (prepend only when scrolled to top; otherwise show "n new" pill).

**Interactions:** sort/filter/search sync to URL searchParams; card click → `/t/[address]`; creator click → search filtered by creator; infinite scroll via cursor.

### 3.2 Token Detail `/t/[address]` (§5.2)

> **SUPERSEDED in part by §12.57/§12.58 (ROBBED_ redesign, ratified 2026-07-12):** the first-class **Trust panel is DELETED (§12.57)**. Its HARD-RULE must-render floor — the §12.14 LP-copy sentence, graduation progress, and live curve reserves — **relocates** (never vanishes) into a compact **`widgets/safety-strip`** rendered above the right-column **Top Holders table** (**`widgets/holder-table`**, §12.58: rows `rank · address · label · amount · percent`; `label` = Bonding curve / Creator / Vault plus advisory sniper/programmatic bot-flags). The "TrustPanel — all seven items" subsection below is rewritten to the **SafetyStrip + HolderTable** surfaces; the standalone organic-holder RANGE / flow-quality blocks moved off the public page to the internal §12.54 endpoint (the surviving public §8.5 signal is the holder-table flags).

**Component tree**

```
TokenDetailPage (server: SSR shell, meta/OG tags, initialData)
├── TokenHeader                  // avatar, name, ticker, mcap, 24h Δ%, graduation ProgressBar,
│                                //    status pill: Bonding curve | Graduating | Graduated → Uniswap V3
├── main grid (2-col desktop / stacked mobile)
│   ├── PriceChart (client)                 // §5.2 venue-continuous candles — see below
│   ├── TradeFeed (client, WS)              // §5.2 live feed; confirmation tiers (soft tier renders no chip — §12.56)
│   └── TokenInfo                           // description, links, contract + curve + pool Blockscout links,
│                                           //    creator profile link, created-at, metadata JSON link
└── right rail
    ├── TradeWidget (client)                // §5.2 invisible venue switch — see below
    ├── SafetyStrip (client)                // §12.57 relocated must-render floor (LP sentence · graduation · reserves · fee) — see below
    └── HolderTable (client)                // §12.58 Top Holders table (replaces the deleted Trust panel) — see below
```

#### Chart — venue-continuous candles (§5.2, §8)

- `lightweight-charts` candlestick series + volume histogram pane.
- Intervals: **1s · 15s · 1m · 5m · 15m · 1h** (spec range "1s→1h"); default 1m pre-grad, 5m post-grad.
- `GET /v1/tokens/:address/candles?interval=&from=&to=` returns **one series** — the indexer merges curve `Trade` events and V3 `Swap` events (§8). The frontend renders exactly one `CandlestickSeries` across graduation: **no venue seam, no gap, no marker discontinuity, no second series**. A subtle vertical annotation line labeled "Graduated to Uniswap V3" at the graduation timestamp is the only venue artifact (annotation, not data).
- Live updates: WS `candle` messages on `token:{address}:candles:{interval}` patch the current bucket via `series.update()`; historical backfill via TanStack Query on interval switch/pan.
- Price axis in ETH; header shows spot price with optional USD (live source + timestamp, §2).

#### TradeWidget — invisible venue switch (§5.2)

One widget, one visual design, two engines. The user never chooses a venue; the token's `status` (indexed, on TokenCard/TokenDetail: `curve | graduating | graduated` — api.md §3.4, derived per indexer.md §3.2) selects the engine. Copy never says "switching venues" — post-grad footnote reads "Trading on Uniswap V3" with a pool link.

| | Pre-grad (curve) | Post-grad (Uniswap V3, 1% tier) |
|---|---|---|
| Quote | **On-chain `Router.quoteBuy/quoteSell` views** (they exist — contracts.md §2.3/§2.4; they also return graduation-clamp `acceptedEthGross`/`refund`), with the shared quote library in `packages/shared` as display fallback + test oracle (`tokensOut = virtualToken − k/(virtualEth + ethIn)` after the ETH-leg fee, sell inverse — §6.2) | Uniswap `QuoterV2` static call, token/WETH 1% pool (addresses from `lib/addresses.ts`; V3 periphery addresses are open §13) |
| Execute | `Router.buy{value}` / `Router.sell` (+ permit variant when allowance absent — one signature instead of approve+sell) | `SwapRouter02 exactInputSingle`; buys send native ETH (router wraps), sells unwrap to ETH via multicall — user only ever sees ETH |
| Slippage | default **2%**, editable 0.1–50 with warnings >5% | same |
| Deadline | on **every** trade, default now + 10 min | same |

Widget rules:
- Buy tab / Sell tab; input in ETH (buy) or token (sell), MAX buttons (buy MAX leaves gas headroom); quote line shows expected out, min-received-after-slippage, fee line "1% curve fee → treasury" pre-grad / "Uniswap V3 pool fee: 1%" post-grad, and price impact.
- **Sells always work (§6.5):** the sell path reads no pause flag. If `pauseBuys` is set (read live from Router), the Buy tab shows "Buying is temporarily paused — selling remains open" and only the buy inputs disable. The Sell tab is never gated by any flag, ever. Post-graduation there is no pause surface at all (§6.5).
- **Anti-sniper window (§6.5):** for tokens younger than the early window, surface the per-tx buy cap ("Early-launch buy cap: max X ETH per transaction") read from Router config — better than letting the tx revert.
- `graduating` interstitial (curve locked at threshold, `graduate()` not yet executed): widget shows "Graduating to Uniswap V3…" and disables **both** buy and sell inputs for the interstitial seconds; status flips to `graduated` on the WS `graduated` message (`token:{address}:events`). **Ratified (spec §12.12):** the `ReadyToGraduate` window locks both directions — a deterministic, permissionlessly-exitable protocol state, not a pause; interstitial copy must not describe it as "paused".
- Not connected: widget fully renders quotes read-only; CTA is Connect Wallet.
- After submit → optimistic trade lifecycle, §4 of this doc.

#### SafetyStrip (§5.2, §8.3; §12.57) — the relocated must-render floor, exact sourcing

**Supersedes the deleted TrustPanel.** After §12.57 deleted the first-class Trust panel, its signals relocate into a compact hairline-bounded **`widgets/safety-strip`** rendered above the Top Holders table (right rail desktop, above the fold on mobile after the widget). Each row: label, value, verify affordance (Blockscout link where applicable). Live reads come from `useCurveReads` (batched viem reads on the per-token curve/token addresses), refetched on every WS trade — **never the API's cached values** (§5.2). Rows **3, 4, 5** are the §12.14 **hard-rule must-render floor** (they may never vanish); rows **1, 2, 6, 7** are the cheap-to-keep verification ticks.

| # | Item | Source | Render |
|---|---|---|---|
| 1 | **Ownerless token ✓** | Structural guarantee: indexer confirms factory provenance (token deployed by our `CurveFactory`); `LaunchToken` has no owner/mint/burn/hooks (§6.1). Verify link → verified source on Blockscout | ✓ + "Ownerless token" tick + "verify ↗" Blockscout link |
| 2 | **Fixed 1B supply ✓** | **Live** `totalSupply()` read via viem; must equal 1e27 wei (§6.1) | ✓ + "1,000,000,000 fixed" (derived from the shared supply constant, not a literal; ⚠ mismatch state exists defensively; should be impossible) |
| 3 | **Live curve reserves** *(hard-rule floor)* | **Live on-chain** `BondingCurve` reads: real ETH reserves + real token reserves (exact getter names from the M1 interface via shared ABIs). Refresh on each WS trade. **Never the API's cached values** (§5.2). Post-grad: row becomes "curve retired — N ETH held" (live read; §10 invariant: post-grad curve holds zero value) | "X.XXXX ETH · N tokens — read from chain" |
| 4 | **Graduation threshold + progress** *(hard-rule floor)* | Threshold: on-chain constant (`GRADUATION_ETH`, §6.2). Progress: live reserve read ÷ threshold, via the shared `GraduationProgress` (full variant) | ProgressBar + "X of Y ETH raised". Post-grad: "Graduated ✓" + pool link |
| 5 | **LP destination** *(hard-rule floor)* | The ONE shared `LP_DESTINY_COPY` constant, VERBATIM + LPFeeVault/pool links post-grad | Exactly: **"LP principal permanently locked; trading fees claimable by treasury."** (canonical sentence, ratified spec §12.14 — spec §5.2 amended to match; see §5 of this doc) |
| 6 | **Fee policy** | Fee bps read live from the curve's per-token `TRADE_FEE_BPS` (hard-capped ≤2% in code, §6.5) | "1% → treasury" — the number rendered from the on-chain value, not a string literal, so copy can never drift from code |
| 7 | **Metadata hash verdict** | Indexed: on-chain `metadataHash` from `TokenCreated`/token storage vs indexer's keccak256 of the fetched canonical JSON (§8.3) | ✓ "Metadata matches" or ⚠ "Metadata MISMATCH" (red, prominent). Verdict comes **from the indexer**; the frontend never recomputes-and-overrides it |

Items 2, 3, 4, 6 are **live on-chain reads**; 1 and 7 are indexer verdicts; 5 is fixed copy. If RPC reads fail, rows 2–4/6 show "on-chain read unavailable — retry" (a "Retry reads" button re-drives `useCurveReads`), never a cached substitute.

**Organic-flow metrics — REMOVED from the public page (§12.57).** The standalone organic-holder RANGE + flow-quality blocks (formerly appended here, from `GET /v1/tokens/:address` `trust.organic`, indexer `token_flow_stats`, §8.5) are **no longer rendered on Token Detail**; they are preserved on the internal §12.54 endpoint. The **only surviving public §8.5 signal** is the advisory **bot-flags on the Top Holders table** (below) — heuristic, labeling-only, never gating anything (spec §8.5), framed as such and never over-stating confidence.

#### TradeFeed (§5.2, §2.1)

- Initial `GET /v1/tokens/:address/trades?limit=50`; live prepend via WS `trade` messages on `token:{address}:trades`; user's own optimistic trades merge in (§4).
- Row: side (buy/sell color), ETH amount, token amount, price, trader (address, creator-flagged), age, **ConfirmationBadge**, Blockscout tx link.
- Badges (§12.56): a soft-confirmed row renders **no settlement chip** — a fresh trade makes no finality claim. The `ConfirmationBadge` surfaces only once the indexer upgrades the row: `posted` (blue) → `finalized` (green). Rows never render as unqualified-final. The tier machinery (soft → posted-to-l1 → finalized) is unchanged (§2.1/§8) — only the soft-confirmed chip is dropped.

#### HolderTable — Top Holders (§5.2/§12.58) — replaces the deleted Trust panel

The right-column **Top Holders table** is the §12.57/§12.58 transparency surface that replaces the deleted Trust panel. RULED row shape: **`rank · address · label · amount · percent`**. `GET /v1/tokens/:address/holders` is **server-authoritative** (§12.59/§12.22): column headers dispatch a `?sort=&dir=` refetch and pagination is an opaque keyset cursor — the **browser never re-ranks**. Balances are the indexer's Transfer-derived truth (§12.16) — no new on-chain surface. Refresh on WS trade events (throttled ≥5s). Empty pre-first-trade: message that the bonding curve holds the full supply until the first trade.

The **`label`** column carries the structural role (**Bonding curve / Creator / LP fee vault**, §12.16) **plus** the advisory §8.5 bot-flags (`farm`/`sniper`/`programmatic`/`wash`/`arb_exit`) rendered as small badges — heuristic labels only, never presented as fact, never gating anything. This is now the surviving **public** organic-flow signal (the standalone organic-range / flow-quality blocks moved to the internal §12.54 endpoint).

**Page states**
- SSR 404 → `not-found.tsx` ("Token not found on ROBBED_" + address echo + Blockscout link).
- Moderation-hidden token (§8.4): render a minimal "listing hidden" page — moderation gates listing, never chain state; the Blockscout link remains.
- Brand-new token (arriving from Launch): page renders from WS/optimistic data immediately; chart shows "first trades incoming" empty state until candles exist.

### 3.3 Create `/create` (§5.3) — renamed from Launch `/launch` (ROBBED_ redesign, §12.50)

> The **route is `/create`** (`/launch` 308-redirects, next.config.ts); the FSD slice name stays `features/launch-token` and the internal component names below (`LaunchPage`/`LaunchForm`/`LaunchProgress`) are unchanged.

**Component tree**

```
LaunchPage (server shell)
├── LaunchForm (client)
│   ├── name (required)
│   ├── ticker (required, ≤10 chars, uppercased, [A-Z0-9])
│   ├── description (required?→ see zod schema; ≤500 chars, counter)
│   ├── ImageUpload (required, ≤4MB, jpg/png/webp/gif → POST /v1/uploads/image; API sniffs+re-encodes, §12.19)
│   ├── links (optional: website, x/twitter, telegram)
│   ├── InitialBuyField (optional ETH amount — atomic initial creator buy, anti-self-snipe §5.3/§6.5)
│   │     └── live preview: tokens received (shared curve math) + minTokensOut at 2% slippage
│   └── submit: "Launch — {deployFee} ETH" (+ initial buy)  // deployFee READ LIVE from factory config
├── EconomicsPanel                        // §5.3 "economics displayed plainly":
│   │   creation fee (live read) · 1% trade fee → treasury · graduation threshold (live read, ETH)
│   │   · LP tranche → Uniswap V3 · exact LP sentence verbatim:
│   │   "LP principal permanently locked; trading fees claimable by treasury."
└── LaunchProgress (client)               // post-submit stepper, §4 lifecycle
```

Validation: zod schema **imported from `packages/shared`** — byte-identical constraints to the API's server-side validation. Client validation is UX; the API re-validates and re-encodes (§8.4).

**Submit sequence (§5.3, §8.3) — single user-visible transaction**

1. **Image:** `POST /v1/uploads/image` (multipart — **API-mediated**, ratified spec §12.19: the API MIME-sniffs + re-encodes before anything reaches R2; there is no browser presign) → returns `{ imageUrl, imageHash }`. Upload happens eagerly on file select, before submit.
2. **Metadata:** `POST /v1/metadata` with `{ name, ticker, description, links, imageUrl, imageHash }`; the API canonicalizes with the shared canonicalizer, keccak256-hashes, and stores the canonical bytes at `metadata/{hash}.json` on R2 — done **before** the tx so the indexer verifies instantly on `TokenCreated`. Returns `{ metadataHash, metadataUri, canonicalJson }`. (Ratified contract — api.md §3.2.)
3. **Client verification (normative, api.md §3.2):** the client independently runs `canonicalizeMetadata` + `keccak256` from `packages/shared` on the same object and **must** verify its own hash equals the API's `metadataHash` before signing — a buggy or malicious server cannot commit the user to metadata they didn't write.
4. **Transaction:** `Router.createToken(name, symbol, metadataHash, metadataUri, minTokensOut, deadline){ value: deployFee + initialBuy }` (contracts.md §2.4, spec §12.15). `deployFee` read live from factory config in the same render — never a constant. `minTokensOut` from the quote path at 2% default slippage when `initialBuy > 0`, else 0.
5. **Post-submit:** `LaunchProgress` stepper — Uploading ✓ → Metadata pinned ✓ → Transaction sent → **Live** (§12.56: the visible "Soft-confirmed" step label became **Live**; the internal `soft-confirmed` step name is unchanged, and the stepper's shared `ConfirmationBadge` renders no chip at the soft tier) → redirect to `/t/[address]` (token address from receipt logs or the WS `launch` message on `global:launches`, whichever first). Token is tradeable in **<1s at the soft-confirmed tier** (§5.3) — the redirect target renders immediately from optimistic + WS data.

**States & errors**
- Image too large / bad MIME: inline error pre-upload (client) and again on API rejection.
- Ticker collision: not blocking (chain allows duplicates) — advisory "ticker already exists" hint from search, plus impersonation-flag awareness (§8.4) for top-asset/Stock-Token tickers: warn that such listings may be flagged.
- `pauseCreates` active (live Router read): submit disabled with "New launches are temporarily paused." (Sells elsewhere unaffected — flag is granular, §6.5.)
- Tx rejected in wallet → stepper resets to review, form state preserved. Tx reverted → error with Blockscout link; metadata/image uploads are reusable on retry (hash unchanged).
- Wallet not connected: full form usable; submit = Connect.

---

## 4. Optimistic UI & confirmation semantics (§2.1)

> **§12.56 (USER-DIRECTED, ratified 2026-07-12) — soft-confirmed chip removed:** the visible "Soft-confirmed" status chip + its L2-finality tooltip are **removed** from the trade UI. The **tier machinery is unchanged and still binding** — the reducer/reconcile still tracks the soft tier, the §12.20 `global:confirmations` watermark still upgrades rows, `posted`/`finalized` still surface, and large-value (≥1 ETH) displays still disclose them. Only the soft tier's **visible badge** is dropped: the shared `ConfirmationBadge` **returns null** for a soft-confirmed row, so a fresh trade makes **no finality claim** until it upgrades to posted/finalized. The never-final-while-soft rule then holds trivially (no chip at all). This applies everywhere below where the pre-§12.56 text still says "soft-confirmed badge".

Wire vocabulary: confirmation states on the wire are `packages/shared` `ConfirmationState` values — `soft_confirmed | posted_to_l1 | finalized` (indexer.md §3, api.md §2). The hyphenated forms in this doc ("soft-confirmed", "posted-to-l1") are display labels only; no second enum exists in `apps/web`.

### 4.1 Trade lifecycle state machine (`lib/trades.ts`)

```
            wallet reject
submitted ───────────────▶ removed (toast)
    │ tx hash
    ▼
optimistic:pending  ──── rpc receipt: reverted ──▶ failed (row turns error, toast, quote refreshed)
    │ rpc receipt: success  (FCFS sequencer inclusion ⇒ soft-confirmed, sub-second)
    ▼
optimistic:soft-confirmed        // NO settlement chip (§12.56) — values still OUR estimate
    │ WS `trade` event with matching txHash
    ▼
indexed:soft-confirmed           // RECONCILED — amounts/price replaced by indexed truth
    │ O(1) `confirmations` watermark broadcast on `global:confirmations` (§12.20) — client upgrades
    │ every held row locally: blockNumber ≤ safeBlock ⇒ posted; ≤ finalizedBlock ⇒ finalized.
    │ NOT per-event messages (there is no per-row confirmation WS message); REST serves the materialized column.
    ▼
indexed:posted-to-l1  ──▶  indexed:finalized
```

Rules (constraint-level, from §2.1/§5):
1. **Immediate render:** the moment the tx is sent, an optimistic row appears in TradeFeed (and the widget shows the pending state) — **no soft-confirmed chip (§12.56)**; the row is visually distinguished by opacity + the transient pre-inclusion pulse until reconciled. Perceived latency is the product (§1).
2. **Reconcile, never trust self:** when the indexed event arrives, its amounts/price/ordering **replace** the optimistic values (match key: `txHash`, fallback `sender + nonce`). Optimistic rows are visually distinguishable (slight opacity + pulsing badge) until reconciled.
3. **Never final while soft-confirmed:** no checkmark-final treatment, no "confirmed" wording without the tier qualifier, anywhere a soft-confirmed trade renders. Post-§12.56 this holds trivially — a soft-confirmed trade shows **no settlement chip at all** until it upgrades to posted/finalized.
4. **Never drop on contradiction:** if the WS event disagrees (different amounts, e.g. graduation-clamp partial fill or fee rounding), the row updates to indexed truth with a brief "updated" shimmer — it is not removed. If the indexer reports the tx failed/absent while RPC said success, show "unverified — awaiting indexer" and poll `GET /v1/trades/:txHash` (api.md §3.4); escalate to error state only on indexer-confirmed absence after timeout (default 30s).
5. **WS silence:** optimistic-soft-confirmed with no WS event within 10s → keep the row in an "awaiting index" state, REST poll fallback kicks in (no chip is shown at the soft tier — §12.56; the awaiting-index note surfaces on the posted/finalized badge once the row upgrades). Never silently promoted, never silently dropped.

### 4.2 Where each tier surfaces

| Tier | Surfaces |
|---|---|
| **Soft-confirmed** | **No visible chip (§12.56)** — a fresh trade makes no finality claim. The tier is still tracked (reconcile + `global:confirmations` watermark) and drives the optimistic row's presence, but the `ConfirmationBadge` renders null across TradeFeed rows, TradeWidget result toast, Create stepper, and ticker entries (§2.1.1) |
| **Posted to L1** | Badge upgrade in TradeFeed (on hover/detail); **required disclosure** on large-value displays — trade rows above a notional threshold (config, ETH-denominated) show the explicit tier; any future bridge/withdrawal UI must gate on it (§2.1.2) |
| **Finalized** | Final badge state in trade detail; withdrawal-grade disclosures (§2.1.3). v1 has no bridge UI, but `ConfirmationBadge` supports all three states from day 1 so the semantics are product-wide |

`ConfirmationBadge` is one shared component: the **soft-confirmed tier renders null (§12.56)**; `posted` (blue) → `finalized` (green) render with a tooltip explaining the tier in one sentence each, including the single-sequencer dependency disclosure language (§10.10). (The transient pre-inclusion `pending` state still shows an amber pulse — that is a broadcast-awaiting-inclusion indicator, not a soft-confirmed finality claim.)

Global mutations follow the same pattern: token creation (Launch stepper), graduation (status pill flips on the WS `graduated` message, chart annotation appears, widget re-engines — all WS-driven, no reload).

---

## 5. Copy rules (enforced, not aspirational)

1. **The LP sentence** — everywhere LP destiny is described (SafetyStrip LP row — §12.57, formerly Trust-panel item 5 — the Create EconomicsPanel, tooltips, OG alt text, FAQ strings), the string is exactly:
   > **"LP principal permanently locked; trading fees claimable by treasury."**
   The word **"burned" is forbidden in any LP context** (CLAUDE.md, §5.3, §6.3). It flips only if the documented V2 fallback is ever adopted — a spec-level decision, not ours. Implementation: the sentence lives in **one exported constant** (`LP_DESTINY_COPY` in `packages/shared` or `lib/copy.ts`) and every render site imports it; the copy-lint test asserts no second spelling exists.
2. **Never order-book / exchange claims** (§1): forbidden in copy — "order book", "orderbook", "real-time exchange", "instant finality", "instantly final". Allowed framing: "soft-confirmed in under a second", "AMM", "bonding curve".
3. **No hardcoded market metrics** (§2): no numeric USD, ETH/USD, TVL, volume, or mcap literals in code or copy. The "$69k-equivalent" graduation figure is **never rendered as $69k** — the UI shows the on-chain ETH threshold, with USD only via the live-priced endpoint labeled with source + timestamp. Fee percentages render from on-chain config values.
4. **Confirmation-tier disclosures** (§2.1): any surface implying settlement carries the tier badge/qualifier; large-value displays disclose posted/finalized; the known-risks language (no-firm-audit, single sequencer, soft-confirmation semantics, centralized listing moderation — §10.10) is linked from the footer.
5. **Moderation honesty** (§8.4): hidden listings say "hidden from listing" — never imply the token is off-chain-disabled.
6. **Stored-link safety** (threat-model UM-5): user-supplied `links` render only as `https:` anchors with `rel="noopener noreferrer"` under a strict CSP. The API already rejects non-`https:` schemes (api.md §6.4), but the frontend re-checks the scheme before rendering and never interpolates a link into an `href` without the allowlist — `javascript:`/`data:` hrefs must never reach the DOM. A Playwright XSS-render assertion (a token whose `links` contain a `javascript:` payload renders no executable href) is in the e2e suite (§8.2).

---

## 6. OG images & sharing (§5.2, §9) — **REWRITTEN 2026-07-12: OG rendering relocated web → API**

The per-token OG image is **the viral share unit** — a link paste into X/Telegram/Discord must sell the token at a glance, with zero client JS.

**Where the PNG comes from (normative):** the raster is rendered by the **API**, not the web app — `GET {API_ORIGIN}/v1/og/{address}.png` (native `satori` + `@resvg/resvg-js` on Bun, R2-cached at `og/{address}/{version}.png`; contract + card content spec live in `docs/services/api.md` §3, landed in commit `9528121`). Rationale: the web ships as a Cloudflare Worker via OpenNext (spec §12.45), and bundling `@vercel/og`/resvg-WASM blew the Worker's 3 MiB Free size limit, while `workerd` cannot load the native resvg N-API addon at all. The API runs on Bun/Komodo with neither constraint. Earlier §6 revisions (web `opengraph-image.tsx` route → `next/og` `ImageResponse` on workerd) are **superseded**; the web renders no OG raster and carries no satori/resvg/`next/og` dependency.

**What web still owns (normative for `apps/web`):**

- **The metadata pointer** — `src/views/token-detail/model/metadata.ts` `generateTokenMetadata(address)`, called from `app/t/[address]/page.tsx` `generateMetadata`:
  - `openGraph.images` + `twitter.images` (card `summary_large_image`) point at the **absolute** API URL `${env.apiBaseUrl()}/v1/og/{lowercased-address}.png` — origin from env, never inline (§2). Absolute URLs mean no `metadataBase` is needed (Next `generateMetadata` docs, verified 2026-07-10).
  - **The 1200×630 contract** — width/height are declared on the OG image entry and must match the API's raster contract (api.md: `image/png` 1200×630).
  - Title/description are produced server-side from the indexed token summary; unknown token degrades to a not-found title (no throw), transient API failure degrades to the bare brand title.
- **The test** — `tests/token-detail-og.test.ts` proves: textual OG/Twitter metadata is SSR-produced; the image URL is absolute, API-origin, lowercased-address, `1200×630`; a 404 degrades without throwing. The `javaScriptEnabled:false` DOM-level assertion (OG meta present with no client JS) lives in the Playwright TD-12 scenario.
- **SSR of the page itself** (§5.2): Token Detail's server-rendered HTML includes title/description/OG tags and the meaningful above-the-fold content (name, ticker, mcap, progress, trust summary) so crawlers and JS-off clients get the pitch — the interactive chart/widget hydrate on top.

**Deploy target (unchanged):** Cloudflare Workers via OpenNext (`@opennextjs/cloudflare`, spec §12.45; NOT Bun self-host, NOT Pages-edge). `apps/web/wrangler.jsonc` (`name: robbed`, `nodejs_compat` + `global_fetch_strictly_public`, `ASSETS` + R2 `ASSETS_BUCKET`/`NEXT_INC_CACHE_R2_BUCKET` → `robbed-assets`), `apps/web/open-next.config.ts` (`r2IncrementalCache`, ISR day one), `next.config.ts` dev hook `initOpenNextCloudflareForDev()`. Scripts: `build:cf` / `deploy:cf` / `preview:cf` / `cf-typegen`. All `NEXT_PUBLIC_*` are build-inlined → set as Workers **build vars** (root `.env.example`); the env reads (`shared/lib/env.ts`) tolerate missing vars during `next build` (placeholder, no hard-fail) but still fail loud at runtime.

---

## 7. Design system (§9: dark, dense, fast) — **ROBBED_ terminal skin (redesign Phase F, 2026-07-10)**

> **SUPERSEDES the M3-2 look** (user-directed redesign — spec §12.50; planning doc retired 2026-07-12, history: git).
> Brand: **`ROBBED_`** (blinking green `_` cursor motif — `<Wordmark/>`/`<CursorTag/>`; `BRAND` constant
> in `shared/config/copy.ts`). Deviations recorded for robbed-architect §12: (1) four pages incl.
> Portfolio (overrides §5 "exactly three" / §5.4 Phase-2); (2) `/launch`→`/create`; (3) brand
> ROBBED_→ROBBED_ (§13 brand question resolved by direction); (4) terminal-mono skin supersedes the
> §12.24 shadcn look (primitives remain, restyled); (5) mobile-first primary layout. Protocol rules
> (§2 live-metrics, §6.5 sells-open, LP copy, §2.1 tiers) UNCHANGED.

- **Component model: atomic × FSD.** Atoms/molecules = `shared/ui` (MonoText/MonoLabel, Chip, Tab/TabBar, SideBadge, Delta, StatCell, TokenAvatar, ProgressBar, CursorTag, Wordmark, Divider, AddressChip, LiveDot, AmountInput); shadcn primitives stay vendored under `shared/ui/kit` restyled to tokens; organisms = `widgets/*`; templates = `views/*`.
- **Re-theming = token swap (unchanged rule, lint-enforced §8.3):** no raw hex/rgb/hsl or arbitrary color classes outside `globals.css` (+ `shared/ui/kit` and non-presentational `shared/lib|api|config`).
- **Dark-only** (`<html class="dark">`, §12.23) — the terminal skin is inherently dark; no toggle.
- **Tokens (`globals.css`, Tailwind v4 `@theme`) — EXACT values, sampled from the ratified redesign mockup (spec §12.50) computed styles (Playwright, 2026-07-10):**
  - surfaces `--color-bg #0B0D0B` · `--color-surface #0F130F` · `--color-surface-2 #141914` · `--color-border #1C221C` · `--color-border-soft #141914` (row hairlines) · `--color-border-strong #2A342A` · `--color-active #1C221C` (active tab/chip fill)
  - text ramp `--color-text #EDF3ED` · `--color-text-secondary #C9D3C9` · `--color-text-tertiary #8FA08F` · `--color-muted #6E7A6E` · `--color-faint #54604F`
  - accents `--color-green #4ADE80` (primary/BUY/+Δ/CTAs) · `--color-green-dim #16301F` · `--color-green-soft #2E4A34` (up-candles) · `--color-red #F87171` (SELL/−Δ) · `--color-red-dim #4A2E2E` (down-candles) · `--color-purple #A78BFA` (GRADUATE) · `--color-accent = green`, `--color-accent-foreground #0B0D0B`
  - tiers (§2.1) `--color-soft-confirmed #F59E0B` · `--color-posted #3B82F6` · `--color-finalized #4ADE80` (kept distinct from trade hues; mockup shows none — Phase-F decision). **§12.56:** the soft tier no longer renders a status chip on a trade — the amber `--color-soft-confirmed` token now only backs the transient pre-inclusion "Pending" pulse and the advisory holder bot-flag chips; `--color-posted`/`--color-finalized` still surface.
  - type: **IBM Plex Mono self-hosted** (`next/font/local`, `src/app/fonts/`, OFL — no external fetch/CSP-safe), weights 400/500/600; mono-everywhere (`--font-sans` == `--font-mono`); scale `--text-2xs 10.5px` / `xs 11` / `sm 12` / `base 13` / `md 14` (wordmark) / `lg 15` / `xl 17`; `--tracking-label 0.12em` (wordmark + micro-labels)
  - radii: **square** — `--radius-sm/md/lg/xl: 0px` (every sampled control is 0); `rounded-full` only for avatars + the live dot; `--animate-blink` = the cursor motif
  - RainbowKit theme: `darkTheme({ accentColor: "var(--color-green)", borderRadius: "none" })` — CSS-var indirection keeps hexes out of `providers.tsx`.
- **Density:** base 13px mono, `leading-[1.45]`; hairline `border-soft` row dividers (tape rows ≈45px, pad `11px 24px` desktop); `tabular-nums` for every numeric column; flat — no shadows.
- **Speed:** skeletons with fixed dimensions (no CLS); WS patches over refetch loops; route prefetch on card hover; `next/image` for token images via R2 CDN; no heavyweight animation lib — CSS transitions only; ticker animates with CSS transform.
- **lightweight-charts config:** `layout.background: --bg`, grid lines `--border` at low alpha, up/down colors = buy/sell tokens, `timeScale.secondsVisible: true` for 1s/15s intervals, `rightPriceScale` autoscale, crosshair magnet. Chart height 420px desktop / 280px mobile.
- **Mobile:** single column — header → chart → TradeWidget (sticky Buy/Sell bottom bar) → SafetyStrip → Top Holders → TradeFeed → info. Discover grid becomes a card list; ticker stays. All tap targets ≥40px despite density.
- **Numbers:** `Amount` component — ETH to 4 significant decimals, token amounts compact (1.24M), percents 1 decimal; `UsdAmount` renders **only** with a live price object and exposes source+timestamp on hover (§2).

---

## 8. Testing (§9, CLAUDE.md)

### 8.1 Vitest units (`apps/web/tests`)

| Suite | Asserts |
|---|---|
| `quotes.test.ts` | Widget display math (min-received, price impact, fee line) against `packages/shared` reference vectors — the same vectors the contracts' Foundry tests use, so UI quotes can't drift from chain math |
| `canonicalizer.test.ts` | Launch flow produces byte-identical canonical JSON + keccak256 for shared fixtures (indexer uses the same fixtures — §8.3 hash must match cross-service) |
| `trade-reducer.test.ts` | §4 state machine: optimistic insert → WS reconcile replaces values; contradiction updates-not-drops; revert removal; WS-silence keeps row with awaiting-index state; **no path renders `final` from an optimistic state** |
| `badge.test.tsx` | `ConfirmationBadge` surfaces the `posted`/`finalized` tiers; the **soft-confirmed tier renders null (§12.56)** — a soft-confirmed trade shows no settlement chip and never a final treatment |
| `sell-gating.test.tsx` | With `pauseBuys=true` and `pauseCreates=true` mocked, Sell tab is enabled and submits; Buy tab disabled with the exact pause copy (§6.5) |
| `format.test.ts` | `UsdAmount` throws/renders-nothing without `{price, source, asOf}`; never a bare USD figure |
| `copy-lint.test.ts` | See 8.3 — runs as a unit test in CI |

### 8.2 Playwright e2e on fork (§9)

Environment: anvil fork of Robinhood Chain (real WETH `0x0Bd7…AD73`, deployed M1 contracts) + local indexer/API/WS stack pointed at the fork (compose profile from M2).

| Scenario | Covers |
|---|---|
| **Launch flow** | Fill form → API-mediated image upload → metadata canonicalize/pin + client hash re-verify → single `createToken` tx with initial buy → soft-confirmed <1s → redirect → token tradeable; EconomicsPanel contains the LP sentence verbatim (§5.3) |
| **Buy pre-grad, optimistic→reconcile** | Submit buy → optimistic row appears before the WS event (no soft-confirmed chip — §12.56) → WS event arrives → row values reconcile to indexed amounts (assert value replacement; row persists, not dropped) — the DoD "reconciliation demonstrated in a test" |
| **Sell while buys paused** | Set `pauseBuys` on fork Router → sell executes end-to-end; buy UI disabled (§6.5) |
| **Graduation venue switch** | Drive curve past threshold → `graduate()` → status pill flips via WS, widget quotes via QuoterV2, chart series continuous across the boundary (no gap: assert candle timestamps contiguous), SafetyStrip reserves + graduation rows flip to post-grad states |
| **SafetyStrip truth** | Reserves row equals direct `eth_call` values (not API); metadata-mismatch fixture renders the ⚠ verdict (§8.3) |
| **OG metadata** | Page HTML contains OG meta tags without JS (`javaScriptEnabled: false` context), with `og:image` pointing at the **API-served** PNG (`{API_ORIGIN}/v1/og/{address}.png`, §6); the PNG's 200/`image/png`/1200×630 contract is asserted against that API route |
| **WS reconnect** | Kill WS mid-session → degraded banner → restore → queries invalidated, feed gap closed |
| **Stored-link XSS** (UM-5) | Token whose `links` include a `javascript:`/`data:` payload → Token Detail renders no executable href (https-only allowlist + `rel=noopener noreferrer`); no script executes |

### 8.3 Copy/constant lint (CI-blocking, also pre-finish grep per workflow)

```bash
rg -i 'burn' apps/web --glob '!**/*.test.*'                 # zero hits in LP context (allowlist file for unrelated hits, reviewed)
rg -i 'order.?book|real.?time exchange|instant(ly)? final' apps/web   # zero hits
rg '0x[0-9a-fA-F]{40}' apps/web --glob '!lib/addresses.ts' --glob '!lib/chain.ts'  # zero: only generated addresses + WETH in chain.ts
rg '\$[0-9][0-9,\.]*[kKmMbB]?' apps/web                     # zero numeric USD literals in code/copy
rg -e '#[0-9a-fA-F]{3,8}\b' -e '\b(rgb|hsl)a?\(' -e '\[(#|rgb|hsl)' apps/web/app apps/web/components --glob '!app/globals.css'
                                                            # zero raw color values outside the token file (§7 / spec §12.24 —
                                                            #   no styling bypasses the design-token system)
```

Plus: LP sentence exists **only** as the single exported constant (grep for the sentence text outside its definition file = 0). `bun run build` and `bun test` green before any report (workflow rule).

---

## 9. Open items & decisions needed

**Resolved 2026-07-09 (spec §12):**

1. **WS + REST contract ratification** — **RESOLVED.** Canonical channels/messages = indexer.md §8.1/§8.2 (`global:launches`, `global:trades`, `global:confirmations`, `token:{address}:trades|candles:{interval}|events`; message types `launch`/`trade`/`candle`/`graduated`/`confirmations`/`reorg`/`metadata_verified`); canonical REST routes = api.md §3 (`/v1/...`, incl. `POST /v1/uploads/image` — no browser presign, spec §12.19 — and `GET /v1/trades/:txHash`, added to api.md). This doc has been corrected to the ratified names; all types come from `packages/shared`.
2. **ETH/USD endpoint** — **RESOLVED.** `GET /v1/eth-usd → { price, source, asOf }` exists (api.md §3.5), backed by `eth_usd_snapshots`.
3. **Ranking formulas** — **RESOLVED (spec §12.22).** KotH and `trending` are API-computed ratified defaults; frontend renders, never computes.
4. **Quote view functions** — **RESOLVED.** `Router.quoteBuy/quoteSell` exist (contracts.md §2.4); prefer the on-chain call, shared math is fallback + test oracle.
5. **Graduating-interstitial sells** — **RESOLVED (spec §12.12).** The `ReadyToGraduate` window locks both directions (deterministic, permissionlessly-exitable state — not a pause). The disabled two-sided "Graduating…" interstitial in §3.2 is the ratified UX; copy must not say "paused".
8. **LP wording divergence** — **RESOLVED (spec §12.14).** Canonical sentence confirmed: "LP principal permanently locked; trading fees claimable by treasury." Spec §5.2 amended; single exported constant stands.
9. **Dark-only v1** — **RESOLVED (spec §12.23).** Dark-only, no toggle.

**M3-1 runtime-check dispositions (recorded 2026-07-10, robbed-frontend; for architect §12/§13):**

6. **WalletConnect projectId & Robinhood Wallet verification** — **NEEDS-USER (unresolved by design; env/ops).**
   - **projectId:** `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is a per-org secret obtainable only at cloud.walletconnect.com — the user must furnish it. Disposition (`src/shared/lib/wagmi.ts`): injected (browser-extension) wallets work in **dev with no projectId**; the WalletConnect group and the Robinhood Wallet entry are **omitted from the wallet list until the id is set** (never a broken connector). `.env.example` carries the `web-6 NEEDS-USER` note.
   - **Robinhood Wallet connector:** docs-first finding — RainbowKit 2.2.11 ships **no `robinhoodWallet`** export (verified: no entry in `walletConnectors/`; GitHub code search `robinhood repo:rainbow-me/rainbowkit` → 0 hits). The `robinhoodWallet` in web.md §2.4 was an assumed export. Interim (safest-correct, `src/shared/lib/wallets/robinhoodWallet.ts`): a **custom RainbowKit wallet wrapping the shared WalletConnect connector** via the documented `getWalletConnectConnector` (web.md §2.4: "WalletConnect-based under the hood"). It is **UNVERIFIED on a real Robinhood Wallet on chain 4663** — no on-device / deep-link / WC-metadata test, and it only appears when a projectId is present. **NEEDS-USER:** a real Robinhood Wallet device connection test on 4663 + official WC metadata + brand icon (§13 brand pending). Flagged to robbed-architect (§13).
7. **Runtime verifications at M3 start** — **RESOLVED (both legs).**
   - **OG raster runtime (web-7):** **RESOLVED — SUPERSEDED (2026-07-12).** The question ("`next/og`/satori under Bun self-hosting", later retargeted to workerd/`ImageResponse`) is moot: OG rendering was **relocated to the API** (`GET /v1/og/{address}.png`, native satori + resvg on Bun, R2-cached — commit `9528121`; see §6). The web renders no OG raster, carries no satori/resvg/`next/og` dependency, and only points `og:image` at the absolute API URL (`src/views/token-detail/model/metadata.ts`, proven by `tests/token-detail-og.test.ts`).
   - **Multicall3 on 4663:** **UNCONFIRMED** — canonical `0xcA11…` deployment on 4663 is not verified. Disposition: `src/shared/lib/chain.ts` **omits** `contracts.multicall3` (commented, with rationale); the SafetyStrip's batch reads use **parallel `readContract` / `useReadContracts` without a multicall aggregator** (viem falls back to individual `eth_call`s when no `multicall3` is configured). No behavior depends on Multicall3; if/when it is confirmed on 4663, adding the address is a pure optimization. Flagged to robbed-architect (§13) as an infra confirmation item, not a blocker.
10. **Large-value disclosure threshold** — §2.1 requires posted/finalized disclosure on "large-value displays"; ETH notional threshold needs an M0/architect number before M3 exit (config value, not a literal). Spec §13.
11. **Pending §13 upstream:** V3 Factory/NPM/Quoter/SwapRouter addresses on 4663 **RESOLVED (spec §12.28)** — recorded in CLAUDE.md/constants; the post-grad widget + `addresses.ts` codegen consume them (codegen still comes from the M1 deploy pipeline, never hand-edited). Name/domain/brand (blocks OG brand mark and header); legal wrapper/ToS jurisdiction (blocks footer links); final curve constants + graduation tick (M0 — blocks economics display values, all read live regardless) remain open.

---

## Definition of done (M3 exit for `apps/web`)

- [ ] Four pages (Discover · Token Detail · Create · Portfolio); each matches its §5 subsection (checklists in §3 of this doc); Portfolio ships **read-only** — no new tx types, no `collect()` UI; no AA code paths
- [ ] Chain config: 4663, ETH gas, Blockscout explorer, RPC from env; WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` the only inline literal; all other addresses from generated `addresses.ts`; connectors = injected + WalletConnect + Robinhood Wallet
- [ ] SafetyStrip (§12.57): the §12.14 must-render floor (LP sentence · graduation progress · live curve reserves) plus ownerless / fixed-supply / metadata-verdict / fee ticks, with the exact sourcing table (live reads live, indexed verdicts indexed); reserve rows never show cached API values. Top Holders table (§12.58): rows `rank · address · label · amount · percent`; `label` = role (creator / curve / vault) + advisory §8.5 bot-flags; server-authoritative sort (no client re-rank); the standalone organic-range / flow-quality blocks moved off the public page to the §12.54 internal endpoint
- [ ] LP sentence verbatim from a single constant at every LP-destiny surface; `burned` absent (grep-verified)
- [ ] Optimistic trade lifecycle per §4: immediate soft-confirmed render, WS reconciliation, contradiction handling, posted/finalized surfacing — reconciliation demonstrated in Playwright
- [ ] Venue-continuous chart across graduation (no seam) and invisible venue switch in the widget; slippage default 2% + deadline on every trade
- [ ] Sell path provably ungated by pause flags (unit + e2e)
- [ ] No hardcoded market metrics (grep-verified); USD only with live source + timestamp
- [ ] Per-token OG image renders (chart snapshot + mcap + progress), page SSR meaningful without client JS
- [ ] Dark-first dense Tailwind UI; TanStack Query + WS wiring with reconnect/invalidation
- [ ] `bun run build` green under Bun; Vitest + Playwright green on fork; copy-lint greps clean
- [ ] All §9-of-this-doc gaps reported / decisions escalated to robbed-architect, none self-resolved
