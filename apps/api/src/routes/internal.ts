/**
 * Internal dashboard endpoints (D-4 — decisions.md §15; api.md §3.7; M2-13 /
 * M2-14; Gate G-A.1/G-A.2). Thin, READ-ONLY, admin-SIWE-gated (the same
 * `requireAdmin` session as /v1/admin/* — chosen over internal-network gating
 * per D-4 "least new surface": the session mechanism already exists, network
 * topology is deployment-owned). GET-only → no CSRF (CSRF guards mutations).
 *
 * ADVISORY ONLY, binding (§8.4/§8.5): everything served here is labeling /
 * telemetry. It never gates chain state, listing, or any user path — there is
 * no write, no chain primitive, nothing downstream keys off it except the
 * internal ops dashboard and Gate G-A evidence.
 *
 * DTO disposition (api.md §3.7): both composite response shapes are built
 * entirely from shared primitives (`organicFlowSchema` via buildOrganic,
 * `BotFlag`, `CompetitorSnapshotRow`) and typed API-locally — single consumer,
 * §12.40c precedent — pending robbed-shared's ratify-or-bless call (flagged in
 * the W3 report). Nothing shared is redeclared.
 */
import { Hono } from "hono";
import {
  addressSchema,
  botFlagSchema,
  type BotFlag,
  type CompetitorSnapshotRow,
  type OrganicFlow,
} from "@robbed/shared";
import { z } from "zod";
import { type AdminVars, requireAdmin } from "../admin/middleware";
import type { AppDeps } from "../deps";
import { ok } from "../lib/envelope";
import { errors } from "../lib/errors";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";
import { parse, parseQuery } from "../lib/validate";
import { buildOrganic } from "../projections/trust";

// Route-local query/param zod only (existing convention; api.md §3.7).
const flowParamSchema = z.object({ address: addressSchema });
const snapshotsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional(),
});

/** api.md §3.7 — API-local composite (single consumer; §12.40c precedent). */
interface InternalFlowResponse {
  token: string;
  /** Shared organicFlowSchema object — SAME projection as the Trust panel. */
  organic: OrganicFlow | null;
  flagged: {
    holders: number;
    clusters: number;
    /** Full shared BotFlag record, zero-filled (openapi requires all five). */
    byFlag: Record<BotFlag, number>;
  };
}

export function internalRoutes(deps: AppDeps) {
  const app = new Hono<{ Variables: AdminVars }>();
  const auth = requireAdmin(deps);

  // ── M2-13: per-token flow quality (Gate G-A.1) ────────────────────────────
  app.get("/internal/flow/:address", auth, async (c) => {
    const { address } = parse(flowParamSchema, {
      address: c.req.param("address").toLowerCase(),
    });
    if (!(await deps.db.tokenExists(address))) throw errors.notFound("unknown token");
    const [flow, summary] = await Promise.all([
      deps.db.getTokenFlowStats(address),
      deps.db.getTokenFlagSummary(address),
    ]);
    const byFlag = Object.fromEntries(
      botFlagSchema.options.map((f) => [f, summary.byFlag[f] ?? 0]),
    ) as Record<BotFlag, number>;
    const body: InternalFlowResponse = {
      token: address,
      // null until the §8.5 job computes token_flow_stats — never fabricated.
      organic: buildOrganic(flow),
      flagged: {
        holders: summary.flaggedHolders,
        clusters: summary.clusterCount,
        byFlag,
      },
    };
    return ok(c, body);
  });

  // ── M2-14: competitor snapshots, paged newest-first (Gate G-A.2) ──────────
  app.get("/internal/competitor-snapshots", auth, async (c) => {
    const q = parseQuery(snapshotsQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const limit = clampLimit(q.limit);
    const rows = await deps.db.listCompetitorSnapshots({
      cursorCapturedAt: cursor?.k ?? null,
      cursorSource: cursor?.i ?? null,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page: CompetitorSnapshotRow[] = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, { k: last.captured_at, i: last.source })
        : null;
    // Rows are shared CompetitorSnapshotRow VERBATIM — §2 discipline: source +
    // captured_at always present (NOT NULL); empty page while unconfigured.
    return ok(c, { snapshots: page, nextCursor });
  });

  return app;
}
