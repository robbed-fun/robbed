import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

/**
 * OpenNext → Cloudflare Workers adapter config (opennext.js.org/cloudflare,
 * verified 2026-07-10; deploy-komodo-cloudflare.md Part B §B.3).
 *
 * R2 incremental cache (user decision, day one): ISR revalidation and the Next
 * `use cache` directive persist their entries in R2. `r2IncrementalCache` reads
 * the `NEXT_INC_CACHE_R2_BUCKET` binding declared in wrangler.jsonc (→ the
 * `robbed-assets` bucket, `incremental-cache/` prefix). The three ROBBED_ pages
 * are live-read heavy (Trust panel reads chain 4663 live, §5.2), so this mainly
 * backs the per-token OG route's `revalidate: 60` and any future `use cache`.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
