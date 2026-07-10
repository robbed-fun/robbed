import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  groupHoldersByCluster,
  hasFundingClusters,
} from "@/entities/holder";
import { holderRow, tokenDetail } from "./fixtures";

/**
 * Holder funding-cluster grouping (v1.2, §5.2/§8.5). Pure grouping + a render
 * proving the cluster block + advisory botFlags appear when the API supplies
 * `clusterId`/`botFlags` — heuristic framing, gating nothing.
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

describe("HolderTable render — cluster block + advisory botFlags (§5.2)", () => {
  it("renders a funding-cluster group and a botFlag badge when the API supplies them", async () => {
    vi.doMock("@/shared/api", () => ({
      getHolders: vi.fn(),
    }));
    const { HolderTable } = await import("@/widgets/holder-table");

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const holders = [
      holderRow({
        address: "0x00000000000000000000000000000000000000b1",
        clusterId: "cl9",
        botFlags: ["farm"],
      }),
      holderRow({ address: "0x00000000000000000000000000000000000000b2", clusterId: "cl9" }),
      holderRow({
        address: "0x00000000000000000000000000000000000000b3",
        flags: ["curve"],
      }),
    ];

    render(
      <QueryClientProvider client={qc}>
        <HolderTable token={tokenDetail()} initialData={{ holders, holderCount: 42 }} />
      </QueryClientProvider>,
    );

    expect(screen.getByText(/Funding cluster · 2 addresses/)).toBeTruthy();
    expect(screen.getByText("farm")).toBeTruthy(); // advisory botFlag label
    expect(screen.getByText("Bonding curve")).toBeTruthy(); // structural flag label
    expect(screen.getByText(/42 holders/)).toBeTruthy();
  });
});
