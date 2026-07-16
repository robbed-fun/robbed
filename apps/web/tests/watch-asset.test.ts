import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  buildWatchAssetParams,
  requestWatchAsset,
  type WatchAssetProvider,
} from "@/features/add-token-to-wallet";

const HASH = "cd".repeat(32);
const TOKEN = {
  address: "0x00000000000000000000000000000000000000aa",
  ticker: "HOODIE",
  imageUrl: `http://localhost:4290/robbed-assets/images/${HASH}.webp`,
};

describe("wallet_watchAsset payload", () => {
  it("uses a checksummed address and rewrites legacy local images to a public HTTPS URL", () => {
    const params = buildWatchAssetParams(TOKEN, "https://api.robbed.fun/v1/assets");
    expect(params).toEqual([
      "ERC20",
      {
        address: getAddress(TOKEN.address),
        symbol: "HOODIE",
        decimals: 18,
        image: `https://api.robbed.fun/v1/assets/images/${HASH}.webp`,
      },
    ]);
  });

  it("omits wallet image when only a local object URL is available", () => {
    const params = buildWatchAssetParams(TOKEN, "http://localhost:4290/robbed-assets");
    expect(params[1]).toEqual({
      address: getAddress(TOKEN.address),
      symbol: "HOODIE",
      decimals: 18,
    });
  });

  it("retries without image when a wallet rejects the image field", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("invalid image url"), { code: -32602 }))
      .mockResolvedValueOnce(true);
    const provider: WatchAssetProvider = { request };

    const result = await requestWatchAsset(provider, {
      ...TOKEN,
      imageUrl: `https://api.robbed.fun/v1/assets/images/${HASH}.webp`,
    });

    expect(result).toEqual({ requested: true, image: "retry-omitted" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toEqual({
      method: "wallet_watchAsset",
      params: [
        "ERC20",
        {
          address: getAddress(TOKEN.address),
          symbol: "HOODIE",
          decimals: 18,
        },
      ],
    });
  });
});
