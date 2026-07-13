import type { TokenDetail } from "@robbed/shared";

import { TokenAddressLink } from "@/entities/token";
import { AddressLink, Divider, ExtLink, MonoLabel, MonoText } from "@/shared/ui";

/**
 * Token info panel (§5.2) — ROBBED_ terminal skin: description, external links,
 * contract + curve + pool Blockscout links, creator profile, created-at,
 * metadata JSON link. Server-safe (no client JS) so it is part of the SSR pitch.
 * External links are always `rel="noopener noreferrer"` (threat-model UM-5);
 * stored links are rendered as plain text hrefs (never dangerouslySetInnerHTML)
 * so a stored-link XSS cannot execute (web.md §8.2 stored-link XSS flow).
 */
export function TokenInfo({ token }: { token: TokenDetail }) {
  const links = token.links;
  const hasLinks = links && (links.website || links.x || links.telegram);
  return (
    // FLAT region (fidelity audit fix 1): no Card — the left column supplies
    // padding; the mockup's token-detail regions carry no panel borders/fills.
    <div className="flex flex-col gap-3">
      <MonoLabel size="2xs" className="text-text-tertiary">
        Token info
      </MonoLabel>

      {token.description && (
        <p className="whitespace-pre-wrap break-words text-sm text-text-secondary">
          {token.description}
        </p>
      )}

      {hasLinks && (
        <div className="flex flex-wrap gap-3 text-xs">
          {links.website && <ExtLink href={links.website} label="Website" />}
          {links.x && <ExtLink href={links.x} label="X" />}
          {links.telegram && <ExtLink href={links.telegram} label="Telegram" />}
        </div>
      )}

      <Divider />

      <dl className="flex flex-col gap-2 text-xs">
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
          <MonoText tone="muted">
            <TokenAddressLink address={token.creator.address} kind="address" tone="muted" />
            <span className="ml-1 text-faint">· {token.creator.tokensCreated} launched</span>
          </MonoText>
        </Row>
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <MonoLabel size="2xs">{label}</MonoLabel>
      <dd>{children}</dd>
    </div>
  );
}

// The https-only ExtLink guard (UM-5 defense-in-depth, 2026-07-12) was promoted
// to `shared/ui/ExtLink` so the faucet CTA shares the exact same guard (ERR-12).
