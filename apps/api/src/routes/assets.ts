/**
 * Public asset proxy over the configured object store.
 *
 * Production can point `R2_PUBLIC_BASE_URL` directly at a public R2 custom
 * domain. For the local mainnet/testnet compose stacks, MinIO stays private and
 * `R2_PUBLIC_BASE_URL=https://api.../v1/assets`; this route serves the same
 * content-addressed keys without exposing arbitrary bucket paths.
 */
import { Hono } from "hono";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";

const HASH_FILE_RE = /^(?:0x)?([0-9a-fA-F]{64})\.(webp|json)$/;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

export function assetRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/assets/images/:file", async (c) => {
    const hash = parseHashFile(c.req.param("file"), "webp");
    const bytes = await deps.storage.readImage(hash);
    if (!bytes) throw errors.notFound("asset not found");
    return bytesResponse(bytes, "image/webp");
  });

  app.get("/v1/assets/metadata/:file", async (c) => {
    const hash = parseHashFile(c.req.param("file"), "json");
    const bytes = await deps.storage.readMetadata(hash);
    if (!bytes) throw errors.notFound("asset not found");
    return bytesResponse(bytes, "application/json; charset=utf-8");
  });

  return app;
}

function parseHashFile(file: string, ext: "webp" | "json"): `0x${string}` {
  const match = file.match(HASH_FILE_RE);
  if (!match || match[2]?.toLowerCase() !== ext) {
    throw errors.notFound("asset not found");
  }
  return `0x${match[1]!.toLowerCase()}`;
}

function bytesResponse(bytes: Uint8Array, contentType: string): Response {
  const body = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": IMMUTABLE_CACHE,
    },
  });
}
