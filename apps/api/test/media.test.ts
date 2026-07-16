/**
 * M2-10 image pipeline : magic-byte sniff + hostile-fixture upload
 * behavior (oversized, wrong-magic, decode-bomb/decode-fail) + content-addressed
 * idempotent write. Uses fake storage/reencoder (sharp not required for logic).
 */
import { describe, expect, it } from "bun:test";
import { MAX_IMAGE_BYTES } from "@robbed/shared";
import { createApp } from "../src/app";
import { errors } from "../src/lib/errors";
import { sniffMime } from "../src/media/sniff";
import { makeFakeStorage, makeTestDeps, readJson } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF- (polyglot attempt)

describe("sniffMime", () => {
  it("detects the four allowed types by magic bytes", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(JPEG)).toBe("image/jpeg");
    expect(sniffMime(GIF)).toBe("image/gif");
    expect(sniffMime(WEBP)).toBe("image/webp");
  });
  it("rejects a disguised non-image regardless of any header", () => {
    expect(sniffMime(PDF)).toBeNull();
    expect(sniffMime(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});

function uploadReq(bytes: Uint8Array, filename = "x.png", type = "image/png") {
  const fd = new FormData();
  fd.append("image", new File([bytes], filename, { type }));
  return new Request("http://x/v1/uploads/image", { method: "POST", body: fd });
}

describe("POST /v1/uploads/image hostile fixtures", () => {
  it("rejects an oversized file with 413 oversized", async () => {
    const app = createApp(makeTestDeps());
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG, 0);
    const res = await app.request(uploadReq(big));
    expect(res.status).toBe(413);
    expect((await readJson(res)).error.code).toBe("oversized");
  });

  it("rejects wrong magic bytes (header lies) with 415 unsupported_type", async () => {
    const app = createApp(makeTestDeps());
    const res = await app.request(uploadReq(PDF, "evil.png", "image/png"));
    expect(res.status).toBe(415);
    expect((await readJson(res)).error.code).toBe("unsupported_type");
  });

  it("maps a decode failure (decode bomb) to 400 decode_failed", async () => {
    const deps = makeTestDeps({
      reencoder: {
        async reencode() {
          throw errors.decodeFailed();
        },
      },
    });
    const res = await createApp(deps).request(uploadReq(PNG));
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe("decode_failed");
  });

  it("content-addresses the write and is idempotent for identical bytes", async () => {
    const storage = makeFakeStorage();
    const deps = makeTestDeps({ storage });
    const app = createApp(deps);
    const r1 = await readJson(await app.request(uploadReq(PNG)));
    const r2 = await readJson(await app.request(uploadReq(PNG)));
    expect(r1.data.imageHash).toBe(r2.data.imageHash);
    expect(storage.objects.size).toBe(1); // deduped by hash
    expect(r1.data.imageUrl).toContain(r1.data.imageHash.slice(2));
  });

  it("does not rate-limit repeated upload attempts during token creation", async () => {
    const app = createApp(makeTestDeps());
    for (let i = 0; i < 8; i++) {
      const res = await app.request(uploadReq(PNG, `logo-${i}.png`));
      expect(res.status).toBe(200);
      expect((await readJson(res)).error).toBeNull();
    }
  });

  it("serves stored images through the public /v1/assets proxy", async () => {
    const app = createApp(makeTestDeps({ storage: makeFakeStorage("https://api.test/v1/assets") }));
    const uploaded = (await readJson(await app.request(uploadReq(PNG)))).data;
    const file = `${uploaded.imageHash.slice(2)}.webp`;

    const res = await app.request(`/v1/assets/images/${file}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("404s non-content-addressed asset paths", async () => {
    const app = createApp(makeTestDeps());
    const res = await app.request("/v1/assets/images/../../secret.webp");
    expect(res.status).toBe(404);
    expect((await readJson(res)).error.code).toBe("not_found");
  });
});
