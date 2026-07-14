/**
 * Cursor keyset pagination (decide-it-yourself, api.md) round-trip,
 * tamper→400, limit clamp.
 */
import { describe, expect, it } from "bun:test";
import { ApiError } from "../src/lib/errors";
import { clampLimit, decodeCursor, encodeCursor } from "../src/lib/pagination";

const SECRET = "s3cr3t";

describe("cursor", () => {
  it("round-trips (sortKey, id)", () => {
    const c = { k: "12345", i: "0xabc" };
    const enc = encodeCursor(SECRET, c);
    expect(decodeCursor(SECRET, enc)).toEqual(c);
  });
  it("returns null for absent cursor", () => {
    expect(decodeCursor(SECRET, undefined)).toBeNull();
  });
  it("rejects a tampered payload with a 400 ApiError", () => {
    const enc = encodeCursor(SECRET, { k: "1", i: "a" });
    const tampered = enc.replace(/^./, enc[0] === "A" ? "B" : "A");
    let thrown: unknown;
    try {
      decodeCursor(SECRET, tampered);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).httpStatus).toBe(400);
  });
  it("rejects a cursor signed with a different secret", () => {
    const enc = encodeCursor("other", { k: "1", i: "a" });
    expect(() => decodeCursor(SECRET, enc)).toThrow(ApiError);
  });
});

describe("clampLimit", () => {
  it("defaults and caps", () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit("0")).toBe(50);
    expect(clampLimit("20")).toBe(20);
    expect(clampLimit("9999")).toBe(100);
  });
});
