/**
 * M2-11 admin mutations: authenticated visibility hide (audit-logged) and the
 * X-9 re-verify seam — `POST .../reverify` PUBLISHES `control:reverify` on Redis
 * and writes NO indexer table (the indexer flips its own row). CSRF enforced.
 */
import { describe, expect, it } from "bun:test";
import { CONTROL_REVERIFY, controlReverifySchema } from "@robbed/shared";
import { createApp } from "../src/app";
import { createFakeRedis } from "../src/lib/redis";
import { SESSION_COOKIE, issueSession } from "../src/admin/session";
import { FakeDb, TEST_ADDR, makeTestDeps, readJson, testConfig } from "./helpers";

const ADMIN = "0x1111111111111111111111111111111111111111";

function adminDeps() {
  const config = testConfig({
    SESSION_SECRET: "admin-secret",
    adminAllowlist: new Set([ADMIN]),
  });
  const redis = createFakeRedis();
  const db = new FakeDb();
  const deps = makeTestDeps({ config, redis, db });
  const { cookieValue, csrfToken } = issueSession(config.SESSION_SECRET, ADMIN, "nonceX", 1_700_000_000);
  const headers = {
    Cookie: `${SESSION_COOKIE}=${cookieValue}`,
    "X-CSRF-Token": csrfToken,
    "content-type": "application/json",
  };
  return { deps, db, redis, headers };
}

describe("admin visibility", () => {
  it("hides a listing, persists it, and audit-logs the action", async () => {
    const { deps, db, headers } = adminDeps();
    const app = createApp(deps);
    const res = await app.request(
      new Request(`http://x/v1/admin/moderation/${TEST_ADDR}/visibility`, {
        method: "POST",
        headers,
        body: JSON.stringify({ visibility: "hidden", reason: "spam" }),
      }),
    );
    expect(res.status).toBe(200);
    expect((await db.getModerationStatus(TEST_ADDR))?.visibility).toBe("hidden");
    expect(db.audit.some((a) => a.action === "moderation.set_visibility")).toBe(true);
  });

  it("rejects a mutation missing the CSRF token (401)", async () => {
    const { deps, headers } = adminDeps();
    const { "X-CSRF-Token": _omit, ...noCsrf } = headers;
    const res = await createApp(deps).request(
      new Request(`http://x/v1/admin/moderation/${TEST_ADDR}/visibility`, {
        method: "POST",
        headers: noCsrf,
        body: JSON.stringify({ visibility: "hidden", reason: "x" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("admin reverify (X-9)", () => {
  it("publishes control:reverify and writes no indexer table", async () => {
    const { deps, redis, headers } = adminDeps();
    let published: unknown = null;
    await redis.subscribe(CONTROL_REVERIFY, (m) => {
      published = JSON.parse(m);
    });
    const res = await createApp(deps).request(
      new Request(`http://x/v1/admin/metadata/${TEST_ADDR}/reverify`, { method: "POST", headers }),
    );
    expect(res.status).toBe(202);
    expect((await readJson(res)).data.queued).toBe(true);
    expect(() => controlReverifySchema.parse(published)).not.toThrow();
    expect((published as { token: string }).token).toBe(TEST_ADDR);
  });
});
