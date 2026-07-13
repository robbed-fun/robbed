import { getDeployment } from "@robbed/shared/addresses";

/**
 * Official testnet faucet endpoints — TESTNET-TARGET-ONLY config (FSD slice
 * `config` segment). Values are TRANSCRIBED from official sources, never
 * invented (§2/§13): spec §12.52 + docs/developers/runbooks/testnet.md §1/§3
 * (docs.robinhood.com/chain/connecting + Robinhood support article, retrieved
 * 2026-07-11; Chainlink/QuickNode fallbacks verified to target 46630).
 *
 * Resolution is DOUBLE-GATED: the target chain's registry entry must be
 * `mode === "testnet"` AND have an entry here — so mainnet (4663, mode live)
 * and local (31337) builds never surface a faucet, and a future testnet chain
 * without a recorded official faucet shows nothing rather than a guessed URL.
 * All links render through the shared https-only `ExtLink` guard (ERR-12).
 */
export interface FaucetLinks {
  /** Official faucet — supports `?address=` prefill (verified live 2026-07-12). */
  official: string;
  /** Verified fallback faucets targeting the same chain (runbook §3). */
  fallbacks: readonly { label: string; url: string }[];
}

const FAUCETS_BY_CHAIN: Record<number, FaucetLinks> = {
  46630: {
    official: "https://faucet.testnet.chain.robinhood.com",
    fallbacks: [
      { label: "Chainlink faucet", url: "https://faucets.chain.link/robinhood-testnet" },
      { label: "QuickNode faucet", url: "https://faucet.quicknode.com/robinhood/testnet" },
    ],
  },
};

/** Faucet set for `chainId`, or null unless it is a registered TESTNET chain with official links. */
export function faucetsFor(chainId: number): FaucetLinks | null {
  if (getDeployment(chainId)?.mode !== "testnet") return null;
  return FAUCETS_BY_CHAIN[chainId] ?? null;
}

/**
 * Official-faucet deep link with the connected address prefilled
 * (`?address=0x…`). Built via the URL API so the query composes safely; no
 * address ⇒ the bare faucet URL.
 */
export function buildFaucetUrl(official: string, address?: string): string {
  const url = new URL(official);
  if (address) url.searchParams.set("address", address);
  return url.toString();
}
