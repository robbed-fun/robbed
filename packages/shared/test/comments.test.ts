/**
 * Comments (Phase-2 "final version" — off-chain, SIWE-authored, §8.4-moderation-
 * gated, per-token; spec §12.63b). Covers the shared type layer ONLY (robbed-shared):
 * the entity, the request/response DTOs, the keyset-paginated list, and the WS
 * `comment` fanout event — plus the REST↔WS no-drift guarantee.
 */
import { describe, expect, it } from "bun:test";
import {
  type Comment,
  commentListQuerySchema,
  commentResponseSchema,
  commentSchema,
  commentsResponseSchema,
  postCommentRequestSchema,
} from "../src/api-types";
import {
  commentBaseSchema,
  commentBodySchema,
  wsCommentDataSchema,
  wsMessageSchema,
  type WsCommentData,
} from "../src/ws-messages";
import { COMMENT_BODY_MAX, PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from "../src/constants";

const ADDR = "0x" + "ab".repeat(20);
const OTHER = "0x" + "cd".repeat(20);

const base = {
  id: "c_01HZ",
  tokenAddress: ADDR,
  author: OTHER,
  body: "gm, wagmi",
  createdAt: 1767950000,
} as const;

const comment = { ...base, moderationStatus: "visible" } as const;

// ── Type-level no-drift lock: the WS payload is the REST comment minus moderation ─
// Fails `tsc --noEmit` (package `typecheck` script) if the base/extend relationship
// ever drifts — the strongest single-source guarantee available at compile time.
type Expect<T extends true> = T;
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type _WsIsCommentMinusModeration = Expect<
  Equal<WsCommentData, Omit<Comment, "moderationStatus">>
>;

describe("commentSchema (entity)", () => {
  it("parses a valid comment", () => {
    expect(commentSchema.safeParse(comment).success).toBe(true);
  });

  it("reuses moderationVisibilitySchema — visible/pending_review/hidden only", () => {
    for (const moderationStatus of ["visible", "pending_review", "hidden"] as const) {
      expect(commentSchema.safeParse({ ...base, moderationStatus }).success).toBe(true);
    }
    expect(commentSchema.safeParse({ ...base, moderationStatus: "deleted" }).success).toBe(false);
    // moderationStatus is required on the persisted entity
    expect(commentSchema.safeParse(base).success).toBe(false);
  });

  it("author + tokenAddress must be lowercase 0x addresses", () => {
    expect(commentSchema.safeParse({ ...comment, author: "0xnothex" }).success).toBe(false);
    expect(commentSchema.safeParse({ ...comment, tokenAddress: ADDR.toUpperCase() }).success).toBe(
      false,
    );
  });

  it("is NOT a chain event — carries no confirmationState", () => {
    expect("confirmationState" in commentSchema.shape).toBe(false);
  });
});

describe("comment body bound (COMMENT_BODY_MAX, single-sourced)", () => {
  it("accepts 1..MAX code units, rejects empty and over-cap", () => {
    expect(commentBodySchema.safeParse("").success).toBe(false);
    expect(commentBodySchema.safeParse("x").success).toBe(true);
    expect(commentBodySchema.safeParse("x".repeat(COMMENT_BODY_MAX)).success).toBe(true);
    expect(commentBodySchema.safeParse("x".repeat(COMMENT_BODY_MAX + 1)).success).toBe(false);
  });

  it("the entity body uses the same bound", () => {
    expect(commentSchema.safeParse({ ...comment, body: "" }).success).toBe(false);
    expect(
      commentSchema.safeParse({ ...comment, body: "x".repeat(COMMENT_BODY_MAX + 1) }).success,
    ).toBe(false);
  });
});

describe("postCommentRequestSchema (body only — SIWE author, path token)", () => {
  it("accepts { body }", () => {
    expect(postCommentRequestSchema.safeParse({ body: "hello" }).success).toBe(true);
  });

  it("STRIPS a client-supplied author / tokenAddress (never trusted)", () => {
    const parsed = postCommentRequestSchema.parse({
      body: "hello",
      author: ADDR, // attacker tries to spoof identity
      tokenAddress: ADDR,
      id: "forged",
      moderationStatus: "visible",
    });
    expect(parsed).toEqual({ body: "hello" });
  });

  it("rejects an empty or over-cap body", () => {
    expect(postCommentRequestSchema.safeParse({ body: "" }).success).toBe(false);
    expect(
      postCommentRequestSchema.safeParse({ body: "x".repeat(COMMENT_BODY_MAX + 1) }).success,
    ).toBe(false);
  });
});

describe("response DTOs (reuse existing envelopes)", () => {
  it("commentResponseSchema wraps the created comment", () => {
    expect(commentResponseSchema.safeParse({ comment }).success).toBe(true);
    expect(commentResponseSchema.safeParse({ comment: base }).success).toBe(false); // no moderationStatus
  });

  it("commentsResponseSchema is the shared { items, nextCursor } keyset page", () => {
    expect(
      commentsResponseSchema.safeParse({ items: [comment, comment], nextCursor: "opaqueCursor" })
        .success,
    ).toBe(true);
    expect(commentsResponseSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(commentsResponseSchema.safeParse({ items: [base], nextCursor: null }).success).toBe(
      false,
    );
  });

  it("commentListQuerySchema clamps limit via the shared listLimitSchema", () => {
    expect(commentListQuerySchema.parse({}).limit).toBe(PAGE_LIMIT_DEFAULT);
    expect(commentListQuerySchema.parse({ limit: "10000" }).limit).toBe(PAGE_LIMIT_MAX);
    expect(commentListQuerySchema.parse({ cursor: "abc", limit: "25" })).toEqual({
      cursor: "abc",
      limit: 25,
    });
  });
});

describe("WS `comment` event (ws-messages union)", () => {
  const msg = {
    v: 1,
    type: "comment",
    channel: `token:${ADDR}:events`,
    seq: 7,
    ts: 1767950000000,
    data: base, // base = comment minus moderationStatus
  } as const;

  it("parses through the discriminated union", () => {
    expect(wsMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("data equals the shared base (gated fanout carries no moderationStatus)", () => {
    expect(wsCommentDataSchema.safeParse(base).success).toBe(true);
    expect("moderationStatus" in wsCommentDataSchema.shape).toBe(false);
    // and the base + moderationStatus is a valid persisted comment (superset)
    expect(commentSchema.safeParse({ ...base, moderationStatus: "visible" }).success).toBe(true);
    expect(commentBaseSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a comment message with a non-decimal/hex-broken address in data", () => {
    expect(
      wsMessageSchema.safeParse({ ...msg, data: { ...base, author: "0xZZ" } }).success,
    ).toBe(false);
  });
});
