/**
 * POST /v1/metadata — canonicalize + hash + publish (§8.3, §12.19, api.md §3.2).
 * Server builds the fixed field set + version tag, runs THE shared
 * `canonicalizeMetadata` (byte-identical to client + indexer), keccak256-hashes,
 * and PUTs `metadata/{hash}.json` (content-addressed). Text moderation +
 * impersonation run but NEVER block the response (moderation gates listing, not
 * creation — §8.4; the user always sends the tx). The client re-verifies the
 * returned hash before signing (normative for M3).
 */
import { Hono } from "hono";
import {
  type JsonValue,
  canonicalizeJson,
  metadataRequestSchema,
  metadataResponseSchema,
  tokenMetadataSchema,
  metadataHash as sharedMetadataHash,
} from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { parseJson } from "../lib/validate";
import { matchImpersonation } from "../moderation/impersonation";

/** https-only scheme allowlist (UM-5, §6.4) — reject javascript:/data:/http:. */
function assertHttpsLinks(links: Record<string, string | undefined> | undefined) {
  if (!links) return;
  for (const [key, value] of Object.entries(links)) {
    if (value == null) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw errors.validation(`links.${key} is not a valid URL`);
    }
    if (url.protocol !== "https:") {
      throw errors.validation(`links.${key} must use https (got ${url.protocol})`);
    }
  }
}

export function metadataRoutes(deps: AppDeps) {
  const app = new Hono();

  app.post("/v1/metadata", async (c) => {
    const req = await parseJson(metadataRequestSchema, c);
    assertHttpsLinks(req.links);

    // imageUrl must be exactly the canonical CDN URL for an image WE produced.
    if (req.imageUrl !== deps.storage.imageUrl(req.imageHash)) {
      throw errors.validation("imageUrl must be the canonical CDN URL for imageHash");
    }
    if (!(await deps.storage.imageExists(req.imageHash))) {
      throw errors.conflict("imageHash does not reference a stored image");
    }

    // Fixed field set + version tag; validated with the strict shared doc schema.
    const doc = tokenMetadataSchema.parse({
      version: 1,
      name: req.name,
      ticker: req.ticker,
      ...(req.description ? { description: req.description } : {}),
      ...(req.links ? { links: req.links } : {}),
      imageUrl: req.imageUrl,
      imageHash: req.imageHash,
    });

    const canonicalJson = canonicalizeJson(doc as unknown as JsonValue);
    const hash = sharedMetadataHash(doc as unknown as JsonValue);
    await deps.storage.putMetadata(hash, canonicalJson);

    // Non-blocking impersonation record (early, advisory; the launch worker
    // re-checks the on-chain name/ticker at TokenCreated — §4.4/X-10). Cached by
    // metadata hash for later linking; failure here never fails the response.
    try {
      const imp = matchImpersonation(req.name, req.ticker, deps.watchlist);
      await deps.redis.set(`metamod:${hash}`, JSON.stringify(imp), { exSeconds: 24 * 60 * 60 });
    } catch {
      /* advisory only — never blocks (§8.4) */
    }

    const resp = metadataResponseSchema.parse({
      metadataHash: hash,
      metadataUri: deps.storage.metadataUrl(hash),
      canonicalJson,
    });
    return ok(c, resp);
  });

  return app;
}
