"use client";

import type { TokenDetail } from "@robbed/shared";
import type { ColumnDef } from "@tanstack/react-table";
import { type ReactNode, useMemo } from "react";

import { TokenAddressLink } from "@/entities/token";
import { AddressLink, DataTable, Divider, ExtLink, MonoLabel, MonoText } from "@/shared/ui";

/**
 * Token info panel — ROBBED_ terminal skin: description, external links, then a
 * key-value table (contract + curve + optional V3 pool Blockscout links, creator
 * profile) rendered through the shared `DataTable` so this lower-left column
 * reads identically to its sibling `HolderTable` / `TradeFeed` (same TableLabel
 * title, `border-border-soft py-1.5 text-xs` rows). It is a KEY-VALUE table, so
 * there is no column header row (renderHeader omitted), no `meta`, no pagination.
 *
 * CLIENT (no longer server-only): `DataTable` is a client component (TanStack
 * Table wrapper), so this file is `"use client"`. The description and links
 * still render on the client — they are not gated on any data fetch, so the
 * SSR'd markup is unchanged for the OG/share pitch.
 *
 * External links are always `rel="noopener noreferrer"` (threat-model UM-5);
 * stored links are rendered as plain text hrefs (never dangerouslySetInnerHTML)
 * so a stored-link XSS cannot execute (web.md stored-link XSS flow).
 *
 * LP-DESTINY LINE REMOVED (USER-DIRECTED 2026-07-14, D-74): the muted
 * `LP_DESTINY_COPY` footnote that used to close this panel is gone — the D-14
 * LP-copy sentence is no longer a required render on /t/[address]. This is a
 * UI-disclosure change only: LP stays permanently locked on-chain and the API
 * still returns `trust.lpCopy` (`@robbed/shared` `LP_COPY`), so the guarantee
 * stays on-chain- and API-verifiable. The single-constant + forbidden-LP-verb
 * wording rules still govern any LP surface that DOES render the sentence
 * (`.claude/rules/lp-copy.md`).
 */

/** One key-value row of the info table (`value` is arbitrary link/text markup). */
interface InfoRow {
  id: string;
  label: string;
  value: ReactNode;
}

/**
 * Shared 2-track grid for every row (label auto, value fills + right-aligns).
 * No header variant — a key-value table carries no column headings.
 */
const GRID = "grid grid-cols-[auto_1fr] items-center gap-x-2";

/**
 * Module-const columns (DataTable stable-reference contract). Two columns —
 * label, then a right-aligned value — with no `header` fn (no header row).
 */
const infoColumns: ColumnDef<InfoRow>[] = [
  {
    id: "label",
    cell: ({ row }) => <MonoLabel size="2xs">{row.original.label}</MonoLabel>,
  },
  {
    id: "value",
    cell: ({ row }) => <div className="min-w-0 text-right">{row.original.value}</div>,
  },
];

export function TokenInfo({ token }: { token: TokenDetail }) {
  const links = token.links;
  const hasLinks = links && (links.website || links.x || links.telegram);

  // Stable `data` (DataTable stable-reference contract) — rebuilt only when the
  // rendered addresses / creator counts actually change.
  const rows = useMemo<InfoRow[]>(() => {
    const list: InfoRow[] = [
      {
        id: "contract",
        label: "Contract",
        value: <AddressLink address={token.address} kind="token" />,
      },
      {
        id: "curve",
        label: "Curve",
        value: <AddressLink address={token.curveAddress} kind="address" />,
      },
    ];
    if (token.v3PoolAddress) {
      list.push({
        id: "v3pool",
        label: "V3 pool",
        value: <AddressLink address={token.v3PoolAddress} kind="address" />,
      });
    }
    list.push({
      id: "creator",
      label: "Creator",
      value: (
        <MonoText tone="muted">
          <TokenAddressLink address={token.creator.address} kind="address" tone="muted" />
          <span className="ml-1 text-faint">· {token.creator.tokensCreated} launched</span>
        </MonoText>
      ),
    });
    return list;
  }, [
    token.address,
    token.curveAddress,
    token.v3PoolAddress,
    token.creator.address,
    token.creator.tokensCreated,
  ]);

  return (
    // FLAT region (fidelity audit fix 1): no Card — the left column supplies
    // padding; the mockup's token-detail regions carry no panel borders/fills.
    <div className="flex flex-col gap-3">
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

      {/* Separator only when there's a description/links block above it — the
          table's own TableLabel titles the region, so a leading rule would dangle. */}
      {(token.description || hasLinks) && <Divider />}

      <DataTable<InfoRow>
        data={rows}
        columns={infoColumns}
        getRowId={(r) => r.id}
        aria-label="Token info"
        // Same DataTable chrome as the sibling HolderTable/TradeFeed (plain-string
        // TableLabel → bold <h3>, HolderTable row classes); no header/meta/pager —
        // this is a key-value table, not a sorted, paginated record list.
        tableLabel={{ title: "Token info" }}
        renderRow={({ cells }) => (
          <div className={`${GRID} border-b border-border-soft py-1.5 text-xs last:border-b-0`}>
            {cells}
          </div>
        )}
      />
    </div>
  );
}

// The https-only ExtLink guard (UM-5 defense-in-depth, 2026-07-12) was promoted
// to `shared/ui/ExtLink` so the faucet CTA shares the exact same guard (ERR-12).
