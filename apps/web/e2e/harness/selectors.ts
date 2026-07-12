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
 *   entities/trade/ui/ConfirmationBadge.tsx — "Soft-confirmed" / "Posted to L1"
 *   trust-panel/ui/TrustPanel.tsx    — "Ownerless token"; "read from chain";
 *     "1,000,000,000 fixed"; "on-chain read unavailable"
 *   features/launch-token/ui/LaunchForm.tsx — "New launches are temporarily paused."
 */
import type { Page } from "@playwright/test";

import { STACK } from "./config";

export const copy = {
  buyPaused: "Buying is temporarily paused — selling remains open.",
  createsPaused: "New launches are temporarily paused.",
  earlyBuyCap: /Early-launch buy cap: max/i,
  graduatingInterstitial: /Graduating to Uniswap V3/i,
  tradingOnV3: /Trading on Uniswap V3/i,
  softConfirmed: /Soft-confirmed/i,
  postedToL1: /Posted to L1/i,
  rpcUnavailable: /on-chain read unavailable/i,
  ownerless: /Ownerless token/i,
  readFromChain: /read from chain/i,
  fixedSupply: /1,000,000,000 fixed/i,
  metadataMismatch: /MISMATCH/i,
  awaitingIndex: /awaiting index/i,
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
  trustPanel: (page: Page) => page.getByText(copy.ownerless).locator("xpath=ancestor::*[3]"),
  tokenCard: (page: Page) => page.getByRole("link", { name: /\/t\// }),
  searchBox: (page: Page) => page.getByRole("searchbox").first(),
} as const;

/** Launch form fields — the form uses PLACEHOLDERS, not labels (verified DOM). */
export const launch = {
  name: (page: Page) => page.getByPlaceholder("Moonmilk").first(),
  ticker: (page: Page) => page.getByPlaceholder("MILK").first(),
  description: (page: Page) => page.getByPlaceholder(/what is this token about/i).first(),
  initialBuy: (page: Page) => page.getByLabel(/initial buy/i).first(),
  fileInput: (page: Page) => page.locator('input[type="file"]').first(),
  submit: (page: Page) => page.getByRole("button", { name: /launch token/i }).first(),
} as const;

/**
 * Discover / Token-Detail route builders. All are web paths (prefix with
 * `STACK.webUrl`) EXCEPT `og`, which is an ABSOLUTE URL on the API origin:
 * OG rendering relocated web → API (spec §12.53; TD-12 re-point ruled
 * 2026-07-12, decisions.md §15) — the web route `/t/[address]/opengraph-image`
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
