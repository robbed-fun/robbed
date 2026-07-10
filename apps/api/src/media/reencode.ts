/**
 * Image re-encode boundary (§8.4, api.md §3.1 step 2). Decode → re-encode strips
 * EXIF/metadata and kills polyglot/steganographic containers as a side effect,
 * and a pre-decode dimension guard defuses decode bombs (api.md §6.4). The
 * concrete decoder (`sharp`) sits behind this INTERFACE so hostile-fixture tests
 * inject a fake and the sniff/size-cap logic is exercised without the native lib.
 */
import type { SniffedMime } from "./sniff";
import { errors } from "../lib/errors";

export interface ReencodeResult {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface Reencoder {
  reencode(input: Uint8Array, mime: SniffedMime): Promise<ReencodeResult>;
}

/** Max source dimension pre-decode (api.md §6.4 decode-bomb guard). */
export const MAX_DIMENSION = 8192;

/**
 * sharp-backed re-encoder. Lazily imported so the module graph (and tests that
 * only touch sniff/cap) never require the native binding. `rotate()` bakes EXIF
 * orientation then metadata is dropped by not calling `.withMetadata()`.
 * `animated: true` preserves animated GIF/WebP frames while re-encoding to WebP.
 */
export function createSharpReencoder(): Reencoder {
  return {
    async reencode(input, _mime) {
      const sharpMod = await import("sharp");
      const sharp = sharpMod.default;
      let pipeline;
      try {
        pipeline = sharp(input, {
          limitInputPixels: MAX_DIMENSION * MAX_DIMENSION,
          failOn: "error",
          animated: true,
        });
        const meta = await pipeline.metadata();
        if (
          (meta.width ?? 0) > MAX_DIMENSION ||
          (meta.pageHeight ?? meta.height ?? 0) > MAX_DIMENSION
        ) {
          throw errors.oversized("image dimensions exceed 8192px");
        }
        const out = await pipeline
          .rotate() // bake EXIF orientation
          .webp({ quality: 82, effort: 4 })
          .toBuffer({ resolveWithObject: true });
        return {
          data: new Uint8Array(out.data),
          width: out.info.width,
          // `pageHeight` is present at runtime for animated webp but is absent
          // from sharp's OutputInfo typings; read it through a narrow cast.
          height: (out.info as { pageHeight?: number }).pageHeight ?? out.info.height,
        };
      } catch (err) {
        if (err instanceof Error && err.name === "ApiError") throw err;
        throw errors.decodeFailed("image could not be decoded");
      }
    },
  };
}
