import { explorer } from "@/shared/lib/chain";
import { shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Address rendered as a Blockscout link (spec §5.2 verify affordances). Uses the
 * chain-config explorer builder — no explorer origin is ever inlined (§2/§9).
 * External anchors are always `rel="noopener noreferrer"` (threat-model UM-5).
 */
export function AddressLink({
  address,
  kind = "address",
  label,
  className,
}: {
  address: string;
  kind?: "address" | "tx" | "token";
  label?: string;
  className?: string;
}) {
  const href =
    kind === "tx"
      ? explorer.tx(address)
      : kind === "token"
        ? explorer.token(address)
        : explorer.address(address);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "font-mono text-xs text-muted-foreground transition-colors hover:text-foreground",
        className,
      )}
    >
      {label ?? shortAddress(address)}
    </a>
  );
}
