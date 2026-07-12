import { cn } from "@/shared/lib/utils";

/**
 * HTTPS-only external-link guard (ERR-12 / UM-5 allowlist), promoted to
 * `shared/ui` from the Token Detail info card so every external-destination
 * surface (creator links, faucet CTAs) shares ONE guard: a stored/configured
 * href is only ever rendered as an anchor when it parses as an absolute
 * `https:` URL. Anything else — `javascript:`, `data:`, `http:`,
 * relative/malformed strings — renders as inert text, so a hostile link can
 * never become a clickable non-https destination even if upstream validation
 * were bypassed.
 */
export function isHttpsUrl(href: string): boolean {
  try {
    return new URL(href).protocol === "https:";
  } catch {
    return false;
  }
}

export function ExtLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  if (!isHttpsUrl(href)) {
    return <span className="text-faint">{label}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-text",
        className,
      )}
    >
      {label} ↗
    </a>
  );
}
