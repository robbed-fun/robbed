/**
 * `buildModerationUpsert` — regression guard for the 42701
 * "column updated_at specified more than once" crash (2026-07-12) that killed
 * the moderation worker on every launch. The FakeDb worker tests never build
 * SQL, so this asserts the generated text/params directly.
 */
import { describe, expect, it } from "bun:test";
import { buildModerationUpsert, type ModerationPatch } from "../src/lib/moderationUpsert";

const TOKEN = "0xabc0000000000000000000000000000000000001";

/** The exact patch the worker sends (processLaunch line 52) — includes updated_at. */
function workerPatch(): ModerationPatch {
  return {
    visibility: "visible",
    nsfw_score: null,
    csam_flag: false,
    impersonation_flag: false,
    impersonation_ticker: null,
    reason: null,
    reviewed_by: null,
    updated_at: new Date(1_700_000_000_000).toISOString(),
  };
}

/** Count how many times a bare column name appears in the INSERT column list. */
function insertColCount(text: string, col: string): number {
  const cols = text.slice(text.indexOf("(") + 1, text.indexOf(")")).split(",").map((c) => c.trim());
  return cols.filter((c) => c === col).length;
}

describe("buildModerationUpsert — no duplicate updated_at (42701 guard)", () => {
  it("lists updated_at EXACTLY once in the INSERT columns even when patch carries it", () => {
    const { text } = buildModerationUpsert(TOKEN, workerPatch());
    expect(insertColCount(text, "updated_at")).toBe(1);
  });

  it("param count equals placeholder count (well-formed statement)", () => {
    const { text, params } = buildModerationUpsert(TOKEN, workerPatch());
    const maxPlaceholder = Math.max(
      ...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
    );
    expect(maxPlaceholder).toBe(params.length);
  });

  it("the ON CONFLICT set list ends with updated_at = now() and is comma-clean", () => {
    const { text } = buildModerationUpsert(TOKEN, workerPatch());
    const setPart = text.slice(text.indexOf("DO UPDATE SET"));
    expect(setPart).toContain("updated_at = now()");
    expect(setPart).not.toMatch(/SET\s*,/); // no leading comma
    expect(setPart).not.toMatch(/,\s*,/); // no doubled comma
  });

  it("token is param 1 and updated_at value is the LAST param (coalesce source)", () => {
    const patch = workerPatch();
    const { params } = buildModerationUpsert(TOKEN, patch);
    expect(params[0]).toBe(TOKEN);
    expect(params[params.length - 1]).toBe(patch.updated_at);
  });

  it("a patch WITHOUT updated_at still builds one updated_at column, null coalesce param", () => {
    const { text, params } = buildModerationUpsert(TOKEN, { visibility: "hidden" });
    expect(insertColCount(text, "updated_at")).toBe(1);
    expect(params[params.length - 1]).toBeNull();
  });

  it("a patch of ONLY updated_at yields a valid set list (no leading comma)", () => {
    const { text } = buildModerationUpsert(TOKEN, { updated_at: "2026-07-12T00:00:00.000Z" });
    expect(insertColCount(text, "updated_at")).toBe(1);
    expect(text.slice(text.indexOf("DO UPDATE SET"))).not.toMatch(/SET\s*,/);
  });
});
