import {
  type PortfolioHolding,
  type PortfolioSummary,
  type TokenCard,
  type TradeRow,
  portfolioActivityResponseSchema,
  portfolioCreatedResponseSchema,
  portfolioHoldingsResponseSchema,
  portfolioSummarySchema,
} from "@robbed/shared";
import type { z } from "zod";

import { ApiError } from "@/shared/api";
import { env } from "@/shared/lib/env";

/**
 * Portfolio read client (api.md §3.4a) — the four `/v1/portfolio/*` endpoints.
 *
 * PLACEMENT DECISION (hoodpad-frontend; basis recorded): the Portfolio task
 * scope explicitly fences off `src/shared/api` (the base typed REST client), so
 * these getters live in the portfolio entity's `api` segment instead of being
 * added to that barrel. They reuse the SAME transport contract — the shared
 * `ApiError`, the `env.apiFetchBaseUrl()` origin (split-horizon, web.md
 * §2.3), and the api.md §2 envelope
 * (`{ data, error }`) — and validate every response with the FROZEN
 * `@robbed/shared` schemas, so NO response shape is redeclared (anti-drift rule 2
 * holds on types; only the ~12-line envelope transport is repeated). NOTE for
 * hoodpad-shared: exporting a generic `apiGet` primitive from `shared/api` would
 * let these migrate onto it and drop the duplication entirely.
 */

type FetchOpts = { signal?: AbortSignal };

async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  opts: FetchOpts = {},
): Promise<T> {
  const res = await fetch(`${env.apiFetchBaseUrl()}${path}`, {
    headers: { accept: "application/json" },
    signal: opts.signal,
  });
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("invalid_request", `Non-JSON response (${res.status})`, res.status);
  }
  const envelope = json as {
    data: unknown;
    error: { code: string; message: string } | null;
  };
  if (envelope && envelope.error) {
    throw new ApiError(envelope.error.code, envelope.error.message, res.status);
  }
  if (!res.ok) {
    throw new ApiError("invalid_request", `Request failed (${res.status})`, res.status);
  }
  return schema.parse(envelope.data);
}

/** Cursor page query params shared by the three list endpoints. */
type PageQuery = { cursor?: string; limit?: number };

function pageQs(query: PageQuery): string {
  const qs = new URLSearchParams();
  if (query.cursor) qs.set("cursor", query.cursor);
  if (query.limit) qs.set("limit", String(query.limit));
  const q = qs.toString();
  return q ? `?${q}` : "";
}

/**
 * GET /v1/portfolio/:address — stat-cell roll-up. Any address resolves; an
 * unknown/never-traded address is an EMPTY portfolio (never a 404) per api.md
 * §3.4a, so the caller does not special-case not-found.
 */
export function getPortfolioSummary(
  address: string,
  opts?: FetchOpts,
): Promise<PortfolioSummary> {
  return apiGet(`/v1/portfolio/${address.toLowerCase()}`, portfolioSummarySchema, opts);
}

/** GET /v1/portfolio/:address/holdings — HOLDINGS tab (balance DESC cursor). */
export function getPortfolioHoldings(
  address: string,
  query: PageQuery = {},
  opts?: FetchOpts,
): Promise<{ holdings: PortfolioHolding[]; nextCursor: string | null }> {
  return apiGet(
    `/v1/portfolio/${address.toLowerCase()}/holdings${pageQs(query)}`,
    portfolioHoldingsResponseSchema,
    opts,
  );
}

/** GET /v1/portfolio/:address/activity — ACTIVITY tab (per-address TradeRow slice). */
export function getPortfolioActivity(
  address: string,
  query: PageQuery = {},
  opts?: FetchOpts,
): Promise<{ activity: TradeRow[]; nextCursor: string | null }> {
  return apiGet(
    `/v1/portfolio/${address.toLowerCase()}/activity${pageQs(query)}`,
    portfolioActivityResponseSchema,
    opts,
  );
}

/** GET /v1/portfolio/:address/created — CREATED tab (TokenCard projection). */
export function getPortfolioCreated(
  address: string,
  query: PageQuery = {},
  opts?: FetchOpts,
): Promise<{ tokens: TokenCard[]; nextCursor: string | null }> {
  return apiGet(
    `/v1/portfolio/${address.toLowerCase()}/created${pageQs(query)}`,
    portfolioCreatedResponseSchema,
    opts,
  );
}
