/**
 * M2-11 admin auth: stateless session cookie lifecycle + CSRF and the
 * SIWE login (allowlist + single-use nonce replay defense) with an injected
 * signature verifier (no real wallet needed).
 */
import { describe, expect, it } from "bun:test";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { csrfFor, issueSession, verifyCsrf, verifySession } from "../src/admin/session";
import { verifySiweLogin } from "../src/admin/siwe";
import { ApiError } from "../src/lib/errors";
import { createFakeRedis } from "../src/lib/redis";

const SECRET = "test-secret";
const ADDR = "0x1111111111111111111111111111111111111111";

describe("session cookie", () => {
  it("issues then verifies a valid session", () => {
    const { cookieValue } = issueSession(SECRET, ADDR, "nonce123", 1000);
    const payload = verifySession(SECRET, cookieValue, 1001);
    expect(payload?.addr).toBe(ADDR);
  });
  it("rejects an expired session", () => {
    const { cookieValue } = issueSession(SECRET, ADDR, "n", 1000);
    expect(verifySession(SECRET, cookieValue, 1000 + 13 * 3600)).toBeNull();
  });
  it("rejects a tampered cookie", () => {
    const { cookieValue } = issueSession(SECRET, ADDR, "n", 1000);
    expect(verifySession(SECRET, `${cookieValue}x`, 1001)).toBeNull();
  });
  it("binds CSRF to the session nonce", () => {
    const token = csrfFor(SECRET, "nonceABC");
    expect(verifyCsrf(SECRET, "nonceABC", token)).toBe(true);
    expect(verifyCsrf(SECRET, "other", token)).toBe(false);
    expect(verifyCsrf(SECRET, "nonceABC", undefined)).toBe(false);
  });
});

describe("SIWE login", () => {
  const nonce = "abcdef1234567890";
  function buildMessage() {
    return createSiweMessage({
      address: getAddress(ADDR),
      chainId: 4663,
      domain: "robbed.test",
      nonce,
      uri: "https://robbed.test",
      version: "1",
    });
  }
  const allowlist = new Set([ADDR.toLowerCase()]);

  it("verifies an allowlisted signer and burns the nonce", async () => {
    const redis = createFakeRedis();
    await redis.set(`siwe:nonce:${nonce}`, "1", { exSeconds: 600 });
    const login = await verifySiweLogin(
      { message: buildMessage(), signature: "0xdead" },
      { redis, allowlist, verify: async () => true },
    );
    expect(login.address).toBe(ADDR.toLowerCase());
    // Nonce consumed → replay fails.
    await expect(
      verifySiweLogin({ message: buildMessage(), signature: "0xdead" }, { redis, allowlist, verify: async () => true }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects an address not on the allowlist", async () => {
    const redis = createFakeRedis();
    await redis.set(`siwe:nonce:${nonce}`, "1", { exSeconds: 600 });
    await expect(
      verifySiweLogin({ message: buildMessage(), signature: "0xdead" }, { redis, allowlist: new Set(), verify: async () => true }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a bad signature", async () => {
    const redis = createFakeRedis();
    await redis.set(`siwe:nonce:${nonce}`, "1", { exSeconds: 600 });
    await expect(
      verifySiweLogin({ message: buildMessage(), signature: "0xdead" }, { redis, allowlist, verify: async () => false }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects an unknown nonce", async () => {
    const redis = createFakeRedis();
    await expect(
      verifySiweLogin({ message: buildMessage(), signature: "0xdead" }, { redis, allowlist, verify: async () => true }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
