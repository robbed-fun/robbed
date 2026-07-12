/**
 * ── indexer DB harness (plan I-5a) ───────────────────────────────────────────
 * A TINY, read/write Postgres seam used by exactly ONE render-safety flow
 * (ERR-12). The frontend's stored-link XSS guarantee (§5 copy rules, threat
 * model UM-5) is defense-in-depth: the API rejects non-`https:` links and the
 * indexer's verifier only stores schema-vetted (https) links, so a malicious
 * `javascript:`/`data:` link can NEVER arrive through any app path. The flow's
 * premise is precisely "IF such a link is in the stored record anyway (a future
 * ingestion path / DB anomaly), the frontend must still not render it as an
 * href." The only honest way to place that payload where the SSR'd page reads it
 * (the token detail is server-rendered — no client fetch to intercept) is a
 * direct write to `metadata_verifications.links`. This is a harness manipulation
 * of dev state — analogous to `anvil_setCode` for the hostile-treasury flow —
 * never a product change.
 *
 * `pg` is not a dependency of @robbed/web; it IS in the monorepo store (an API
 * dep). We resolve it from the store rather than adding a web devDependency (no
 * lockfile churn for a test-only seam). DB creds are env-driven with the
 * docker-compose dev defaults (host-mapped port 4432).
 */
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Resolve `pg` from the pnpm store (version-agnostic — globs `pg@*`). */
function loadPg(): any {
  const storeDir = fileURLToPath(new URL("../../../../node_modules/.pnpm/", import.meta.url));
  const entry = readdirSync(storeDir).find((d) => /^pg@\d/.test(d));
  if (!entry) {
    throw new Error(
      "[e2e db] `pg` not found in node_modules/.pnpm — the indexer/API workspace must be installed.",
    );
  }
  const req = createRequire(`${storeDir}${entry}/node_modules/pg/`);
  return req("pg");
}

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://robbed:robbed_dev_pw@localhost:4432/robbed";

async function withClient<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
  const { Client } = loadPg();
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    return await fn((sql, params) => client.query(sql, params));
  } finally {
    await client.end();
  }
}

/**
 * Force display fields (description/links) onto a token's indexed record — the
 * exact source the token-detail SSR reads via the `metadata_verifications`
 * COALESCE, and the table the indexer's verifier owns. `status='match'` so the
 * API surfaces them exactly as for a verified token. Used to model both a
 * verified-metadata token (TD-11, benign https links) WITHOUT the rate-limited
 * upload/pin round-trip, and a payload that bypassed the upstream https guard
 * (ERR-12, malicious links) — a harness manipulation of dev state, never a
 * product change.
 */
export async function injectMetadataDisplay(
  token: string,
  fields: { description?: string; links?: Record<string, string> },
): Promise<void> {
  await withClient(async (q) => {
    await q(
      `INSERT INTO metadata_verifications
         (token_address, onchain_hash, status, links, description)
       VALUES ($1, $2, 'match', $3::jsonb, $4)
       ON CONFLICT (token_address)
       DO UPDATE SET links = EXCLUDED.links, description = EXCLUDED.description, status = 'match'`,
      [
        token.toLowerCase(),
        "0x00",
        fields.links ? JSON.stringify(fields.links) : null,
        fields.description ?? null,
      ],
    );
  });
}

/** Malicious-links convenience wrapper (ERR-12). */
export async function injectMaliciousLinks(
  token: string,
  links: Record<string, string>,
  description = "e2e stored-link XSS fixture",
): Promise<void> {
  await injectMetadataDisplay(token, { links, description });
}

/** Remove the injected row so the fixture never pollutes later flows. */
export async function clearMetadataVerification(token: string): Promise<void> {
  await withClient(async (q) => {
    await q(`DELETE FROM metadata_verifications WHERE token_address = $1`, [token.toLowerCase()]);
  });
}
