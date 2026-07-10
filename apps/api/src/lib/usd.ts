/**
 * USD projection (api.md §2 hard rule, spec §2): every USD figure is computed at
 * request time from the latest `eth_usd_snapshots` row — NEVER a constant. Ships
 * as `{ usd, ethUsd, asOf }` with `stale: true` added when the snapshot is older
 * than `USD_STALE_AFTER_SECONDS`.
 */
import { USD_STALE_AFTER_SECONDS, type UsdValue } from "@robbed/shared";

export interface EthUsdSnapshot {
  price_usd: number;
  /** ISO-8601 (timestamptz). */
  fetched_at: string;
}

const WEI_PER_ETH = 10n ** 18n;

function build(ethAmount: number, snap: EthUsdSnapshot, nowMs: number): UsdValue {
  const usd = ethAmount * snap.price_usd;
  const ageSec = (nowMs - Date.parse(snap.fetched_at)) / 1000;
  const value: UsdValue = {
    usd: Number.isFinite(usd) ? usd.toString() : "0",
    ethUsd: snap.price_usd.toString(),
    asOf: snap.fetched_at,
  };
  if (ageSec > USD_STALE_AFTER_SECONDS) value.stale = true;
  return value;
}

/** USD value of a float ETH amount (e.g. mcap in ETH). */
export function usdFromEthFloat(
  ethAmount: number,
  snap: EthUsdSnapshot,
  nowMs: number = Date.now(),
): UsdValue {
  return build(ethAmount, snap, nowMs);
}

/** USD value of a wei ETH amount (decimal string or bigint). */
export function usdFromWei(
  wei: bigint | string,
  snap: EthUsdSnapshot,
  nowMs: number = Date.now(),
): UsdValue {
  const asBig = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  // Convert to float ETH with full-integer + fractional parts to avoid overflow.
  const whole = asBig / WEI_PER_ETH;
  const frac = asBig % WEI_PER_ETH;
  const eth = Number(whole) + Number(frac) / 1e18;
  return build(eth, snap, nowMs);
}
