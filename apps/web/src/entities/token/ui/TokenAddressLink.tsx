import { explorer } from "@/shared/lib/chain";
import { shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * TokenAddressLink — a token/creator address rendered short (`0x7fA3…c92E`) as a
 * link to the block-explorer page for that address.
 *
 * The explorer origin is NEVER hardcoded (/ CLAUDE.md chain-facts) the
 * URL is built from the CHAIN CONFIG via `shared/lib/chain`'s `explorer` builder,
 * which reads `robinhoodChain.blockExplorers.default.url` — correct on mainnet
 * (4663) AND testnet (46630) from ONE build-time-selected chain object.
 *
 * `kind` picks the explorer path: `token` → `/token/{addr}` (the ERC-20 page),
 * `address` → `/address/{addr}` (an EOA, e.g. the creator). External anchor is
 * always `rel="noopener noreferrer"` (threat-model UM-5) and `stopPropagation`s so
 * a click inside a clickable card (`role="link"`) doesn't also navigate the card.
 *
 * `tone` fits it inline in the mono header ramp (default `faint`); it reads as
 * plain text until hover, then underlines — understated but discoverable.
 */

const TONE_CLASS = {
  default: "text-text",
  secondary: "text-text-secondary",
  muted: "text-muted",
  faint: "text-faint",
} as const;

export type TokenAddressLinkTone = keyof typeof TONE_CLASS;

export function TokenAddressLink({
  address,
  kind = "token",
  tone = "faint",
  className,
}: {
  address: string;
  kind?: "token" | "address";
  tone?: TokenAddressLinkTone;
  className?: string;
}) {
  const href = kind === "token" ? explorer.token(address) : explorer.address(address);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "font-mono tabular-nums underline-offset-2 transition-colors hover:text-text hover:underline",
        TONE_CLASS[tone],
        className,
      )}
    >
      {shortAddress(address)}
    </a>
  );
}
