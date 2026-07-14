/**
 * Admin endpoints (api.md). SIWE login → session cookie; moderation
 * queue; listing-visibility (HIDE/SHOW ONLY — no pause/chain capability exists by
 * construction); impersonation flag; metadata re-verify (PUBLISHES
 * `control:reverify` on Redis — the INDEXER flips its own row, X-9; the API never
 * writes indexer tables); audit log. Every mutation is audit-logged.
 *
 * The SIWE lifecycle (`GET /v1/admin/nonce` + `POST /v1/admin/login` + `POST
 * /v1/admin/logout`) is IN the frozen contract: transcribed into openapi.yaml
 * (ratified 2026-07-10) and api.md — the earlier "absent from openapi" flag
 * is resolved (W3/M2-2, 2026-07-12). The openapi-sync test holds route table and
 * yaml in endpoint-for-endpoint lockstep.
 */
import { Hono } from "hono";
import {
  CONTROL_REVERIFY,
  addressSchema,
  adminImpersonationRequestSchema,
  adminVisibilityRequestSchema,
  auditLogResponseSchema,
  controlReverifySchema,
  moderationQueueItemSchema,
  moderationQueueResponseSchema,
} from "@robbed/shared";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { ok } from "../lib/envelope";
import { clampLimit, decodeCursor, encodeCursor } from "../lib/pagination";
import { parse, parseJson, parseQuery } from "../lib/validate";
import { buildQueueItem } from "../projections/moderation";
import { AUDIT_ACTIONS, recordAudit } from "./audit";
import { type AdminVars, requireAdmin, requireCsrf } from "./middleware";
import { issueNonce, verifySiweLogin } from "./siwe";
import { issueSession, serializeSessionCookie } from "./session";

const loginBodySchema = z.object({
  message: z.string().min(1),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
const queueQuerySchema = z.object({
  status: z.enum(["pending_review", "flagged"]).optional(),
  cursor: z.string().optional(),
  limit: z.string().optional(),
});
const auditQuerySchema = z.object({ cursor: z.string().optional(), limit: z.string().optional() });
const tokenParamSchema = z.object({ tokenAddress: addressSchema });

export function adminRoutes(deps: AppDeps) {
  const app = new Hono<{ Variables: AdminVars }>();

  // ── SIWE login lifecycle (openapi: adminNonce/adminLogin/adminLogout) ─────
  app.get("/v1/admin/nonce", async (c) => {
    const nonce = await issueNonce(deps.redis);
    return ok(c, { nonce });
  });

  app.post("/v1/admin/login", async (c) => {
    const { message, signature } = await parseJson(loginBodySchema, c);
    const login = await verifySiweLogin(
      { message, signature: signature as `0x${string}` },
      { redis: deps.redis, allowlist: deps.config.adminAllowlist, nowSec: Math.floor(deps.now() / 1000) },
    );
    const { cookieValue, csrfToken } = issueSession(
      deps.config.SESSION_SECRET,
      login.address,
      login.nonce,
      Math.floor(deps.now() / 1000),
    );
    c.header("Set-Cookie", serializeSessionCookie(cookieValue, deps.secureCookies));
    await recordAudit(deps.db, {
      actor: login.address,
      action: AUDIT_ACTIONS.login,
      target: login.address,
      reason: null,
    });
    return ok(c, { address: login.address, csrfToken });
  });

  app.post("/v1/admin/logout", (c) => {
    c.header("Set-Cookie", serializeSessionCookie("", deps.secureCookies));
    return ok(c, { ok: true as const });
  });

  // ── authenticated surface ─────────────────────────────────────────────────
  const auth = requireAdmin(deps);
  const csrf = requireCsrf(deps);

  app.get("/v1/admin/moderation/queue", auth, async (c) => {
    const q = parseQuery(queueQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const limit = clampLimit(q.limit);
    const rows = await deps.db.getModerationQueue({
      status: q.status ?? null,
      cursorId: cursor?.i ?? null,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((r) => buildQueueItem(r.address, r, r.m));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, { k: last.address, i: last.address })
        : null;
    return ok(c, moderationQueueResponseSchema.parse({ items, nextCursor }));
  });

  app.post("/v1/admin/moderation/:tokenAddress/visibility", auth, csrf, async (c) => {
    const { tokenAddress } = parse(tokenParamSchema, {
      tokenAddress: c.req.param("tokenAddress").toLowerCase(),
    });
    const body = await parseJson(adminVisibilityRequestSchema, c);
    const actor = c.get("adminAddress")!;
    const updated = await deps.db.upsertModerationStatus(tokenAddress, {
      visibility: body.visibility,
      reason: body.reason,
      reviewed_by: actor,
      updated_at: new Date(deps.now()).toISOString(),
    });
    await recordAudit(deps.db, {
      actor,
      action: AUDIT_ACTIONS.setVisibility,
      target: tokenAddress,
      reason: body.reason,
    });
    const token = await deps.db.getTokenListRow(tokenAddress);
    return ok(c, moderationQueueItemSchema.parse(buildQueueItem(tokenAddress, token, updated)));
  });

  app.post("/v1/admin/moderation/:tokenAddress/impersonation", auth, csrf, async (c) => {
    const { tokenAddress } = parse(tokenParamSchema, {
      tokenAddress: c.req.param("tokenAddress").toLowerCase(),
    });
    const body = await parseJson(adminImpersonationRequestSchema, c);
    const actor = c.get("adminAddress")!;
    const updated = await deps.db.upsertModerationStatus(tokenAddress, {
      impersonation_flag: body.flagged,
      impersonation_ticker: body.ticker ?? null,
      reason: body.reason,
      reviewed_by: actor,
      updated_at: new Date(deps.now()).toISOString(),
    });
    await recordAudit(deps.db, {
      actor,
      action: AUDIT_ACTIONS.setImpersonation,
      target: tokenAddress,
      reason: body.reason,
    });
    const token = await deps.db.getTokenListRow(tokenAddress);
    return ok(c, moderationQueueItemSchema.parse(buildQueueItem(tokenAddress, token, updated)));
  });

  app.post("/v1/admin/metadata/:tokenAddress/reverify", auth, csrf, async (c) => {
    const { tokenAddress } = parse(tokenParamSchema, {
      tokenAddress: c.req.param("tokenAddress").toLowerCase(),
    });
    // X-9: publish the control message ONLY. The API never writes
    // metadata_verifications; the indexer subscribes and flips its own row.
    const payload = controlReverifySchema.parse({ token: tokenAddress });
    await deps.redis.publish(CONTROL_REVERIFY, JSON.stringify(payload));
    await recordAudit(deps.db, {
      actor: c.get("adminAddress")!,
      action: AUDIT_ACTIONS.reverify,
      target: tokenAddress,
      reason: null,
    });
    return ok(c, { queued: true as const }, 202);
  });

  app.get("/v1/admin/audit-log", auth, async (c) => {
    const q = parseQuery(auditQuerySchema, c);
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);
    const limit = clampLimit(q.limit);
    const rows = await deps.db.listAudit({ cursorId: cursor?.i ?? null, limit: limit + 1 });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const entries = page.map((r) => ({
      actor: r.actor,
      action: r.action,
      target: r.target,
      reason: r.reason,
      ts: r.ts,
    }));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor(deps.config.SESSION_SECRET, { k: last.id, i: last.id }) : null;
    return ok(c, auditLogResponseSchema.parse({ entries, nextCursor }));
  });

  return app;
}
