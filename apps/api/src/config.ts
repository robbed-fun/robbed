/**
 * Config loader (api.md deployment shape). Everything env-driven — no
 * hardcoded ports, no market metrics, no inline secrets.
 *
 * Two Postgres roles (api.md) `DATABASE_URL_RO` is read-only on
 * indexer-owned tables; `DATABASE_URL_RW` is read-write on the API-owned
 * `moderation_status` / audit / `impersonation_watchlist` tables only. Both
 * fall back to `DATABASE_URL` in local/dev where one role is used.
 */
import { parseEther } from "viem";
import { z } from "zod";

const rawSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Postgres — role split.
  DATABASE_URL: z.string().optional(),
  DATABASE_URL_RO: z.string().optional(),
  DATABASE_URL_RW: z.string().optional(),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Object storage (R2 in prod, minio in dev/CI). Bun.S3Client speaks S3 to both.
  R2_ENDPOINT: z.string().optional(), // required for R2/minio (non-AWS)
  R2_REGION: z.string().default("auto"),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("robbed-assets"),
  /** Public CDN origin for objects; `imageUrl` in metadata MUST start with this (SSRF/XSS). */
  R2_PUBLIC_BASE_URL: z.string().default("http://localhost:9000/robbed"),

  /** RPC for the cold `tokensOwed` read on /fees (api.md). Never in the hot path. */
  ROBINHOOD_RPC_URL: z.string().optional(),

  // ── Auth / abuse ──────────────────────────────────────────────────────────
  /** HMAC key for stateless admin session + CSRF signing. */
  SESSION_SECRET: z.string().default("dev-insecure-session-secret-change-me"),
  /** Comma-separated admin address allowlist (OI-A8 open — dev allowlist). */
  ADMIN_ALLOWLIST: z.string().default(""),
  /**
   * Trusted-proxy header carrying the real client IP behind the CDN. Decide-it-
   * yourself (api.md) trust a CONFIGURED header (`CF-Connecting-IP`), else the
   * rightmost `X-Forwarded-For` hop — NEVER the client-settable leftmost XFF, the
   * classic rate-limit bypass. Empty ⇒ dev, use the socket peer address.
   */
  TRUSTED_PROXY_HEADER: z.string().default(""),

  /**
   * Comma-separated browser origins allowed on the PUBLIC /v1 surface (api.md
   * CORS; env-inventory — this key is now READ, closing the 2026-07-11
   * audit gap). Production refuses to boot when unset (mirrors the DB-role
   * guard); dev/test default to the local web origins. Admin/internal routes
   * are never opened cross-origin regardless of this list (api.md).
   */
  CORS_ALLOWED_ORIGINS: z.string().optional(),

  // ── Moderation ───────────────────────────────────────────────────────
  /**
   * Production refuses to boot on stub vendors unless this is true (boot
   * guard). Explicit string→boolean (`z.coerce.boolean()` maps "false" → true).
   */
  MODERATION_ALLOW_STUBS: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  MODERATION_NSFW_HIDE_THRESHOLD: z.coerce.number().default(0.95),
  MODERATION_NSFW_REVIEW_THRESHOLD: z.coerce.number().default(0.8),

  // NOTE: the Trust-panel/card trade fee is NO LONGER config-sourced. It now
  // reads the per-token `tokens.trade_fee_bps` snapshot the indexer
  // writes from each curve's immutable `TRADE_FEE_BPS`, so an older curve reports
  // its own fee rather than the factory's current one. The former `TRADE_FEE_BPS`
  // env var is removed to eliminate that misreport path (factory-current value misreports older curves).

  /** Optional vault/treasury addresses → holder `vault` flag (api.md). */
  TREASURY_ADDRESS: z.string().optional(),
  LP_FEE_VAULT_ADDRESS: z.string().optional(),
  /**
   * Chain WETH — the ONLY use is to classify a post-grad creator-fee
   * claim leg: `token == WETH_ADDRESS` ⇒ the buy-leg WETH share is ETH-priced, so USD
   * is derived; a launch-token leg is an unpriceable ERC20 ⇒ `claimableUsd: null`.
   * OPTIONAL/additive: unset ⇒ USD is null for every leg (fail-safe — never invents a
   * price). Config-sourced (deployment-injected), never a code literal. Lowercased.
   */
  WETH_ADDRESS: z.string().optional(),
  /**
   * Phase-2 CreatorVault — the pull-payment vault the live
   * `balanceOf(creator)` claimable read targets, and the fallback `vault` for a
   * creator with no `creator_claimable` row yet. OPTIONAL/additive: absent on v1
   * deployments (no vault). When unset AND the creator has no row, the claimable
   * endpoint 404s (no vault to read). Lowercased into `creatorVaultAddress`.
   */
  CREATOR_VAULT_ADDRESS: z.string().optional(),

  /**
   * Large-value confirmation-disclosure threshold (, decided /
   * web-10): ETH notional (decimal string, e.g. "1.0") at/above which trade
   * DTOs and clients surface the stronger posted-to-L1 / finalized disclosure.
   * Mirrors web `NEXT_PUBLIC_LARGE_VALUE_ETH_THRESHOLD` — same semantics, same
   * default. Config, never a code literal in consumers; retunable in the
   * capped beta.
   */
  LARGE_VALUE_ETH_THRESHOLD: z.string().default("1.0"),
});

export type RawConfig = z.infer<typeof rawSchema>;

export interface Config extends RawConfig {
  databaseUrlRo: string;
  databaseUrlRw: string;
  adminAllowlist: Set<string>; // lowercased addresses
  /** threshold parsed to wei; falls back to the 1.0 ETH default on a malformed value. */
  largeValueEthThresholdWei: bigint;
  /** Lowercased browser origins for the public-/v1 CORS middleware (api.md). */
  corsAllowedOrigins: Set<string>;
  /** CreatorVault address (lowercased) or undefined on v1 deployments. */
  creatorVaultAddress: string | undefined;
  /** chain WETH (lowercased) for classifying a claim's WETH leg; undefined ⇒ USD null. */
  wethAddress: string | undefined;
}

/** Dev/test fallback: the compose web port (4000) + bare `next dev` (3000). */
const DEV_CORS_DEFAULT = "http://localhost:4000,http://localhost:3000";

let cached: Config | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = rawSchema.parse(env);
  const ro = raw.DATABASE_URL_RO ?? raw.DATABASE_URL;
  const rw = raw.DATABASE_URL_RW ?? raw.DATABASE_URL;
  if (!ro || !rw) {
    // In test we allow missing DB (fakes injected); guard only at real boot.
    if (raw.API_ENV === "production") {
      throw new Error(
        "DATABASE_URL(_RO/_RW) required in production (api.md role split)",
      );
    }
  }
  const corsRaw = raw.CORS_ALLOWED_ORIGINS?.trim();
  if (!corsRaw && raw.API_ENV === "production") {
    // Fail-loud (api.md) a prod API without an explicit origin list would
    // either silently block every browser fetch or tempt a `*` hack. Never default.
    throw new Error("CORS_ALLOWED_ORIGINS required in production (api.md; env-inventory)");
  }
  const corsAllowedOrigins = new Set(
    (corsRaw || DEV_CORS_DEFAULT)
      .split(",")
      .map((o) => o.trim().toLowerCase().replace(/\/+$/, "")) // origins have no trailing slash
      .filter((o) => o.length > 0),
  );
  let largeValueEthThresholdWei: bigint;
  try {
    largeValueEthThresholdWei = parseEther(raw.LARGE_VALUE_ETH_THRESHOLD);
    if (largeValueEthThresholdWei <= 0n) throw new Error("non-positive");
  } catch {
    // Malformed config value ⇒ fall back to the default rather than
    // silently disabling the disclosure (fail-safe, same as web).
    largeValueEthThresholdWei = parseEther("1.0");
  }
  return {
    ...raw,
    databaseUrlRo: ro ?? "",
    databaseUrlRw: rw ?? "",
    adminAllowlist: new Set(
      raw.ADMIN_ALLOWLIST.split(",")
        .map((a) => a.trim().toLowerCase())
        .filter((a) => a.length > 0),
    ),
    largeValueEthThresholdWei,
    corsAllowedOrigins,
    creatorVaultAddress: raw.CREATOR_VAULT_ADDRESS?.trim().toLowerCase() || undefined,
    wethAddress: raw.WETH_ADDRESS?.trim().toLowerCase() || undefined,
  };
}

export function getConfig(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test hook — inject a config and reset the singleton. */
export function setConfigForTest(cfg: Config | null): void {
  cached = cfg;
}
