import {
  type Candle,
  type EventFeedFilter,
  type EventsResponse,
  type HolderListQuery,
  type HolderRow,
  type MetadataRequest,
  type Paginated,
  type TokenCard,
  type TokenDetail,
  type TradeListQuery,
  type TradeRow,
  candlesResponseSchema,
  confirmationsResponseSchema,
  ethUsdResponseSchema,
  eventsResponseSchema,
  metadataResponseSchema,
  paginatedHoldersResponseSchema,
  paginatedTradesResponseSchema,
  searchResponseSchema,
  tokenDetailSchema,
  tokensResponseSchema,
  txTradesResponseSchema,
  uploadImageResponseSchema,
} from "@robbed/shared";
import type { z } from "zod";

import { env } from "@/shared/lib/env";

/**
 * Typed REST client over the FROZEN `@robbed/shared` contract (api.md;
 * openapi.yaml). Every response is validated with the shared zod schema — the
 * frontend NEVER redeclares a response shape (anti-drift rule 2). If a field is
 * missing from the contract, that is a gap reported to robbed-indexer/shared,
 * never patched client-side.
 *
 * Envelope (api.md) `{ data, error: null } | { data: null, error }`. This
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
  /** Next.js server-fetch cache hint (web.md — server components only). */
  revalidate?: number;
  signal?: AbortSignal;
};

export async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  opts: FetchOpts = {},
): Promise<T> {
  // Split-horizon base (web.md) SSR fetches prefer the server-only
  // API_BASE_URL_INTERNAL (compose-internal origin); browsers always resolve
  // to NEXT_PUBLIC_API_BASE_URL. Single resolution point in shared/lib/env.ts.
  const res = await fetch(`${env.apiFetchBaseUrl()}${path}`, {
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
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${env.apiFetchBaseUrl()}${path}`, {
    method: "POST",
    headers: { accept: "application/json", ...headers },
    body,
    signal,
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

// ── Read endpoints (api.md) ───────────────────────────────────────

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

// NOTE : the king-of-the-hill client leg was removed with the
// Discover deviation — the endpoint remains an API capability, but no web
// surface consumes it (the KotH hero is retired).

/**
 * GET /v1/events — merged, newest-first, keyset-paginated feed of launches ∪
 * trades ∪ graduations (listing-gated, hidden tokens excluded). `type` filters
 * (`all` default / `launches` / `trades` / `graduations`); each row's `data` is
 * shape-identical to the live-WS payload. Seeds the Discover event tape so
 * HISTORICAL graduations/trades paint on first load, not just launch rows.
 */
export function getEvents(
  query: { type?: EventFeedFilter; cursor?: string; limit?: number } = {},
  opts?: FetchOpts,
): Promise<EventsResponse> {
  const qs = new URLSearchParams();
  if (query.type) qs.set("type", query.type);
  if (query.cursor) qs.set("cursor", query.cursor);
  if (query.limit) qs.set("limit", String(query.limit));
  const q = qs.toString();
  return apiGet(`/v1/events${q ? `?${q}` : ""}`, eventsResponseSchema, opts);
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

/**
 * GET /v1/tokens/:address/trades — SERVER-SORTED, keyset-paginated. The
 * response is the shared `Paginated<TradeRow>` `{ items, nextCursor }` envelope;
 * `sort`/`dir` are the `tradeListQuerySchema` allowlist (API validates + 400s on
 * out-of-allowlist), `cursor` is the OPAQUE keyset cursor echoed back verbatim.
 */
export function getTrades(
  address: string,
  query: {
    sort?: TradeListQuery["sort"];
    dir?: TradeListQuery["dir"];
    cursor?: string;
    limit?: number;
  } = {},
  opts?: FetchOpts,
): Promise<Paginated<TradeRow>> {
  const qs = new URLSearchParams();
  if (query.sort) qs.set("sort", query.sort);
  if (query.dir) qs.set("dir", query.dir);
  if (query.cursor) qs.set("cursor", query.cursor);
  if (query.limit) qs.set("limit", String(query.limit));
  const q = qs.toString();
  return apiGet(
    `/v1/tokens/${address.toLowerCase()}/trades${q ? `?${q}` : ""}`,
    paginatedTradesResponseSchema,
    opts,
  );
}

/** GET /v1/trades/:txHash — used by the optimistic reducer's REST-heal. */
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

/**
 * GET /v1/tokens/:address/holders — SERVER-SORTED, keyset-paginated. The
 * response is the shared `Paginated<HolderRow>` `{ items, nextCursor }` envelope
 * (the legacy `{ holders, holderCount }` shape is retired for this endpoint —
 * DATA-GAP flagged: the header "Holders" count needs a `holderCount` on
 * `tokenDetailSchema`, since `tokens.holder_count` already exists indexer-side).
 * `sort`/`dir` are the `holderListQuerySchema` allowlist; `cursor` is opaque.
 */
export function getHolders(
  address: string,
  query: {
    sort?: HolderListQuery["sort"];
    dir?: HolderListQuery["dir"];
    cursor?: string;
    limit?: number;
  } = {},
  opts?: FetchOpts,
): Promise<Paginated<HolderRow>> {
  const qs = new URLSearchParams();
  if (query.sort) qs.set("sort", query.sort);
  if (query.dir) qs.set("dir", query.dir);
  if (query.cursor) qs.set("cursor", query.cursor);
  if (query.limit) qs.set("limit", String(query.limit));
  const q = qs.toString();
  return apiGet(
    `/v1/tokens/${address.toLowerCase()}/holders${q ? `?${q}` : ""}`,
    paginatedHoldersResponseSchema,
    opts,
  );
}

/** GET /v1/confirmations — SSR seed of the watermark. */
export function getConfirmations(opts?: FetchOpts): Promise<ConfirmationsResponse> {
  return apiGet(`/v1/confirmations`, confirmationsResponseSchema, opts);
}

/** GET /v1/eth-usd — live-or-dated source; never a constant. */
export function getEthUsd(opts?: FetchOpts) {
  return apiGet(`/v1/eth-usd`, ethUsdResponseSchema, opts);
}

// ── Launch flow (api.md) ──────────────────────────────────────────

/**
 * POST /v1/uploads/image — API-mediated upload (no browser presign).
 * Accepts an optional `AbortSignal` so the caller can bound the request with a
 * timeout — an unbounded upload fetch can otherwise wedge the launch form's
 * `uploading` state true forever (button stuck disabled).
 */
export function uploadImage(
  file: File | Blob,
  fieldName = "image",
  opts?: { signal?: AbortSignal },
) {
  const form = new FormData();
  form.append(fieldName, file);
  return apiPost(`/v1/uploads/image`, form, uploadImageResponseSchema, undefined, opts?.signal);
}

/** POST /v1/metadata — server canonicalizes + keccak; client re-verifies. */
export function postMetadata(body: MetadataRequest) {
  return apiPost(`/v1/metadata`, JSON.stringify(body), metadataResponseSchema, {
    "content-type": "application/json",
  });
}
