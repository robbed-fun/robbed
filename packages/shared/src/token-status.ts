/**
 * Token venue/status enum — cycle-free primitive (single source).
 *
 * DERIVED, not stored (indexer.md section 3.2): drives the venue pill / widget
 * engine on the TokenCard and TokenDetail — `curve` (pre-grad) | `graduating`
 * (locked during migration) | `graduated` (Uniswap V3).
 *
 * EXTRACTED here from api-types.ts (D-70, 2026-07-14) so the WS message union
 * (`ws-messages.ts`) can reuse it in the new `token_metrics` payload. `api-types.ts`
 * imports `ws-messages.ts` (scalars), so `ws-messages.ts` cannot import
 * `api-types.ts` back — this leaf module (imports only `zod`) breaks that cycle.
 * `api-types.ts` re-exports `tokenStatusSchema` / `TokenStatus`, so every existing
 * `@robbed/shared` and `./api-types` importer is unchanged.
 */
import { z } from "zod";

export const tokenStatusSchema = z.enum(["curve", "graduating", "graduated"]);
export type TokenStatus = z.infer<typeof tokenStatusSchema>;
