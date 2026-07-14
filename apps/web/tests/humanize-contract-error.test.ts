import { bondingCurveAbi, curveFactoryAbi, routerAbi } from "@robbed/shared/abi";
import {
  BaseError,
  ContractFunctionRevertedError,
  concatHex,
  decodeErrorResult,
  encodeAbiParameters,
  encodeErrorResult,
  parseEther,
  toFunctionSelector,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  ALL_ERRORS_ABI,
  humanizeContractError,
} from "@/shared/lib/humanize-contract-error";

/**
 * The central contract-error humanizer (apps/web/src/shared/lib). The motivating
 * bug: `Router.createToken` nests a `BondingCurve.buy()` whose
 * `EarlyBuyCapExceeded` (selector 0xc9c00910) is NOT in the router/factory call
 * ABI, so viem leaves `.data` undefined and only fills `.raw` → the old code
 * leaked the bare selector. These tests prove the nested selector now decodes
 * against the MERGED all-contracts error ABI and humanizes to the cap message.
 */

/** Build the viem error viem itself throws when the raw selector is NOT in the
 * call ABI (the nested-error scenario): `.data` stays undefined, `.raw` is set. */
function nestedRevert(rawData: `0x${string}`, functionName = "createToken") {
  // Pass an ABI that lacks the selector (factory ABI has no BondingCurve errors),
  // exactly reproducing production: viem can't decode → .data undefined, .raw set.
  return new ContractFunctionRevertedError({
    abi: curveFactoryAbi,
    data: rawData,
    functionName,
  });
}

describe("humanize-contract-error · merged ABI + nested decode", () => {
  it("merged ABI aggregates every contract's error fragments, deduped", () => {
    const names = new Set(ALL_ERRORS_ABI.map((e) => (e as { name: string }).name));
    // representative errors from DIFFERENT contracts must all be present
    for (const n of [
      "EarlyBuyCapExceeded", // BondingCurve
      "DeadlineExpired", // Router
      "CreatesPaused", // CurveFactory
      "PoolPriceUnrecoverable", // V3Migrator
      "NotMigrator", // LPFeeVault
      "NotCurve", // CreatorVault (also others — deduped)
      "OwnableUnauthorizedAccount", // OZ Ownable
    ]) {
      expect(names.has(n), `merged ABI missing ${n}`).toBe(true);
    }
    // dedupe: NotCurve appears in 3 contracts but exactly once here
    const notCurve = ALL_ERRORS_ABI.filter((e) => (e as { name: string }).name === "NotCurve");
    expect(notCurve.length).toBe(1);
  });

  it("EarlyBuyCapExceeded selector is 0xc9c00910 and decodes off the merged ABI", () => {
    expect(toFunctionSelector("EarlyBuyCapExceeded(uint256,uint256)")).toBe("0xc9c00910");
    const raw = encodeErrorResult({
      abi: bondingCurveAbi,
      errorName: "EarlyBuyCapExceeded",
      args: [parseEther("0.2"), parseEther("0.05")],
    });
    expect(raw.startsWith("0xc9c00910")).toBe(true);
    // sanity decode proof — merged ABI resolves the nested selector
    const decoded = decodeErrorResult({ abi: ALL_ERRORS_ABI, data: raw });
    expect(decoded.errorName).toBe("EarlyBuyCapExceeded");
    expect(decoded.args?.[1]).toBe(parseEther("0.05"));
  });

  it("humanizes the nested EarlyBuyCapExceeded revert to the cap message (the bug)", () => {
    const raw = encodeErrorResult({
      abi: bondingCurveAbi,
      errorName: "EarlyBuyCapExceeded",
      args: [parseEther("0.2"), parseEther("0.05")],
    });
    const err = nestedRevert(raw);
    // proves production shape: viem could NOT decode against the factory ABI
    expect(err.data).toBeUndefined();
    expect(err.raw).toBe(raw);

    const msg = humanizeContractError(err);
    expect(msg).toContain("anti-snipe cap is 0.05 ETH");
    expect(msg).toContain("Lower your first buy");
    // the bare selector never leaks
    expect(msg).not.toContain("0xc9c00910");
  });
});

describe("humanize-contract-error · mapped messages + args", () => {
  it("SlippageExceeded → price-moved copy", () => {
    const raw = encodeErrorResult({
      abi: bondingCurveAbi,
      errorName: "SlippageExceeded",
      args: [1n, 2n],
    });
    expect(humanizeContractError(nestedRevert(raw, "buy"))).toMatch(/past your slippage/i);
  });

  it("DeadlineExpired → default retry copy; trade override wins", () => {
    const raw = encodeErrorResult({ abi: routerAbi, errorName: "DeadlineExpired", args: [] });
    expect(humanizeContractError(nestedRevert(raw, "buy"))).toBe("Deadline expired — retry.");
    expect(
      humanizeContractError(nestedRevert(raw, "buy"), {
        overrides: { DeadlineExpired: "Trade deadline expired — refresh the quote." },
      }),
    ).toBe("Trade deadline expired — refresh the quote.");
  });

  it("BuysPaused reassures that selling stays available", () => {
    const raw = encodeErrorResult({ abi: routerAbi, errorName: "BuysPaused", args: [] });
    expect(humanizeContractError(nestedRevert(raw, "buy"))).toMatch(/selling stays available/i);
  });

  it("internal/access-control errors get a short named message", () => {
    const raw = encodeErrorResult({ abi: routerAbi, errorName: "EthTransferFailed", args: [] });
    expect(humanizeContractError(nestedRevert(raw))).toBe(
      "Unexpected contract error (EthTransferFailed) — please retry or report.",
    );
  });

  it("OwnableUnauthorizedAccount → authorization copy", () => {
    const raw = encodeErrorResult({
      abi: curveFactoryAbi,
      errorName: "OwnableUnauthorizedAccount",
      args: ["0x0000000000000000000000000000000000000001"],
    });
    expect(humanizeContractError(nestedRevert(raw))).toMatch(/not authorized/i);
  });
});

describe("humanize-contract-error · wallet + reason fallbacks", () => {
  it("user rejection → default copy, overridable per site", () => {
    const rejected = new BaseError("User rejected the request.");
    expect(humanizeContractError(rejected)).toBe("Transaction rejected in wallet.");
    expect(
      humanizeContractError(rejected, {
        rejectionMessage: "Claim rejected in wallet.",
      }),
    ).toBe("Claim rejected in wallet.");
  });

  it("Orbit 'transaction too old' reason → deadline message", () => {
    const data = concatHex([
      toFunctionSelector("Error(string)"),
      encodeAbiParameters([{ type: "string" }], ["transaction too old"]),
    ]);
    const err = new ContractFunctionRevertedError({ abi: [], data, functionName: "buy" });
    expect(err.reason).toBe("transaction too old");
    expect(humanizeContractError(err)).toBe("Deadline expired — retry.");
  });

  it("Uniswap V3 'Too little received' reason → slippage message", () => {
    const data = concatHex([
      toFunctionSelector("Error(string)"),
      encodeAbiParameters([{ type: "string" }], ["Too little received"]),
    ]);
    const err = new ContractFunctionRevertedError({ abi: [], data, functionName: "exactInputSingle" });
    expect(humanizeContractError(err)).toMatch(/past your slippage/i);
  });

  it("a non-revert failure surfaces its concise message, truncated", () => {
    const plain = new Error("network request failed");
    expect(humanizeContractError(plain)).toBe("network request failed");
    const huge = new Error("x".repeat(400));
    expect(humanizeContractError(huge).length).toBeLessThanOrEqual(180);
    expect(humanizeContractError(huge).endsWith("…")).toBe(true);
  });
});
