"use client";

import { useState } from "react";
import { useAccount } from "wagmi";

import { WalletConnectButton } from "@/features/connect-wallet";
import { env } from "@/shared/lib/env";
import { MOCK_PORTFOLIO_ADDRESS } from "@/shared/mock/mock-api";
import { EmptyState, Tab, TabBar } from "@/shared/ui";

import { ActivityTab } from "./ActivityTab";
import { CreatedTab } from "./CreatedTab";
import { HoldingsTab } from "./HoldingsTab";
import { PortfolioSummaryHeader } from "./PortfolioSummaryHeader";

/**
 * Portfolio interactive island (mockup "2c"). Resolves the subject address:
 * an explicit `?address=` (viewing someone else) takes precedence, else the
 * connected wallet. With neither, the page is a connect prompt — Portfolio is
 * inherently wallet-scoped, so there is nothing to fetch until an address exists
 * (api.md §3.4a: any address resolves to at worst an EMPTY portfolio, so a
 * connected-but-never-traded wallet still renders fully).
 *
 * DECISION (hoodpad-frontend): tab state is local (not URL) — the three tabs are
 * a view-local switch, and the address (the shareable unit) already lives in the
 * route/query. `TabBar`/`Tab` are the shared terminal atoms (read-only).
 */

type PortfolioTab = "holdings" | "activity" | "created";

const TABS: { id: PortfolioTab; label: string }[] = [
  { id: "holdings", label: "HOLDINGS" },
  { id: "activity", label: "ACTIVITY" },
  { id: "created", label: "CREATED" },
];

export function PortfolioClient({ initialAddress }: { initialAddress?: string }) {
  const { address: connected } = useAccount();
  const [tab, setTab] = useState<PortfolioTab>("holdings");

  // DEMO MODE (task A): Portfolio is wallet-scoped, but the demo must render the
  // mock portfolio with NO wallet connected — fall back to the mock address and
  // treat it as "you". Strictly gated; the prod path still requires a subject.
  const mock = env.mockData();
  const subject = (
    initialAddress ??
    connected ??
    (mock ? MOCK_PORTFOLIO_ADDRESS : undefined)
  )?.toLowerCase();
  const isSelf =
    (!!connected &&
      (!initialAddress || initialAddress.toLowerCase() === connected.toLowerCase())) ||
    (mock && !initialAddress && !connected);

  if (!subject) {
    return (
      <div className="px-4 py-12 md:px-6">
        <EmptyState
          title="Connect a wallet"
          description="See your holdings, activity, and created tokens."
          action={
            <div className="mt-1">
              <WalletConnectButton />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <PortfolioSummaryHeader address={subject} isSelf={isSelf} />

      <TabBar aria-label="Portfolio sections" className="gap-2 border-b border-border px-4 py-3 md:px-6">
        {TABS.map((t) => (
          <Tab key={t.id} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </Tab>
        ))}
      </TabBar>

      {tab === "holdings" && <HoldingsTab address={subject} />}
      {tab === "activity" && <ActivityTab address={subject} />}
      {tab === "created" && <CreatedTab address={subject} />}
    </div>
  );
}
