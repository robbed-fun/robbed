/**
 * Keeper env config (zod, fail-closed). Secrets (KEEPER_PRIVATE_KEY) NEVER get
 * logged — index.ts logs only the derived wallet ADDRESS.
 *
 * DATABASE_URL vs API_BASE_URL: v1 implements the direct-Postgres fallback sweep
 * (db.pg.ts) — the ReadyToGraduate hint set is a single indexed query with no
 * matching REST endpoint today, so DATABASE_URL is required. API_BASE_URL is
 * accepted+reserved for a future HTTP DbPort (flag to architect if that path is
 * wanted — it needs a `GET /v1/tokens?status=ready-to-graduate` on the API).
 */
import { z } from "zod";

const hex32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex private key");
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");
const boolish = z.preprocess((value) => {
  if (value === undefined) return value;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return value;
}, z.boolean());

const schema = z
  .object({
    KEEPER_RPC_URL: z.string().url("KEEPER_RPC_URL must be a ws(s):// or http(s):// URL"),
    KEEPER_PRIVATE_KEY: hex32,
    CHAIN_ID: z.coerce.number().int().positive(),
    DATABASE_URL: z.string().min(1),
    KEEPER_POLL_MS: z.coerce.number().int().positive().default(15_000),
    REDIS_URL: z.string().optional(), // reserved — detection is on-chain (see chain.ts)
    API_BASE_URL: z.string().url().optional(), // reserved — see header
    // Gas ceiling: estimate*2 capped here (gas.ts). 30M block-safe default.
    KEEPER_GAS_CAP: z.coerce.bigint().positive().default(30_000_000n),
    KEEPER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    KEEPER_BACKOFF_BASE_MS: z.coerce.number().int().positive().default(500),
    KEEPER_FAILED_COOLDOWN_MS: z.coerce.number().int().positive().default(300_000),
    // Permissionless treasury fee sweep: BondingCurve.accruedFees() → sweepFees().
    KEEPER_TREASURY_SWEEP_ENABLED: boolish.default(true),
    KEEPER_TREASURY_SWEEP_POLL_MS: z.coerce.number().int().positive().default(60_000),
    KEEPER_TREASURY_SWEEP_MIN_WEI: z.coerce.bigint().positive().default(500_000_000_000_000_000n),
    KEEPER_TREASURY_SWEEP_MAX_AGE_MS: z.coerce.number().int().positive().default(86_400_000),
    // Permissionless post-graduation LP fee collection: LPFeeVault.collect(tokenId).
    KEEPER_LP_FEE_COLLECT_ENABLED: boolish.default(true),
    KEEPER_LP_FEE_VAULT_ADDRESS: address.optional(),
    KEEPER_LP_FEE_COLLECT_POLL_MS: z.coerce.number().int().positive().default(60_000),
    KEEPER_LP_FEE_COLLECT_MIN_WETH_WEI: z.coerce
      .bigint()
      .positive()
      .default(500_000_000_000_000_000n),
    KEEPER_LP_FEE_COLLECT_MAX_AGE_MS: z.coerce.number().int().positive().default(86_400_000),
    // Balance watch: warn when balance < MULTIPLE × (typicalGraduateGas × gasPrice).
    KEEPER_BALANCE_POLL_MS: z.coerce.number().int().positive().default(60_000),
    KEEPER_BALANCE_WARN_MULTIPLE: z.coerce.number().int().positive().default(20),
    // fork-measured worst case ≈817,845; MIGRATION_GAS_ESTIMATE=1.5M is the
    // documented headroom figure used for the balance threshold (NOT the tx gas —
    // that is estimated live per-curve; this only sizes the low-balance alert).
    KEEPER_TYPICAL_GRADUATE_GAS: z.coerce.bigint().positive().default(1_500_000n),
    KEEPER_PORT: z.coerce.number().int().positive().default(3003),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.KEEPER_LP_FEE_COLLECT_ENABLED && !cfg.KEEPER_LP_FEE_VAULT_ADDRESS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["KEEPER_LP_FEE_VAULT_ADDRESS"],
        message:
          "required when KEEPER_LP_FEE_COLLECT_ENABLED=true; set it or provide LP_FEE_VAULT_ADDRESS from the deploy artifact",
      });
    }
  });

export type KeeperEnv = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): KeeperEnv {
  const parsed = schema.safeParse({
    ...env,
    // Compose/source artifacts expose LP_FEE_VAULT_ADDRESS; allow a keeper-prefixed
    // override without forcing operators to duplicate the same deployment address.
    KEEPER_LP_FEE_VAULT_ADDRESS: env.KEEPER_LP_FEE_VAULT_ADDRESS ?? env.LP_FEE_VAULT_ADDRESS,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[keeper] invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

/** True for ws:// or wss:// — selects the eth_subscribe (push) detection path. */
export function isWebSocketUrl(url: string): boolean {
  return /^wss?:\/\//i.test(url);
}
