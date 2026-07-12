/**
 * Pure builder for the `moderation_status` upsert SQL + params — extracted from
 * `db.bun.ts` so it is unit-testable WITHOUT a live Postgres.
 *
 * Bug it guards (42701, 2026-07-12): the moderation worker legitimately passes
 * `updated_at` inside the patch (`ModerationStatusRow` field), but `updated_at`
 * is also handled SPECIALLY here (coalesce($) on insert, now() on conflict).
 * The prior builder appended it to the dynamic column list AND emitted a literal
 * `, updated_at`, so Postgres rejected "column updated_at specified more than
 * once" — every launch crashed the worker, so `moderation_status` was never
 * written and cards could stay non-visible. `updated_at` is excluded from the
 * dynamic columns here; the FakeDb-based worker tests couldn't see this because
 * they never build SQL, so `moderationUpsert.test.ts` asserts the generated
 * text directly.
 */
import type { ModerationStatusRow } from "@robbed/shared";

export type ModerationPatch = Partial<Omit<ModerationStatusRow, "token_address">>;

export interface BuiltQuery {
  text: string;
  params: unknown[];
}

export function buildModerationUpsert(token: string, patch: ModerationPatch): BuiltQuery {
  // `updated_at` is NEVER a dynamic column — it is set via coalesce/now() below.
  const cols = Object.keys(patch).filter((c) => c !== "updated_at");
  const vals = cols.map((c) => (patch as Record<string, unknown>)[c]);
  const insertCols = ["token_address", ...cols];
  const placeholders = insertCols.map((_, i) => `$${i + 1}`);
  // ON CONFLICT set list: the dynamic columns + always-`updated_at = now()`.
  // Joining with updated_at last keeps a valid list even when `cols` is empty.
  const setClause = [...cols.map((c, i) => `${c} = $${i + 2}`), "updated_at = now()"].join(", ");
  const updatedAtParam = insertCols.length + 1;
  const text = `INSERT INTO moderation_status (${insertCols.join(", ")}, updated_at)
    VALUES (${placeholders.join(", ")}, coalesce($${updatedAtParam}, now()))
    ON CONFLICT (token_address) DO UPDATE SET ${setClause}
    RETURNING *`;
  return { text, params: [token, ...vals, patch.updated_at ?? null] };
}
