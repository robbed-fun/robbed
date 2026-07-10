import type { TokenDetail } from "@robbed/shared";

import { AddressLink, Card } from "@/shared/ui";
import { shortAddress } from "@/shared/lib/format";

/**
 * Token info panel (§5.2): description, external links, contract + curve + pool
 * Blockscout links, creator profile, created-at, metadata JSON link. Server-safe
 * (no client JS) so it is part of the SSR pitch. External links are always
 * `rel="noopener noreferrer"` (threat-model UM-5); stored links are rendered as
 * plain text hrefs (never dangerouslySetInnerHTML) so a stored-link XSS cannot
 * execute (web.md §8.2 stored-link XSS flow).
 */
export function TokenInfo({ token }: { token: TokenDetail }) {
  const links = token.links;
  return (
    <Card className="flex flex-col gap-3 p-4">
      {token.description && (
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">
          {token.description}
        </p>
      )}

      {links && (links.website || links.x || links.telegram) && (
        <div className="flex flex-wrap gap-3 text-xs">
          {links.website && <ExtLink href={links.website} label="Website" />}
          {links.x && <ExtLink href={links.x} label="X" />}
          {links.telegram && <ExtLink href={links.telegram} label="Telegram" />}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <Row label="Contract">
          <AddressLink address={token.address} kind="token" />
        </Row>
        <Row label="Curve">
          <AddressLink address={token.curveAddress} kind="address" />
        </Row>
        {token.v3PoolAddress && (
          <Row label="V3 pool">
            <AddressLink address={token.v3PoolAddress} kind="address" />
          </Row>
        )}
        <Row label="Creator">
          <span className="font-mono text-muted-foreground">
            {shortAddress(token.creator.address)}
            <span className="ml-1">· {token.creator.tokensCreated} launched</span>
          </span>
        </Row>
      </dl>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
    >
      {label} ↗
    </a>
  );
}
