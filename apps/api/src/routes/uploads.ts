/**
 * POST /v1/uploads/image — API-mediated image pipeline (§12.19, api.md §3.1).
 * Multipart, NOT a browser-direct presign (that would put unmoderated bytes on
 * the CDN). Pipeline: Content-Length + buffered ≤ 4MB cap → magic-byte MIME
 * sniff (never the header) → decode + re-encode (strips EXIF/polyglot) → keccak256
 * of the RE-ENCODED bytes = imageHash → content-addressed R2 PUT → image auto-mod
 * scored and cached by hash so the launch worker (X-10) links it to the token.
 */
import { Hono } from "hono";
import { MAX_IMAGE_BYTES, uploadImageResponseSchema } from "@robbed/shared";
import { keccak256 } from "viem";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { sniffMime } from "../media/sniff";
import { imageModCacheKey, scoreImage } from "../moderation/image";

export function uploadRoutes(deps: AppDeps) {
  const app = new Hono();

  app.post("/v1/uploads/image", async (c) => {
    // Pre-buffer guard on Content-Length (multipart overhead → small slack).
    const len = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(len) && len > MAX_IMAGE_BYTES + 8192) {
      throw errors.oversized("image exceeds 4MB");
    }

    const body = await c.req.parseBody();
    const file = body["image"];
    if (!(file instanceof File)) throw errors.validation("missing `image` file field");
    if (file.size > MAX_IMAGE_BYTES) throw errors.oversized("image exceeds 4MB");

    const input = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(input);
    if (!mime) throw errors.unsupportedType("unsupported image type (png|jpeg|webp|gif only)");

    const { data, width, height } = await deps.reencoder.reencode(input, mime);
    if (data.byteLength > MAX_IMAGE_BYTES) throw errors.oversized("re-encoded image exceeds 4MB");

    const imageHash = keccak256(data);
    await deps.storage.putImage(imageHash, data);

    // Auto-moderate the re-encoded bytes and cache by hash for the launch worker.
    const scored = await scoreImage(deps.vendors, data);
    await deps.redis
      .set(imageModCacheKey(imageHash), JSON.stringify(scored), { exSeconds: 24 * 60 * 60 })
      .catch(() => false);

    const resp = uploadImageResponseSchema.parse({
      imageUrl: deps.storage.imageUrl(imageHash),
      imageHash,
      width,
      height,
      bytes: data.byteLength,
    });
    return ok(c, resp);
  });

  return app;
}
