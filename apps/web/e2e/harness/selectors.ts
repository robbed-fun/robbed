/**
 * ── centralized selectors (plan I-5a) ────────────────────────────────────────
 * The app ships almost no `data-testid`s, so these are COPY/ROLE-derived from the
 * real components (grepped 2026-07-10). Centralising them means that when the
 * live stack is available, any selector that drifted from the DOM is fixed in
 * ONE place. Prefer role + accessible-name; fall back to exact verified copy.
 *
 * Verified copy sources:
 *   trade-widget/ui/TradeWidget.tsx  — role="tablist"/"tab" Buy/Sell; pause copy;
 *     "Early-launch buy cap: max"; "Graduating to Uniswap V3…"; "Trading on Uniswap V3"
 *   entities/trade/ui/ConfirmationBadge.tsx — "Posted to L1" / "Finalized"
 *     (§12.56: the "Soft-confirmed" chip is REMOVED — `softConfirmed` is now an
 *     ABSENCE assertion in TD-9, not a presence selector).
 *   views/token-detail/ui/TokenInfo.tsx — the shared LP sentence (§12.14 floor).
 *     (§12.57, 2026-07-13: the token-detail SafetyStrip was DELETED; "Ownerless
 *     token"/"read from chain"/"1,000,000,000 fixed"/"Metadata MISMATCH"/"on-chain
 *     read unavailable" no longer render on /t/[address], so those selectors are
 *     removed — the LP line survives here in TokenInfo. ERR-13, which asserted the
 *     strip's "read unavailable" degradation, was RETIRED with the strip.)
 *   features/launch-token/ui/LaunchForm.tsx — "New launches are temporarily paused."
 */
import { LP_COPY } from "@robbed/shared";
import type { Page } from "@playwright/test";

import { STACK } from "./config";

export const copy = {
  buyPaused: "Buying is temporarily paused — selling remains open.",
  createsPaused: "New launches are temporarily paused.",
  earlyBuyCap: /Early-launch buy cap: max/i,
  graduatingInterstitial: /Graduating to Uniswap V3/i,
  tradingOnV3: /Trading on Uniswap V3/i,
  // TokenHeader status pill post-grad (verified TokenHeader.tsx: "GRADUATED → V3").
  graduatedPill: /GRADUATED\s*→\s*V3/i,
  // §12.56: the visible soft-confirmed chip is REMOVED — used for ABSENCE checks.
  softConfirmed: /Soft-confirmed/i,
  postedToL1: /Posted to L1/i,
  // §12.14 must-render floor: the single shared LP sentence on token detail. The
  // SafetyStrip removal (§12.57, 2026-07-13) relocated it to `TokenInfo`, verbatim
  // via the shared constant — asserted by the re-scoped TD-7. (The removed strip's
  // `rpcUnavailable`/"on-chain read unavailable" selector went with retired ERR-13.)
  lpCopy: LP_COPY,
  // ConfirmationBadge WS-silence note (web.md §4.5): "Awaiting the indexer —
  // retrying." §12.56 CAVEAT — this note is APPENDED to a rendered badge's tooltip,
  // but the soft-confirmed tier now renders NO badge, so a receipt-success-but-
  // unindexed row has NO visible awaiting-index surface. ERR-14 therefore anchors to
  // the surviving surface (the optimistic ROW is KEPT), not this tooltip. Retained
  // for documentation only (no spec hovers it post-§12.56).
  awaitingIndex: /awaiting the indexer/i,
  degradedBanner: /Live updates degraded/i,
} as const;

export const sel = {
  buyTab: (page: Page) => page.getByRole("tab", { name: /^buy$/i }),
  sellTab: (page: Page) => page.getByRole("tab", { name: /^sell$/i }),
  tradeWidget: (page: Page) => page.getByRole("tablist").first(),
  // Amount field is a text input with inputmode=decimal + placeholder "0.0".
  amountInput: (page: Page) => page.getByPlaceholder("0.0").first(),
  maxButton: (page: Page) => page.getByRole("button", { name: /^max$/i }),
  // The trade submit is a <button> "BUY {TICKER}"/"SELL {TICKER}" (mockup copy;
  // distinct from the Buy/Sell role=tab), or "Connect Wallet" pre-connect.
  submitTrade: (page: Page) =>
    page.getByRole("button", { name: /^(buy|sell)\s|^connect wallet$/i }).last(),
  tradeFeed: (page: Page) => page.getByRole("list", { name: /trades?/i }).first(),
  // §12.56: the "Soft-confirmed" chip is gone — an optimistic/indexed trade
  // landing is now proven by the feed ROW appearing (the DataTable `<li>` rows
  // under the `aria-label="Trades"` list), not by the removed badge.
  tradeRows: (page: Page) =>
    page.getByRole("list", { name: /trades?/i }).getByRole("listitem"),
  // §12.59 SERVER-side sort + keyset pager on the token-detail `DataTable`s. A
  // `SortHeader` is a role=button whose accessible name is the column label (the
  // asc/desc glyph is aria-hidden); pick a TRADES-ONLY label (Age/Side/Trader/Price)
  // to avoid the holders table's shared Amount/% headers. Clicking dispatches a
  // `?sort=&dir=` refetch (never a client re-rank); the active header carries
  // `aria-sort`. The `Pagination` is a single `<nav aria-label="Pagination">`
  // (only the trades feed paginates in-suite — holders never exceeds its window).
  sortHeader: (page: Page, label: string) =>
    page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }),
  pager: (page: Page) => page.getByRole("navigation", { name: /pagination/i }),
  pagerNext: (page: Page) =>
    page.getByRole("navigation", { name: /pagination/i }).getByRole("button", { name: /next/i }),
  pagerPrev: (page: Page) =>
    page.getByRole("navigation", { name: /pagination/i }).getByRole("button", { name: /prev/i }),
  // TradeWidget quote rows (InfoRows): `<span>Fee</span><span>1%</span>` etc.
  // Exact "Fee" / "Min received" labels exist ONLY in the widget (the TrustPanel
  // says "curve fee" in prose — a previous /curve fee/i assertion passed via the
  // panel and never checked the widget). `..` = the flex Row wrapper.
  feeRow: (page: Page) => page.getByText("Fee", { exact: true }).locator(".."),
  minReceivedRow: (page: Page) => page.getByText("Min received", { exact: true }).locator(".."),
  // (§12.57, 2026-07-13: the `trustPanel` locator is removed — the token-detail
  // SafetyStrip/Trust panel it anchored on ("Ownerless token") no longer exists.)
  tokenCard: (page: Page) => page.getByRole("link", { name: /\/t\// }),
  searchBox: (page: Page) => page.getByRole("searchbox").first(),
} as const;

/** Launch form fields — the form uses PLACEHOLDERS, not labels (verified DOM).
 * `exact: true` on ticker is LOAD-BEARING: the default substring match makes
 * "MILK" also hit the NAME input ("Moonmilk"), overwriting the name. */
export const launch = {
  name: (page: Page) => page.getByPlaceholder("Moonmilk", { exact: true }).first(),
  ticker: (page: Page) => page.getByPlaceholder("MILK", { exact: true }).first(),
  description: (page: Page) => page.getByPlaceholder(/what is this token about/i).first(),
  initialBuy: (page: Page) => page.getByLabel(/initial buy/i).first(),
  fileInput: (page: Page) => page.locator('input[type="file"]').first(),
  submit: (page: Page) => page.getByRole("button", { name: /launch token/i }).first(),
} as const;

/**
 * Discover / Token-Detail route builders. All are web paths (prefix with
 * `STACK.webUrl`) EXCEPT `og`, which is an ABSOLUTE URL on the API origin:
 * OG rendering relocated web → API (spec §12.53; TD-12 re-point ruled
 * 2026-07-12; record: the user-flows.md TD-12 annotation) — the web route `/t/[address]/opengraph-image`
 * no longer exists. The origin comes from the env-driven harness config
 * (`STACK.apiUrl`, same source as harness/api.ts), never a hardcoded port.
 */
export const routes = {
  discover: "/",
  token: (address: string) => `/t/${address}`,
  create: "/create",
  og: (address: string) => `${STACK.apiUrl}/v1/og/${address.toLowerCase()}.png`,
} as const;

/**
 * Portfolio `/portfolio` (§12.50a) — PORT-* selectors, copy/role-derived from
 * views/portfolio/* + shared atoms (EmptyState/ErrorState/TabBar, verified DOM
 * 2026-07-11). Tabs render role="tab" with the UPPERCASE labels in the DOM.
 */
export const portfolio = {
  route: (address?: string) => (address ? `/portfolio?address=${address}` : "/portfolio"),
  holdingsTab: (page: Page) => page.getByRole("tab", { name: /^holdings$/i }),
  activityTab: (page: Page) => page.getByRole("tab", { name: /^activity$/i }),
  createdTab: (page: Page) => page.getByRole("tab", { name: /^created$/i }),
  loadMore: (page: Page) => page.getByRole("button", { name: /load more|loading…/i }),
  retry: (page: Page) => page.getByRole("button", { name: /^retry$/i }),
  /** AddressChip carries `title={fullAddress}` (subject is lowercased upstream). */
  addressChip: (page: Page, address: string) =>
    page.getByTitle(address.toLowerCase()).first(),
  youSuffix: (page: Page) => page.getByText("· you"),
  /** Activity/token-cell rows link to /t/<address> (portfolio has no other /t/ links). */
  tokenLinks: (page: Page) => page.locator('a[href^="/t/"]'),
  sideBadges: (page: Page) => page.getByText(/^(BUY|SELL)$/),
} as const;

/** Portfolio copy (verified against views/portfolio/* sources, 2026-07-11). */
export const portfolioCopy = {
  connectPrompt: "Connect a wallet",
  noHoldings: "No holdings yet",
  noTrades: "No trades yet",
  noCreated: "No tokens created",
  summaryError: "Couldn't load summary",
  holdingsError: "Couldn't load holdings",
  activityError: "Couldn't load activity",
  createdError: "Couldn't load created tokens",
  statLabels: [/total value/i, /loot all-time/i, /wallet eth/i],
} as const;
