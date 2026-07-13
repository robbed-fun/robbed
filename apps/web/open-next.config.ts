import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
import memoryQueue from "@opennextjs/cloudflare/overrides/queue/memory-queue";

/**
 * OpenNext → Cloudflare Workers adapter config (opennext.js.org/cloudflare,
 * verified 2026-07-10; spec §12.45; docker.md).
 *
 * incrementalCache (R2): ISR revalidation + `use cache` entries persist in R2
 * (r2IncrementalCache reads the NEXT_INC_CACHE_R2_BUCKET binding in
 * wrangler.jsonc → robbed-assets, incremental-cache/ prefix).
 *
 * queue (memory): the ISR/OG revalidation queue. Without it OpenNext falls back
 * to a stub that throws `FatalError: Dummy queue is not implemented` on any
 * revalidate. memory-queue processes revalidations in-isolate — Free-plan safe,
 * zero extra bindings. UPGRADE to do-queue (Durable Object, durable across
 * isolates) for production; that adds a DO binding + migration in wrangler.jsonc.
 */
export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
  queue: memoryQueue,
});
