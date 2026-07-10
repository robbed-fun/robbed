/**
 * DEMO-MODE data resolver (task A). Serves `robbed-mock.json` for every REST
 * read the four pages issue, mapped to the FROZEN `@robbed/shared` DTO shapes so
 * the callers/zod schemas are byte-identical to the production path. Wired at the
 * transport layer (`shared/api` + `entities/portfolio/api`) — never by faking a
 * component — and STRICTLY gated by `env.mockData()`: with the flag off this
 * module is never touched and the real `fetch` path runs unchanged.
 *
 * PROTOCOL DISCIPLINE: the demo figures (mcap/price/ethUsdMock, etc.) are the
 * mockup's illustrative numbers, quarantined behind the flag — they never reach
 * the prod build, so §2's "no hardcoded market metrics" holds on the real path.
 * Every address below is sourced FROM the fixture (never an inline literal), so
 * the §9 address-literal lint stays green.
 */
import type {
  Candle,
  HolderRow,
  PortfolioHolding,
  PortfolioSummary,
  TokenCard,
  TokenDetail,
  TradeRow,
} from "@robbed/shared";

import mock from "./robbed-mock.json";

const trending = mock.discover.trending as unknown as TokenCard[];
const allTokens = mock.discover.tokens as unknown as TokenCard[];
const detail = mock.tokenDetail.detail as unknown as TokenDetail;
const candles = mock.tokenDetail.candles as unknown as Candle[];
const trades = mock.tokenDetail.trades as unknown as TradeRow[];
const portfolioSummary = mock.portfolio.summary as unknown as PortfolioSummary;
const portfolioHoldings = mock.portfolio.holdings as unknown as PortfolioHolding[];

/** The demo Token Detail subject (HOODCAT) — sourced from the fixture, not inline. */
const HOODCAT = detail.address.toLowerCase();

function findCard(address: string): TokenCard | undefined {
  const lower = address.toLowerCase();
  return allTokens.find((t) => t.address.toLowerCase() === lower);
}

/**
 * TokenDetail for any `/t/[address]` in the demo. Only HOODCAT has a full hand-
 * authored detail (the mockup subject); every other card resolves to that same
 * rich structure with its own identity merged in, so no route 404s in the demo.
 */
function detailFor(address: string): TokenDetail {
  const lower = address.toLowerCase();
  if (lower === HOODCAT) return detail;
  const card = findCard(address);
  if (!card) return detail;
  return {
    ...detail,
    address: card.address,
    name: card.name,
    ticker: card.ticker,
    imageUrl: card.imageUrl,
    createdAt: card.createdAt,
    priceEth: card.priceEth,
    mcap: card.mcap,
    mcapEth: card.mcapEth,
    progressPct: card.progressPct,
    change24hPct: card.change24hPct,
    volume24h: card.volume24h,
    graduated: card.graduated,
    status: card.status,
    confirmationState: card.confirmationState,
    moderation: card.moderation,
    creator: { address: card.creator, tokensCreated: 1 },
    graduation: { ...detail.graduation, progressPct: card.progressPct },
  };
}

/**
 * Synthetic top-holders for the demo (the mockup token-detail has no holder
 * table; the live app does). Clearly-demo, gated rows derived from the curve /
 * creator / supply so the panel renders complete instead of "no holders yet".
 */
function holdersFor(address: string): { holders: HolderRow[]; holderCount: number } {
  const d = detailFor(address);
  // Plain-holder addresses are taken from the fixture's trade `trader`s (no inline
  // literals — keeps the §9 address-literal lint green).
  const traders = trades.map((t) => t.trader);
  const rows: HolderRow[] = [
    { address: d.curveAddress, balance: d.supply.curveHeld, pct: 62, flags: ["curve"] },
    { address: d.creator.address, balance: "48000000000000000000000000", pct: 4.8, flags: ["creator"] },
    { address: traders[0]!, balance: "22000000000000000000000000", pct: 2.2, flags: [] },
    { address: traders[1]!, balance: "15000000000000000000000000", pct: 1.5, flags: [] },
    { address: traders[2]!, balance: "9000000000000000000000000", pct: 0.9, flags: [] },
  ];
  return { holders: rows, holderCount: 1204 };
}

/**
 * King of the Hill = the pre-graduation token closest to the threshold. Computed
 * from the demo cards (highest `progressPct` among non-graduated) — never a
 * hardcoded pick.
 */
function kingOfTheHill(): { token: TokenCard | null } {
  const preGrad = allTokens.filter((t) => !t.graduated);
  const top = preGrad.reduce<TokenCard | null>(
    (best, t) => (best == null || t.progressPct > best.progressPct ? t : best),
    null,
  );
  return { token: top };
}

function confirmations() {
  // Derived from the demo trade block heights so the tiers line up with the
  // trades' soft/posted/finalized states.
  return {
    latestBlock: 8400000,
    safeBlock: 8399988,
    finalizedBlock: 8399976,
    updatedAt: mock._mock.generatedAt,
  };
}

function ethUsd() {
  return {
    price: mock._mock.ethUsdMock,
    source: "mock:demo",
    asOf: mock._mock.generatedAt,
  };
}

/**
 * Resolve a REST path (with query string) to its demo payload, mapped to the
 * exact shape the matching `@robbed/shared` schema expects. Returns `unknown`;
 * the caller re-parses with the frozen schema, so a shape drift fails loud.
 */
export function resolveMock(path: string): unknown {
  const [rawPath = "", rawQuery] = path.split("?");
  const query = new URLSearchParams(rawQuery ?? "");
  const segments = rawPath.split("/").filter(Boolean); // ["v1","tokens", ...]

  // ── /v1/tokens family ─────────────────────────────────────────────────────
  if (segments[0] === "v1" && segments[1] === "tokens") {
    // /v1/tokens/king-of-the-hill
    if (segments[2] === "king-of-the-hill") return kingOfTheHill();

    // /v1/tokens  (list)
    if (segments.length === 2) {
      const sort = query.get("sort");
      const list = sort === "volume24h" ? trending : allTokens;
      return { tokens: list, nextCursor: null };
    }

    const address = segments[2]!;
    const leaf = segments[3];
    // /v1/tokens/:address
    if (!leaf) return detailFor(address);
    // /v1/tokens/:address/trades
    if (leaf === "trades") {
      return {
        trades: address.toLowerCase() === HOODCAT ? trades : [],
        nextCursor: null,
      };
    }
    // /v1/tokens/:address/candles
    if (leaf === "candles") {
      return { candles: address.toLowerCase() === HOODCAT ? candles : [] };
    }
    // /v1/tokens/:address/holders
    if (leaf === "holders") return holdersFor(address);
  }

  // ── /v1/trades/:txHash ────────────────────────────────────────────────────
  if (segments[0] === "v1" && segments[1] === "trades") {
    const tx = segments[2]?.toLowerCase();
    return { trades: trades.filter((t) => t.txHash.toLowerCase() === tx) };
  }

  // ── /v1/search ────────────────────────────────────────────────────────────
  if (segments[0] === "v1" && segments[1] === "search") {
    const q = (query.get("q") ?? "").toLowerCase().trim();
    const results = q
      ? allTokens.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.ticker.toLowerCase().includes(q) ||
            t.address.toLowerCase().includes(q) ||
            t.creator.toLowerCase().includes(q),
        )
      : [];
    return { results };
  }

  // ── /v1/confirmations, /v1/eth-usd ────────────────────────────────────────
  if (segments[0] === "v1" && segments[1] === "confirmations") return confirmations();
  if (segments[0] === "v1" && segments[1] === "eth-usd") return ethUsd();

  // ── /v1/portfolio family ──────────────────────────────────────────────────
  if (segments[0] === "v1" && segments[1] === "portfolio") {
    const leaf = segments[3];
    if (!leaf) return portfolioSummary;
    if (leaf === "holdings") return { holdings: portfolioHoldings, nextCursor: null };
    if (leaf === "activity") return { activity: trades, nextCursor: null };
    if (leaf === "created") {
      // summary.tokensCreated = 2 → surface two demo cards as this address's launches.
      return { tokens: allTokens.slice(4, 6), nextCursor: null };
    }
  }

  throw new Error(`[robbed/web mock] No demo payload mapped for path: ${path}`);
}

/** DEMO-ONLY event-tape fixture (mixed BUY/LAUNCH/SELL/GRADUATE rows). */
export const MOCK_EVENT_TAPE = mock.discover.eventTape;

/** Address the demo Portfolio defaults to when no wallet is connected. */
export const MOCK_PORTFOLIO_ADDRESS = portfolioSummary.address;

/** The demo Token Detail subject (HOODCAT) — used by tests + Portfolio links. */
export const MOCK_HOODCAT_ADDRESS = HOODCAT;
