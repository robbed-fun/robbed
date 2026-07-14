import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  groupHoldersByCluster,
  hasFundingClusters,
} from "@/entities/holder";
import { holderRow, tokenDetail } from "./fixtures";

/**
 * Holder funding-cluster grouping (v1.2) — the PURE grouping helper is
 * preserved (public entity API). NOTE : the redesigned Top Holders
 * table NO LONGER re-groups client-side (that would re-rank a server-authoritative
 * list); the surviving public signal is the per-row advisory bot-flag chips,
 * proven in the render block below.
 */

vi.mock("@/shared/lib/ws", () => ({ useWsChannel: () => {} }));

afterEach(cleanup);

describe("groupHoldersByCluster (pure)", () => {
  it("groups rows sharing a clusterId; singletons stay standalone; order preserved", () => {
    const rows = [
      holderRow({ address: "0x00000000000000000000000000000000000000a1", clusterId: "c1" }),
      holderRow({ address: "0x00000000000000000000000000000000000000a2" }),
      holderRow({ address: "0x00000000000000000000000000000000000000a3", clusterId: "c1" }),
      holderRow({ address: "0x00000000000000000000000000000000000000a4", clusterId: "lonely" }),
    ];
    const groups = groupHoldersByCluster(rows);
    // c1 (2 members) grouped at first member's position; a2 standalone; the
    // singleton "lonely" cluster is NOT grouped (would over-state confidence).
    expect(groups[0]!.clusterId).toBe("c1");
    expect(groups[0]!.rows).toHaveLength(2);
    expect(groups[1]!.clusterId).toBeNull();
    expect(groups[2]!.clusterId).toBeNull(); // the lonely singleton
    expect(hasFundingClusters(rows)).toBe(true);
  });

  it("reports no clusters when none are shared", () => {
    expect(hasFundingClusters([holderRow(), holderRow({ address: "0x0b" })])).toBe(false);
  });
});

describe("HolderTable render — row shape + advisory botFlags ", () => {
  it("renders rank/label/amount rows with structural + advisory flag chips", async () => {
    vi.doMock("@/shared/api", () => ({
      getHolders: vi.fn(async () => ({ items: [], nextCursor: null })),
    }));
    const { HolderTable } = await import("@/widgets/holder-table");

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const holders = [
      holderRow({
        address: "0x00000000000000000000000000000000000000b1",
        botFlags: ["farm"],
      }),
      holderRow({
        address: "0x00000000000000000000000000000000000000b3",
        flags: ["curve"],
      }),
    ];

    render(
      <QueryClientProvider client={qc}>
        <HolderTable token={tokenDetail()} initialData={{ items: holders, nextCursor: null }} />
      </QueryClientProvider>,
    );

    // Titled table + the RULED row surface : advisory bot-flag chip
    // (surviving public organic-flow signal) + structural role chip.
    expect(screen.getByText("Top holders")).toBeTruthy();
    expect(screen.getByText("farm")).toBeTruthy(); // advisory botFlag chip
    expect(screen.getByText("Bonding curve")).toBeTruthy(); // structural flag chip
  });
});
