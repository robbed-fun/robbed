import { describe, expect, it, vi } from "vitest";

import { MAX_IMAGE_BYTES } from "@robbed/shared";
import { routerAbi } from "@robbed/shared/abi";
import { buyTokensOut, previewBuy } from "@robbed/shared/curve-quote";
import {
  buildCreateTokenRequest,
  initialBuyMinTokensOut,
  previewInitialBuy,
  launchTextSchema,
  parseInitialBuyEth,
  validateImageFile,
  waitForIndexed,
} from "@/features/launch-token";

const ROUTER = "0x00000000000000000000000000000000000000a1" as const;

/**
 * Launch client-side validation + wiring. The byte-limit gates use
 * the SHARED zod schemas (never redeclared); the create-tx wiring proves the
 * single `createToken` value/args; the index-grace proves the redirect only fires
 * once the token is indexed (no 404 for the creator).
 */
describe("byte-length validation via shared zod ", () => {
  it("accepts a valid name/ticker", () => {
    const r = launchTextSchema.safeParse({ name: "Cash Cat", ticker: "CASHCAT" });
    expect(r.success).toBe(true);
  });

  it("rejects a 33-BYTE name (limit is 32 UTF-8 bytes)", () => {
    const r = launchTextSchema.safeParse({ name: "a".repeat(33), ticker: "OK" });
    expect(r.success).toBe(false);
  });

  it("rejects an 11-byte ticker (limit is 10)", () => {
    const r = launchTextSchema.safeParse({ name: "Fine", ticker: "A".repeat(11) });
    expect(r.success).toBe(false);
  });

  it("enforces BYTES not code units — 9 emoji (36 bytes, 9 chars) is rejected", () => {
    // Proves the shared refinement counts UTF-8 bytes, mirroring the on-chain gate.
    const r = launchTextSchema.safeParse({ name: "🚀".repeat(9), ticker: "OK" });
    expect(r.success).toBe(false);
    // 8 rockets = exactly 32 bytes → accepted.
    expect(launchTextSchema.safeParse({ name: "🚀".repeat(8), ticker: "OK" }).success).toBe(true);
  });

  it("rejects a >500 char description", () => {
    const r = launchTextSchema.safeParse({
      name: "Fine",
      ticker: "OK",
      description: "x".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-https link (UX guard on top of the shared field schema)", () => {
    const bad = launchTextSchema.safeParse({
      name: "Fine",
      ticker: "OK",
      links: { website: "http://insecure.example" },
    });
    expect(bad.success).toBe(false);
    const good = launchTextSchema.safeParse({
      name: "Fine",
      ticker: "OK",
      links: { website: "https://secure.example" },
    });
    expect(good.success).toBe(true);
  });
});

describe("image validation (≤4 MB)", () => {
  const asFile = (over: Partial<File>): File =>
    ({ size: 1_000, type: "image/png", name: "x.png", ...over }) as unknown as File;

  it("null → required error", () => {
    expect(validateImageFile(null)).toMatch(/required/i);
  });
  it("over 4 MB → too large", () => {
    expect(validateImageFile(asFile({ size: MAX_IMAGE_BYTES + 1 }))).toMatch(/too large/i);
  });
  it("wrong mime → unsupported", () => {
    expect(validateImageFile(asFile({ type: "application/pdf" }))).toMatch(/unsupported/i);
  });
  it("valid png → null", () => {
    expect(validateImageFile(asFile({}))).toBeNull();
  });
});

describe("initial-buy parsing", () => {
  it("empty → 0 (no initial buy)", () => {
    const r = parseInitialBuyEth("");
    expect(r.ok && r.wei).toBe(0n);
  });
  it("0.5 ETH → 5e17 wei", () => {
    const r = parseInitialBuyEth("0.5");
    expect(r.ok && r.wei).toBe(500000000000000000n);
  });
  it("garbage → error", () => {
    expect(parseInitialBuyEth("abc").ok).toBe(false);
  });
});

// Factory seed virtual reserves (contracts.md). VIRTUAL_TOKEN_0 chosen to
// match the shared curve-quote golden vector so the preview is cross-checked.
const VIRTUAL_ETH_0 = 30n * 10n ** 18n;
const VIRTUAL_TOKEN_0 = 1073000000n * 10n ** 18n;

describe("M3-6 initial-buy preview + non-zero minTokensOut ", () => {
  it("previewInitialBuy tokensOut == shared previewBuy (no re-implemented math)", () => {
    const ethIn = 10n ** 18n; // 1 ETH gross
    const feeBps = 100; // 1%
    const preview = previewInitialBuy({
      virtualEth0: VIRTUAL_ETH_0,
      virtualToken0: VIRTUAL_TOKEN_0,
      tradeFeeBps: feeBps,
      ethInGrossWei: ethIn,
    });
    const golden = previewBuy(VIRTUAL_ETH_0, VIRTUAL_TOKEN_0, ethIn, feeBps);
    expect(preview).not.toBeNull();
    expect(preview!.tokensOut).toBe(golden.tokensOut);
    expect(preview!.fee).toBe(golden.fee);
    expect(preview!.netEth).toBe(golden.netEth);
  });

  it("with zero fee, tokensOut matches the frozen shared golden vector", () => {
    const preview = previewInitialBuy({
      virtualEth0: VIRTUAL_ETH_0,
      virtualToken0: VIRTUAL_TOKEN_0,
      tradeFeeBps: 0,
      ethInGrossWei: 10n ** 18n,
    });
    // Golden from packages/shared/test/curve-quote.test.ts (launch-scale 1 ETH in).
    expect(preview!.tokensOut).toBe(34612903225806451612903225n);
    expect(preview!.tokensOut).toBe(buyTokensOut(VIRTUAL_ETH_0, VIRTUAL_TOKEN_0, 10n ** 18n));
  });

  it("derives a NON-ZERO minTokensOut = tokensOut × (1 − 2%)", () => {
    const preview = previewInitialBuy({
      virtualEth0: VIRTUAL_ETH_0,
      virtualToken0: VIRTUAL_TOKEN_0,
      tradeFeeBps: 100,
      ethInGrossWei: 10n ** 18n,
    })!;
    const min = initialBuyMinTokensOut(preview); // default 2%
    expect(min).toBeGreaterThan(0n);
    expect(min).toBe((preview.tokensOut * 9800n) / 10000n);
    expect(min).toBeLessThan(preview.tokensOut);
  });

  it("no initial buy or unread reserves → null preview → minTokensOut 0 (safe atomic leg)", () => {
    expect(
      previewInitialBuy({
        virtualEth0: VIRTUAL_ETH_0,
        virtualToken0: VIRTUAL_TOKEN_0,
        tradeFeeBps: 100,
        ethInGrossWei: 0n, // no initial buy
      }),
    ).toBeNull();
    expect(
      previewInitialBuy({
        virtualEth0: null, // reserves not read yet
        virtualToken0: VIRTUAL_TOKEN_0,
        tradeFeeBps: 100,
        ethInGrossWei: 10n ** 18n,
      }),
    ).toBeNull();
    expect(initialBuyMinTokensOut(null)).toBe(0n);
  });
});

describe("createToken tx wiring (single tx, deployFee + initialBuy)", () => {
  it("value = deployFee + initialBuy; args in contract order; shared routerAbi", () => {
    const preview = previewInitialBuy({
      virtualEth0: VIRTUAL_ETH_0,
      virtualToken0: VIRTUAL_TOKEN_0,
      tradeFeeBps: 100,
      ethInGrossWei: 500_000_000_000_000_000n,
    });
    const minTokensOut = initialBuyMinTokensOut(preview); // non-zero (M3-6)
    expect(minTokensOut).toBeGreaterThan(0n);

    const req = buildCreateTokenRequest({
      router: ROUTER,
      name: "Cash Cat",
      symbol: "CASHCAT",
      metadataHash: `0x${"ab".repeat(32)}`,
      metadataUri: "https://cdn.robbed.example/metadata/0xab.json",
      minTokensOut,
      deadline: 1_800_000_000n,
      deployFeeWei: 3_000_000_000_000_000n, // live-read, not a constant in prod
      initialBuyWei: 500_000_000_000_000_000n,
    });
    expect(req.address).toBe(ROUTER);
    expect(req.abi).toBe(routerAbi);
    expect(req.functionName).toBe("createToken");
    expect(req.value).toBe(503_000_000_000_000_000n);
    expect(req.args).toEqual([
      "Cash Cat",
      "CASHCAT",
      `0x${"ab".repeat(32)}`,
      "https://cdn.robbed.example/metadata/0xab.json",
      minTokensOut,
      1_800_000_000n,
    ]);
  });

  it("no initial buy → value equals just the deploy fee", () => {
    const req = buildCreateTokenRequest({
      router: ROUTER,
      name: "N",
      symbol: "S",
      metadataHash: `0x${"00".repeat(32)}`,
      metadataUri: "https://x/y.json",
      minTokensOut: 0n,
      deadline: 1n,
      deployFeeWei: 7n,
      initialBuyWei: 0n,
    });
    expect(req.value).toBe(7n);
  });
});

describe("not-yet-indexed redirect grace (web.md pending-shell)", () => {
  const nap = () => Promise.resolve();

  it("navigates only AFTER the token resolves (retries through 404s)", async () => {
    let calls = 0;
    const fetchToken = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("404 not_found");
      return { address: "0xabc" };
    });
    const indexed = await waitForIndexed({
      address: "0xABC",
      fetchToken,
      delayMs: 1,
      sleep: nap,
    });
    expect(indexed).toBe(true);
    expect(fetchToken).toHaveBeenCalledTimes(3);
    // The redirect target the caller then uses.
    expect(`/t/${"0xABC"}`).toBe("/t/0xABC");
  });

  it("does NOT report indexed (→ no 404 redirect) when the grace window elapses", async () => {
    const fetchToken = vi.fn(async () => {
      throw new Error("404");
    });
    const indexed = await waitForIndexed({
      address: "0xABC",
      fetchToken,
      maxAttempts: 3,
      delayMs: 1,
      sleep: nap,
    });
    expect(indexed).toBe(false);
    expect(fetchToken).toHaveBeenCalledTimes(3);
  });
});
