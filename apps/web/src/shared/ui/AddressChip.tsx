import { shortAddress } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

/**
 * Shortened-address chip (ROBBED_ Phase F) — the header wallet chip
 * (`0x7fA3…c92E`) and inline address mentions: 12px mono muted, no border.
 * Display-only; explorer-linked addresses keep using `AddressLink` (which owns
 * the Blockscout URL logic). Optional `suffix` covers the mockup's
 * `0x7fA3…c92E · you`.
 */
export function AddressChip({
  address,
  suffix,
  className,
  ...props
}: React.ComponentProps<"span"> & { address: string; suffix?: string }) {
  return (
    <span
      className={cn("whitespace-nowrap text-sm text-muted tabular-nums", className)}
      title={address}
      {...props}
    >
      {shortAddress(address)}
      {suffix ? <span className="text-faint"> · {suffix}</span> : null}
    </span>
  );
}
