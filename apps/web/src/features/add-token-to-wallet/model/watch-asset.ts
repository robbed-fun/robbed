import { getAddress } from "viem";

import { publicWalletImageUrl } from "@/shared/lib/assets";

export interface WatchAssetProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface WatchAssetToken {
  address: string;
  ticker: string;
  imageUrl: string | null;
}

export interface WatchAssetOptions {
  address: string;
  symbol: string;
  decimals: number;
  image?: string;
}

export interface WatchAssetResult {
  requested: boolean;
  image: "included" | "omitted" | "retry-omitted";
}

const TOKEN_DECIMALS = 18;

export function buildWatchAssetParams(
  token: WatchAssetToken,
  publicAssetBaseUrl?: string,
): ["ERC20", WatchAssetOptions] {
  const options: WatchAssetOptions = {
    address: getAddress(token.address),
    symbol: token.ticker,
    decimals: TOKEN_DECIMALS,
  };
  const image = publicWalletImageUrl(token.imageUrl, publicAssetBaseUrl);
  if (image) options.image = image;
  return ["ERC20", options];
}

export async function requestWatchAsset(
  provider: WatchAssetProvider,
  token: WatchAssetToken,
): Promise<WatchAssetResult> {
  const params = buildWatchAssetParams(token);
  const withImage = params[1].image !== undefined;
  try {
    const result = await provider.request({ method: "wallet_watchAsset", params });
    return { requested: result === true, image: withImage ? "included" : "omitted" };
  } catch (err) {
    if (!withImage || !shouldRetryWithoutImage(err)) throw err;
    const { image: _image, ...withoutImage } = params[1];
    const result = await provider.request({
      method: "wallet_watchAsset",
      params: ["ERC20", withoutImage],
    });
    return { requested: result === true, image: "retry-omitted" };
  }
}

function shouldRetryWithoutImage(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? (err as { code?: unknown }).code : undefined;
  if (code === -32602) return true;
  const message = "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
  return /\bimage\b|\blogo\b|\burl\b/i.test(message);
}
