/**
 * Comments backend (spec §12.63b — off-chain, SIWE-authored, §8.4-moderation-
 * gated, per-token, flat). Covers the task's required cases: post / list /
 * pagination / moderation-hidden-excluded / auth-required / body-cap, plus the
 * user SIWE-auth extension, per-author rate limit, and the visible-only WS fanout.
 */
import { describe, expect, it } from "bun:test";
import { COMMENT_BODY_MAX, tokenEvents, wsMessageSchema } from "@robbed/shared";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createApp } from "../src/app";
import type { Redis } from "../src/lib/redis";
import { createFakeRedis } from "../src/lib/redis";
import { USER_SESSION_COOKIE, issueUserSession, verifyUserSession } from "../src/auth/session";
import { verifySiweLogin } from "../src/admin/siwe";
import type { CommentModerator } from "../src/moderation/comment";
import { FakeDb, TEST_ADDR, makeTestDeps, readJson, testConfig } from "./helpers";

const SECRET = "user-secret";
const USER = "0x1111111111111111111111111111111111111111";

function userCookie(addr = USER, nowSec = 1_700_000_000): string {
  const { cookieValue } = issueUserSession(SECRET, addr, nowSec);
  return `${USER_SESSION_COOKIE}=${cookieValue}`;
}

function deps(overrides: Parameters<typeof makeTestDeps>[0] = {}) {
  const config = testConfig({ SESSION_SECRET: SECRET });
  const redis = overrides.redis ?? createFakeRedis();
  const db = (overrides.db as FakeDb) ?? new FakeDb();
  return { deps: makeTestDeps({ config, redis, db, ...overrides }), db, redis, config };
}

function postReq(body: unknown, cookie?: string) {
  return new Request(`http://x/v1/tokens/${TEST_ADDR}/comments`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ── user SIWE auth (the load-bearing new sub-piece) ─────────────────────────
describe("user SIWE auth (§12.63b)", () => {
  it("verifySiweLogin with a NULL allowlist admits any valid signer", async () => {
    const redis = createFakeRedis();
    const nonce = "abcdef1234567890";
    await redis.set(`siwe:nonce:${nonce}`, "1", { exSeconds: 600 });
    const other = "0x9999999999999999999999999999999999999999";
    const message = createSiweMessage({
      address: getAddress(other),
      chainId: 4663,
      domain: "robbed.test",
      nonce,
      uri: "https://robbed.test",
      version: "1",
    });
    // allowlist: null ⇒ an address on NO allowlist still logs in (user surface),
    // while the single-use nonce + signature checks still apply.
    const login = await verifySiweLogin(
      { message, signature: "0xdead" },
      { redis, allowlist: null, verify: async () => true, nowSec: 1_700_000_000 },
    );
    expect(login.address).toBe(other.toLowerCase());
  });

  it("user session cookie round-trips (issue → verify)", () => {
    const { cookieValue } = issueUserSession(SECRET, USER, 1000);
    expect(verifyUserSession(SECRET, cookieValue, 1001)?.addr).toBe(USER);
    // Wrong secret / tamper → null.
    expect(verifyUserSession("other", cookieValue, 1001)).toBeNull();
    expect(verifyUserSession(SECRET, `${cookieValue}x`, 1001)).toBeNull();
  });

  it("full flow: nonce → login (any signer) → session cookie → post comment", async () => {
    const { deps: d } = deps();
    const app = createApp(d);
    // 1) fetch a nonce
    const nonceRes = await app.request(new Request("http://x/v1/auth/nonce"));
    const nonce = (await readJson(nonceRes)).data.nonce as string;
    expect(nonce).toBeTruthy();
    // 2) sign an EIP-4361 message with a random key (NOT allowlisted anywhere)
    const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
    const message = createSiweMessage({
      address: getAddress(account.address),
      chainId: 4663,
      domain: "robbed.test",
      nonce,
      uri: "https://robbed.test",
      version: "1",
    });
    const signature = await account.signMessage({ message });
    // 3) login → Set-Cookie
    const loginRes = await app.request(
      new Request("http://x/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, signature }),
      }),
    );
    expect(loginRes.status).toBe(200);
    expect((await readJson(loginRes)).data.address).toBe(account.address.toLowerCase());
    const setCookie = loginRes.headers.get("Set-Cookie")!;
    expect(setCookie).toContain(USER_SESSION_COOKIE);
    expect(setCookie).toContain("HttpOnly");
    // 4) reuse the cookie to post a comment
    const cookie = setCookie.split(";")[0]!;
    const res = await app.request(postReq({ body: "gm" }, cookie));
    expect(res.status).toBe(201);
    expect((await readJson(res)).data.comment.author).toBe(account.address.toLowerCase());
  });
});

// ── comment routes ──────────────────────────────────────────────────────────
describe("POST /v1/tokens/:address/comments", () => {
  it("requires a signed-in session (401 without cookie)", async () => {
    const { deps: d } = deps();
    const res = await createApp(d).request(postReq({ body: "hi" }));
    expect(res.status).toBe(401);
  });

  it("creates a comment: author from session, tokenAddress from path, 201", async () => {
    const { deps: d, db } = deps();
    const res = await createApp(d).request(postReq({ body: "first!" }, userCookie()));
    expect(res.status).toBe(201);
    const comment = (await readJson(res)).data.comment;
    expect(comment.author).toBe(USER);
    expect(comment.tokenAddress).toBe(TEST_ADDR);
    expect(comment.body).toBe("first!");
    expect(comment.moderationStatus).toBe("visible");
    expect(db.comments.length).toBe(1);
  });

  it("ignores a client-injected author/tokenAddress (body-only trust)", async () => {
    const { deps: d } = deps();
    const res = await createApp(d).request(
      postReq(
        { body: "spoof", author: "0x9999999999999999999999999999999999999999", tokenAddress: "0xdead" },
        userCookie(),
      ),
    );
    expect(res.status).toBe(201);
    const comment = (await readJson(res)).data.comment;
    expect(comment.author).toBe(USER); // session, not the injected author
    expect(comment.tokenAddress).toBe(TEST_ADDR); // path, not the injected value
  });

  it("enforces COMMENT_BODY_MAX and rejects an empty body (400)", async () => {
    const { deps: d } = deps();
    const app = createApp(d);
    const over = await app.request(postReq({ body: "x".repeat(COMMENT_BODY_MAX + 1) }, userCookie()));
    expect(over.status).toBe(400);
    const empty = await app.request(postReq({ body: "" }, userCookie()));
    expect(empty.status).toBe(400);
    // exactly at the cap is accepted
    const atCap = await app.request(postReq({ body: "x".repeat(COMMENT_BODY_MAX) }, userCookie()));
    expect(atCap.status).toBe(201);
  });

  it("404s a comment on an unknown token", async () => {
    const { deps: d } = deps({ db: new FakeDb([]) });
    const res = await createApp(d).request(
      new Request("http://x/v1/tokens/0x2222222222222222222222222222222222222222/comments", {
        method: "POST",
        headers: { "content-type": "application/json", Cookie: userCookie() },
        body: JSON.stringify({ body: "hi" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rate-limits per author (429 past the window)", async () => {
    const { deps: d } = deps();
    const app = createApp(d);
    let last = 200;
    // The per-author window is 10/min (scaled ×1 in test env default). The 11th
    // POST in the same window is 429.
    for (let i = 0; i < 12; i++) {
      const res = await app.request(postReq({ body: `c${i}` }, userCookie()));
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe("GET /v1/tokens/:address/comments", () => {
  it("lists visible comments newest-first", async () => {
    const { deps: d, db } = deps();
    await db.insertComment({ tokenAddress: TEST_ADDR, author: USER, body: "old", moderationStatus: "visible", createdAt: 100 });
    await db.insertComment({ tokenAddress: TEST_ADDR, author: USER, body: "new", moderationStatus: "visible", createdAt: 200 });
    const res = await createApp(d).request(new Request(`http://x/v1/tokens/${TEST_ADDR}/comments`));
    expect(res.status).toBe(200);
    const { items, nextCursor } = (await readJson(res)).data;
    expect(items.map((c: { body: string }) => c.body)).toEqual(["new", "old"]);
    expect(nextCursor).toBeNull();
  });

  it("keyset-paginates newest-first across pages", async () => {
    const { deps: d, db } = deps();
    for (let i = 0; i < 3; i++)
      await db.insertComment({ tokenAddress: TEST_ADDR, author: USER, body: `c${i}`, moderationStatus: "visible", createdAt: 100 + i });
    const app = createApp(d);
    const p1 = await readJson(await app.request(new Request(`http://x/v1/tokens/${TEST_ADDR}/comments?limit=2`)));
    expect(p1.data.items.map((c: { body: string }) => c.body)).toEqual(["c2", "c1"]);
    expect(p1.data.nextCursor).toBeTruthy();
    const p2 = await readJson(
      await app.request(new Request(`http://x/v1/tokens/${TEST_ADDR}/comments?limit=2&cursor=${encodeURIComponent(p1.data.nextCursor)}`)),
    );
    expect(p2.data.items.map((c: { body: string }) => c.body)).toEqual(["c0"]);
    expect(p2.data.nextCursor).toBeNull();
  });

  it("excludes hidden comments; includes pending_review", async () => {
    const { deps: d, db } = deps();
    await db.insertComment({ tokenAddress: TEST_ADDR, author: USER, body: "visible", moderationStatus: "visible", createdAt: 300 });
    await db.insertComment({ tokenAddress: TEST_ADDR, author: USER, body: "pending", moderationStatus: "pending_review", createdAt: 200 });
    await db.insertComment({ tokenAddress: TEST_ADDR, author: USER, body: "hidden", moderationStatus: "hidden", createdAt: 100 });
    const res = await createApp(d).request(new Request(`http://x/v1/tokens/${TEST_ADDR}/comments`));
    const bodies = (await readJson(res)).data.items.map((c: { body: string }) => c.body);
    expect(bodies).toEqual(["visible", "pending"]);
    expect(bodies).not.toContain("hidden");
  });
});

// ── moderation-gated WS fanout ──────────────────────────────────────────────
describe("WS fanout — only VISIBLE comments broadcast", () => {
  function captureEvents(redis: Redis) {
    const msgs: unknown[] = [];
    void redis.subscribe(tokenEvents(TEST_ADDR), (m) => msgs.push(JSON.parse(m)));
    return msgs;
  }

  it("publishes a `comment` envelope for a visible comment", async () => {
    const { deps: d, redis } = deps();
    const msgs = captureEvents(redis);
    const res = await createApp(d).request(postReq({ body: "gm" }, userCookie()));
    expect(res.status).toBe(201);
    expect(msgs.length).toBe(1);
    const parsed = wsMessageSchema.parse(msgs[0]);
    expect(parsed.type).toBe("comment");
    if (parsed.type === "comment") {
      expect(parsed.data.body).toBe("gm");
      expect(parsed.data.author).toBe(USER);
      expect(parsed.data.tokenAddress).toBe(TEST_ADDR);
      // WS payload carries NO moderationStatus (visible by construction).
      expect("moderationStatus" in parsed.data).toBe(false);
    }
    expect(parsed.channel).toBe(tokenEvents(TEST_ADDR));
    expect(parsed.seq).toBe(1);
  });

  it("does NOT publish a hidden comment (moderation-gated)", async () => {
    const hidden: CommentModerator = {
      async moderate() {
        return { visibility: "hidden", reason: "test_hidden" };
      },
    };
    const { deps: d, redis, db } = deps({ commentModerator: hidden });
    const msgs = captureEvents(redis);
    const res = await createApp(d).request(postReq({ body: "bad" }, userCookie()));
    expect(res.status).toBe(201); // still created (moderation gates listing, not creation)
    expect((await readJson(res)).data.comment.moderationStatus).toBe("hidden");
    expect(db.comments.length).toBe(1);
    expect(msgs.length).toBe(0); // never broadcast
  });
});
