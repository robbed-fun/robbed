/**
 * Dependency container. Routes receive an `AppDeps` and never reach for globals,
 * so unit/integration tests inject fakes (fake Db/Redis/Storage/vendors) and the
 * real boot wires Bun-native clients. This is the single place I/O adapters are
 * constructed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config";
import { getConfig } from "./config";
import { type RankingConfig, loadRankingConfig } from "./config/ranking";
import type { Db } from "./lib/db";
import type { Redis } from "./lib/redis";
import { createBunRedis } from "./lib/redis";
import type { RateLimitStore } from "./mw/ratelimit";
import { InMemoryRateLimitStore } from "./mw/ratelimit";
import type { Reencoder } from "./media/reencode";
import { createSharpReencoder } from "./media/reencode";
import type { Storage } from "./media/storage";
import { createBunStorage } from "./media/storage";
import type { WalletBalanceReader } from "./lib/wallet-balance";
import { createRpcWalletBalance, zeroWalletBalance } from "./lib/wallet-balance";
import type { ModerationVendors } from "./moderation/vendors";
import { stubVendors } from "./moderation/vendors";
import {
  type ImpersonationWatchlist,
  impersonationWatchlistSchema,
} from "./moderation/impersonation";

/** Cold uncollected-fee read (api.md §3.4) — injectable so /fees is testable. */
export interface UncollectedFeesReader {
  read(input: {
    token: string;
    pool: string;
    lpTokenId: string;
  }): Promise<{ token: string; weth: string }>;
}

export interface AppDeps {
  config: Config;
  ranking: RankingConfig;
  db: Db;
  redis: Redis;
  storage: Storage;
  reencoder: Reencoder;
  vendors: ModerationVendors;
  rateLimit: RateLimitStore;
  watchlist: ImpersonationWatchlist;
  uncollectedFees: UncollectedFeesReader;
  /** Live native-ETH balance reader (portfolio summary; RPC, never hot path). */
  walletBalance: WalletBalanceReader;
  now: () => number;
  /** Set `false` in dev so cookies work over http (Secure flag). */
  secureCookies: boolean;
}

export function loadWatchlist(
  dir = join(import.meta.dir, "..", "data"),
): ImpersonationWatchlist {
  const raw = readFileSync(join(dir, "impersonation-watchlist.json"), "utf8");
  return impersonationWatchlistSchema.parse(JSON.parse(raw));
}

/**
 * Stub uncollected-fees reader — returns zero. The real reader does a cached
 * (60s) `NonfungiblePositionManager.tokensOwed` RPC read (api.md §3.4); wiring
 * it needs `ROBINHOOD_RPC_URL` + the NPM address (shared `UNISWAP_V3`). Kept
 * behind the interface so it never enters the WS/publish hot path (row-9 rule).
 */
export const zeroUncollectedFees: UncollectedFeesReader = {
  async read() {
    return { token: "0", weth: "0" };
  },
};

/** Construct the real dependency graph (Bun-native adapters) for boot. */
export function buildDeps(dbFactory: (cfg: Config) => Db): AppDeps {
  const config = getConfig();
  return {
    config,
    ranking: loadRankingConfig(),
    db: dbFactory(config),
    redis: createBunRedis(config.REDIS_URL),
    storage: createBunStorage({
      endpoint: config.R2_ENDPOINT,
      region: config.R2_REGION,
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
      bucket: config.R2_BUCKET,
      publicBaseUrl: config.R2_PUBLIC_BASE_URL,
    }),
    reencoder: createSharpReencoder(),
    vendors: stubVendors(), // real vendors OPEN §13 OI-A7; boot guard enforces prod
    rateLimit: new InMemoryRateLimitStore(),
    watchlist: loadWatchlist(),
    uncollectedFees: zeroUncollectedFees,
    // Real RPC reader when the chain RPC is configured; else the "0" stub (dev).
    walletBalance: config.ROBINHOOD_RPC_URL
      ? createRpcWalletBalance(config.ROBINHOOD_RPC_URL)
      : zeroWalletBalance,
    now: () => Date.now(),
    secureCookies: config.API_ENV === "production",
  };
}
