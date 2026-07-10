/**
 * X-10 launch worker (§4.4): on `global:launches` it runs impersonation on the
 * on-chain name/ticker, links the pre-scanned image verdict, and writes ONLY the
 * API-owned `moderation_status` — no chain read, no indexer-table write.
 */
import { describe, expect, it } from "bun:test";
import type { WsLaunchData } from "@robbed/shared";
import { hashFromImageUrl, processLaunch } from "../src/moderation/worker";
import { imageModCacheKey } from "../src/moderation/image";
import { FakeDb, makeTestDeps } from "./helpers";

function launch(over: Partial<WsLaunchData> = {}): WsLaunchData {
  return {
    address: "0xaaaa000000000000000000000000000000000001",
    name: "Some Token",
    ticker: "SOME",
    creator: "0xbbbb000000000000000000000000000000000002",
    createdAt: 1_700_000_000,
    blockNumber: 10,
    confirmationState: "soft_confirmed",
    ...over,
  };
}

describe("hashFromImageUrl", () => {
  it("extracts the 0x keccak from a content-addressed image URL", () => {
    const h = "ab".repeat(32);
    expect(hashFromImageUrl(`https://cdn.test/images/${h}.webp`)).toBe(`0x${h}`);
  });
  it("returns null for a non-matching url", () => {
    expect(hashFromImageUrl("https://cdn.test/x.png")).toBeNull();
    expect(hashFromImageUrl(undefined)).toBeNull();
  });
});

describe("processLaunch", () => {
  it("flags impersonation on the on-chain ticker and pends review", async () => {
    const db = new FakeDb([]);
    const deps = makeTestDeps({ db });
    await processLaunch(deps, launch({ name: "Bitcoin", ticker: "BTC" }));
    const m = await db.getModerationStatus(launch().address);
    expect(m?.impersonation_flag).toBe(true);
    expect(m?.impersonation_ticker).toBe("BTC");
    expect(m?.visibility).toBe("pending_review");
  });

  it("hides a launch whose linked image scored csam", async () => {
    const db = new FakeDb([]);
    const deps = makeTestDeps({ db });
    const hash = `0x${"cc".repeat(32)}`;
    await deps.redis.set(imageModCacheKey(hash), JSON.stringify({ csam: true, nsfw: 0, violence: 0 }));
    await processLaunch(
      deps,
      launch({ imageUrl: `https://cdn.test/images/${"cc".repeat(32)}.webp` }),
    );
    const m = await db.getModerationStatus(launch().address);
    expect(m?.csam_flag).toBe(true);
    expect(m?.visibility).toBe("hidden");
  });

  it("leaves a clean launch visible", async () => {
    const db = new FakeDb([]);
    const deps = makeTestDeps({ db });
    await processLaunch(deps, launch({ name: "Cool Cat", ticker: "COOL" }));
    const m = await db.getModerationStatus(launch().address);
    expect(m?.visibility).toBe("visible");
  });
});
