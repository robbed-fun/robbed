/**
 * M2-10 metadata : golden hash parity with the shared canonicalizer
 * (same fn the client + indexer use), byte-limit + link-scheme validation, and
 * NON-BLOCKING moderation (impersonation never blocks the response).
 */
import { describe, expect, it } from "bun:test";
import { buildTokenMetadataDocument, canonicalizeJson, metadataHash } from "@robbed/shared";
import { createApp } from "../src/app";
import { makeFakeStorage, makeTestDeps, readJson } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

async function uploadImage(app: ReturnType<typeof createApp>) {
  const fd = new FormData();
  fd.append("image", new File([PNG], "x.png", { type: "image/png" }));
  const res = await app.request(
    new Request("http://x/v1/uploads/image", { method: "POST", body: fd }),
  );
  return (await readJson(res)).data as { imageUrl: string; imageHash: string };
}

function metaReq(body: unknown) {
  return new Request("http://x/v1/metadata", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /v1/metadata", () => {
  it("returns a hash byte-identical to the shared canonicalizer", async () => {
    const app = createApp(makeTestDeps({ storage: makeFakeStorage() }));
    const img = await uploadImage(app);
    const body = { name: "Test", ticker: "TST", imageUrl: img.imageUrl, imageHash: img.imageHash };
    const res = await app.request(metaReq(body));
    expect(res.status).toBe(200);
    const data = (await readJson(res)).data;

    const expectedDoc = buildTokenMetadataDocument({
      name: "Test",
      ticker: "TST",
      imageUrl: img.imageUrl,
      imageHash: img.imageHash,
    });
    expect(data.metadataHash).toBe(metadataHash(expectedDoc));
    expect(data.canonicalJson).toBe(canonicalizeJson(expectedDoc));
    expect(data.metadataUri).toContain(data.metadataHash.slice(2));
  });

  it("serves stored metadata through the public /v1/assets proxy", async () => {
    const app = createApp(makeTestDeps({ storage: makeFakeStorage("https://api.test/v1/assets") }));
    const img = await uploadImage(app);
    const created = await app.request(
      metaReq({ name: "Test", ticker: "TST", imageUrl: img.imageUrl, imageHash: img.imageHash }),
    );
    const data = (await readJson(created)).data;
    const file = `${data.metadataHash.slice(2)}.json`;

    const res = await app.request(`/v1/assets/metadata/${file}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.text()).toBe(data.canonicalJson);
  });

  it("rejects a name over 32 UTF-8 bytes", async () => {
    const app = createApp(makeTestDeps({ storage: makeFakeStorage() }));
    const img = await uploadImage(app);
    const res = await app.request(
      metaReq({
        name: "x".repeat(33),
        ticker: "TST",
        imageUrl: img.imageUrl,
        imageHash: img.imageHash,
      }),
    );
    expect(res.status).toBe(400);
    expect((await readJson(res)).error.code).toBe("invalid_request");
  });

  it("rejects non-https links (javascript:/http:) — UM-5", async () => {
    const app = createApp(makeTestDeps({ storage: makeFakeStorage() }));
    const img = await uploadImage(app);
    for (const website of ["javascript:alert(1)", "http://insecure.example"]) {
      const res = await app.request(
        metaReq({
          name: "Ok",
          ticker: "OK",
          links: { website },
          imageUrl: img.imageUrl,
          imageHash: img.imageHash,
        }),
      );
      expect(res.status).toBe(400);
    }
  });

  it("rejects an imageHash we never produced (conflict → invalid_request)", async () => {
    const app = createApp(makeTestDeps({ storage: makeFakeStorage() }));
    const fakeHash = "0x" + "11".repeat(32);
    const res = await app.request(
      metaReq({
        name: "Ok",
        ticker: "OK",
        imageUrl: `https://cdn.test/images/${"11".repeat(32)}.webp`,
        imageHash: fakeHash,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("does NOT block on impersonation (BTC ticker still returns 200)", async () => {
    const app = createApp(makeTestDeps({ storage: makeFakeStorage() }));
    const img = await uploadImage(app);
    const res = await app.request(
      metaReq({ name: "Bitcoin", ticker: "BTC", imageUrl: img.imageUrl, imageHash: img.imageHash }),
    );
    expect(res.status).toBe(200);
  });
});
