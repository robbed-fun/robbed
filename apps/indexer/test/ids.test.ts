import { describe, expect, it } from "bun:test";
import { eventId, lower, positionLte } from "../src/ids";

describe("eventId — (tx_hash, log_index) idempotency key", () => {
  it("lowercases the tx hash and joins with the log index", () => {
    expect(eventId("0xABCDEF", 3)).toBe("0xabcdef-3");
  });
  it("is stable / deterministic per (tx,log)", () => {
    expect(eventId("0x11", 0)).toBe(eventId("0x11", 0));
    expect(eventId("0x11", 0)).not.toBe(eventId("0x11", 1));
  });
});

describe("positionLte — high-water guard comparator", () => {
  it("orders by block then log", () => {
    expect(positionLte(5, 2, 5, 2)).toBe(true); // equal → at/behind
    expect(positionLte(5, 1, 5, 2)).toBe(true);
    expect(positionLte(5, 3, 5, 2)).toBe(false);
    expect(positionLte(4, 9, 5, 0)).toBe(true); // earlier block wins
    expect(positionLte(6, 0, 5, 9)).toBe(false);
  });
});

describe("lower", () => {
  it("lowercases addresses", () => {
    expect(lower("0xAbCd")).toBe("0xabcd");
  });
});
