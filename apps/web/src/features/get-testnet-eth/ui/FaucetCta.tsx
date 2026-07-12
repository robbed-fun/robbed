"use client";

import { ExtLink } from "@/shared/ui";

import { buildFaucetUrl } from "../config/faucets";
import { useFaucetCta } from "../model/use-faucet-cta";

/**
 * Zero-balance faucet CTA banner — same terminal-mono banner family as the
 * wrong-network banner (dark-only, token colors, no raw values). Renders null
 * unless the testnet-target zero-balance trigger fires (see use-faucet-cta).
 *
 * Every link goes through the shared https-only `ExtLink` guard (ERR-12) with
 * `target="_blank" rel="noopener noreferrer"`; the official link carries the
 * connected address as `?address=` prefill.
 */
export function FaucetCta() {
  const cta = useFaucetCta();
  if (!cta.show || !cta.faucets) return null;
  return (
    <div
      data-testid="faucet-cta"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-border bg-green-dim/40 px-4 py-1.5 text-center text-xs text-text-secondary"
    >
      <span>0 ETH in this wallet on {cta.targetChainName}.</span>
      <ExtLink
        href={buildFaucetUrl(cta.faucets.official, cta.address)}
        label="Get testnet ETH"
        className="text-green hover:text-green"
      />
      <span className="text-faint">backups:</span>
      {cta.faucets.fallbacks.map((f) => (
        <ExtLink key={f.url} href={f.url} label={f.label} />
      ))}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={cta.dismiss}
        className="px-1 text-muted transition-colors hover:text-text"
      >
        ✕
      </button>
    </div>
  );
}
