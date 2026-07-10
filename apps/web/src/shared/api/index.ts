import {
  type Candle,
  type HolderRow,
  type MetadataRequest,
  type TokenCard,
  type TokenDetail,
  type TradeRow,
  candlesResponseSchema,
  confirmationsResponseSchema,
  ethUsdResponseSchema,
  holdersResponseSchema,
  kingOfTheHillResponseSchema,
  metadataResponseSchema,
  searchResponseSchema,
  tokenDetailSchema,
  tokensResponseSchema,
  tradesResponseSchema,
  txTradesResponseSchema,
  uploadImageResponseSchema,
} from "@robbed/shared";
import type { z } from "zod";

import { env } from "@/shared/lib/env";

/**
 * Typed REST client over the FROZEN `@robbed/shared` contract (api.md §3;
 * openapi.yaml). Every response is validated with the shared zod schema — the
 * frontend NEVER redeclares a response shape (anti-drift rule 2). If a field is
 * missing from the contract, that is a gap reported to hoodpad-indexer/shared,
 * never patched client-side.
 *
 * Envelope (api.md §2): `{ data, error: null } | { data: null, error }`. This
 * client unwraps `data` and throws `ApiError` on the error arm.
 */

// Shared exports the schema but not a named type alias for it; infer locally.
export type ConfirmationsResponse = z.infer<typeof confirmationsResponseSchema>;

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchOpts = {
  /** Next.js server-fetch cache hint (web.md §2.2 — server components only). */
  revalidate?: number;
  signal?: AbortSignal;
};

async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  opts: FetchOpts = {},
): Promise<T> {
  const res = await fetch(`${env.apiBaseUrl()}${path}`, {
    headers: { accept: "application/json" },
    signal: opts.signal,
    ...(opts.revalidate !== undefined
      ? { next: { revalidate: opts.revalidate } }
      : {}),
  });
  return unwrap(res, schema);
}

async function apiPost<T>(
  path: string,
  body: BodyInit,
  schema: z.ZodType<T>,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${env.apiBaseUrl()}${path}`, {
    method: "POST",
    headers: { accept: "application/json", ...headers },
    body,
  });
  return unwrap(res, schema);
}

async function unwrap<T>(res: Response, schema: z.ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("invalid_request", `Non-JSON response (${res.status})`, res.status);
  }
  const envelope = json as { data: unknown; error: { code: string; message: string } | null };
  if (envelope && envelope.error) {
    throw new ApiError(envelope.error.code, envelope.error.message, res.status);
  }
  if (!res.ok) {
    throw new ApiError("invalid_request", `Request failed (${res.status})`, res.status);
  }
  return schema.parse(envelope.data);
}

// ── Read endpoints (api.md §3.3–§3.5) ───────────────────────────────────────

export function getTokens(
  query: {
    sort?: string;
    filter?: string;
    cursor?: string;
    limit?: number;
  } = {},
  opts?: FetchOpts,
): Promise<{ tokens: TokenCard[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  if (query.sort) qs.set("sort", query.sort);
  if (query.filter) qs.set("filter", query.filter);
  if (query.cursor) qs.set("cursor", query.cursor);
  if (query.limit) qs.set("limit", String(query.limit));
  const q = qs.toString();
  return apiGet(`/v1/tokens${q ? `?${q}` : ""}`, tokensResponseSchema, opts);
}

export function getKingOfTheHill(opts?: FetchOpts): Promise<{ token: TokenCard | null }> {
  return apiGet(`/v1/tokens/king-of-the-hill`, kingOfTheHillResponseSchema, opts);
}

export function getToken(address: string, opts?: FetchOpts): Promise<TokenDetail> {
  return apiGet(`/v1/tokens/${address.toLowerCase()}`, tokenDetailSchema, opts);
}

export function searchTokens(
  q: string,
  opts?: FetchOpts,
): Promise<{ results: TokenCard[] }> {
  return apiGet(`/v1/search?q=${encodeURIComponent(q)}`, searchResponseSchema, opts);
}

export function getTrades(
  address: string,
  query: { cursor?: string; limit?: number } = {},
  opts?: FetchOpts,
): Promise<{ trades: TradeRow[]; nextCursor: string | null }> {
  const qs = new URLSearchParams();
  if (query.cursor) qs.set("cursor", query.cursor);
  if (query.limit) qs.set("limit", String(query.limit));
  const q = qs.toString();
  return apiGet(
    `/v1/tokens/${address.toLowerCase()}/trades${q ? `?${q}` : ""}`,
    tradesResponseSchema,
    opts,
  );
}

/** GET /v1/trades/:txHash — used by the optimistic reducer's REST-heal (§4). */
export function getTxTrades(txHash: string, opts?: FetchOpts): Promise<{ trades: TradeRow[] }> {
  return apiGet(`/v1/trades/${txHash.toLowerCase()}`, txTradesResponseSchema, opts);
}

export function getCandles(
  address: string,
  interval: string,
  range: { from: number; to: number },
  opts?: FetchOpts,
): Promise<{ candles: Candle[] }> {
  const qs = new URLSearchParams({
    interval,
    from: String(range.from),
    to: String(range.to),
  });
  return apiGet(
    `/v1/tokens/${address.toLowerCase()}/candles?${qs.toString()}`,
    candlesResponseSchema,
    opts,
  );
}

export function getHolders(
  address: string,
  query: { limit?: number } = {},
  opts?: FetchOpts,
): Promise<{ holders: HolderRow[]; holderCount: number }> {
  const qs = new URLSearchParams();
  if (query.limit) qs.set("limit", String(query.limit));
  const q = qs.toString();
  return apiGet(
    `/v1/tokens/${address.toLowerCase()}/holders${q ? `?${q}` : ""}`,
    holdersResponseSchema,
    opts,
  );
}

/** GET /v1/confirmations — SSR seed of the watermark (spec §12.20). */
export function getConfirmations(opts?: FetchOpts): Promise<ConfirmationsResponse> {
  return apiGet(`/v1/confirmations`, confirmationsResponseSchema, opts);
}

/** GET /v1/eth-usd — live-or-dated source; never a constant (§2). */
export function getEthUsd(opts?: FetchOpts) {
  return apiGet(`/v1/eth-usd`, ethUsdResponseSchema, opts);
}

// ── Launch flow (api.md §3.1–§3.2) ──────────────────────────────────────────

/** POST /v1/uploads/image — API-mediated upload (spec §12.19; no browser presign). */
export function uploadImage(file: File | Blob, fieldName = "image") {
  const form = new FormData();
  form.append(fieldName, file);
  return apiPost(`/v1/uploads/image`, form, uploadImageResponseSchema);
}

/** POST /v1/metadata — server canonicalizes + keccak; client re-verifies (§12.19). */
export function postMetadata(body: MetadataRequest) {
  return apiPost(`/v1/metadata`, JSON.stringify(body), metadataResponseSchema, {
    "content-type": "application/json",
  });
}
