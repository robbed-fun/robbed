import type { CreatorClaimable, CreatorTokenClaimable } from "@robbed/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenCard, usdValue } from "./fixtures";

const m = vi.hoisted(() => ({
  CREATOR: "0x00000000000000000000000000000000000000aa",
  VAULT: "0x00000000000000000000000000000000000000bb",
  TOKEN: "0x00000000000000000000000000000000000000cc",
  WETH: "0x00000000000000000000000000000000000000dd",
  claimEth: vi.fn(),
  claimToken: vi.fn(),
  useCreatorClaimable: vi.fn(),
  useCreatorCurveClaimable: vi.fn(),
  useCreatorTokenClaimable: vi.fn(),
  useOnchainCreatorTokenBuckets: vi.fn(),
  useClaimCreatorFee: vi.fn(),
  useClaimCreatorTokenFee: vi.fn(),
  useClaimCreatorTokenFees: vi.fn(),
  useWsChannel: vi.fn(),
  routerPush: vi.fn(),
  routerPrefetch: vi.fn(),
}));

const CREATOR = m.CREATOR;
const VAULT = m.VAULT;
const TOKEN = m.TOKEN;
const WETH = m.WETH;

vi.mock("@/shared/config/addresses", () => ({
  CREATOR_VAULT: m.VAULT,
  ROBBED: {},
  V3: {},
  WETH: m.WETH,
  isPlaceholder: () => false,
  requireAddress: (addr: string) => addr,
}));

vi.mock("@/shared/lib/ws", () => ({
  useWsChannel: m.useWsChannel,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: m.routerPush,
    prefetch: m.routerPrefetch,
  }),
}));

vi.mock("@/entities/creator", async (importActual) => {
  const actual = await importActual<typeof import("@/entities/creator")>();
  return {
    ...actual,
    useCreatorClaimable: m.useCreatorClaimable,
    useCreatorCurveClaimable: m.useCreatorCurveClaimable,
    useCreatorTokenClaimable: m.useCreatorTokenClaimable,
    useOnchainCreatorTokenBuckets: m.useOnchainCreatorTokenBuckets,
    useClaimCreatorFee: m.useClaimCreatorFee,
    useClaimCreatorTokenFee: m.useClaimCreatorTokenFee,
    useClaimCreatorTokenFees: m.useClaimCreatorTokenFees,
  };
});

import { CreatorEarningsPanel } from "@/widgets/creator-earnings";

const ethClaimable = (claimableEth = "1000000000000000000"): CreatorClaimable => ({
  creator: CREATOR,
  vault: VAULT,
  claimableEth,
  claimable: usdValue({ usd: "3450" }),
  totalAccruedEth: claimableEth,
  totalClaimedEth: "0",
  asOf: "2026-07-15T00:00:00.000Z",
});

const tokenBucket = (over: Partial<CreatorTokenClaimable> = {}): CreatorTokenClaimable => ({
  creator: CREATOR,
  token: TOKEN,
  vault: VAULT,
  claimable: "3000000000000000000000",
  claimableUsd: null,
  totalAccrued: "3000000000000000000000",
  totalClaimed: "0",
  asOf: "2026-07-15T00:00:00.000Z",
  ...over,
});

function renderPanel({ isSelf = true }: { isSelf?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreatorEarningsPanel
        address={CREATOR}
        isSelf={isSelf}
        createdTokens={[
          tokenCard({
            address: TOKEN,
            ticker: "MOON",
            name: "Moon Coin",
            graduated: true,
            status: "graduated",
          }),
        ]}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  m.claimEth.mockReset();
  m.claimToken.mockReset();
  m.useWsChannel.mockReset();
  m.useCreatorClaimable.mockReset();
  m.useCreatorCurveClaimable.mockReset();
  m.useCreatorTokenClaimable.mockReset();
  m.useOnchainCreatorTokenBuckets.mockReset();
  m.useClaimCreatorFee.mockReset();
  m.useClaimCreatorTokenFee.mockReset();
  m.useClaimCreatorTokenFees.mockReset();
  m.routerPush.mockReset();
  m.routerPrefetch.mockReset();

  m.useCreatorClaimable.mockReturnValue({ data: ethClaimable(), isSuccess: true });
  m.useCreatorCurveClaimable.mockReturnValue({ data: [], isSuccess: true });
  m.useCreatorTokenClaimable.mockReturnValue({
    data: [
      tokenBucket({
        token: WETH,
        claimable: "2000000000000000000",
        claimableUsd: usdValue({ usd: "6900" }),
        totalAccrued: "2000000000000000000",
      }),
      tokenBucket(),
    ],
    isSuccess: true,
  });
  m.useOnchainCreatorTokenBuckets.mockReturnValue({ buckets: [], isLoading: false });
  m.useClaimCreatorFee.mockImplementation((meta, opts) => ({
    claim: () => m.claimEth(meta, opts),
    reset: vi.fn(),
    state: { phase: "idle", txHash: null, blockNumber: null, confirmationState: null, error: null },
  }));
  m.useClaimCreatorTokenFee.mockImplementation((meta) => ({
    claim: () => m.claimToken(meta),
    reset: vi.fn(),
    state: { phase: "idle", txHash: null, blockNumber: null, confirmationState: null, error: null },
  }));
  m.useClaimCreatorTokenFees.mockImplementation((metas) => ({
    claim: () => metas.forEach((meta: unknown) => m.claimToken(meta)),
    reset: vi.fn(),
    state: { phase: "idle", txHash: null, blockNumber: null, confirmationState: null, error: null },
  }));
});

afterEach(() => {
  cleanup();
});

describe("CreatorEarningsPanel", () => {
  it("is self-only", () => {
    renderPanel({ isSelf: false });
    expect(screen.queryByText("Creator earnings")).toBeNull();
  });

  it("renders one claim button per claim section", () => {
    renderPanel();

    expect(screen.getByText("Creator earnings")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claim ETH" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claim post-graduation LP fees" })).toBeTruthy();
    expect(screen.getAllByText("1.0000 ETH").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("2.0000 WETH").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("3K MOON").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("In vault")).toBeNull();
    expect(screen.queryByText("Accrued")).toBeNull();
    expect(screen.queryByText("Claimed")).toBeNull();
  });

  it("submits the pre-grad claim and both post-grad ERC20 claims from two buttons", () => {
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "Claim ETH" }));
    fireEvent.click(screen.getByRole("button", { name: "Claim post-graduation LP fees" }));

    expect(m.claimEth).toHaveBeenCalledWith(
      {
        type: "CLAIM_CREATOR_FEE",
        creator: CREATOR,
        vault: VAULT,
        amountEth: "1000000000000000000",
      },
      { sweepCurves: [] },
    );
    expect(m.claimToken).toHaveBeenCalledWith({
      type: "CLAIM_CREATOR_TOKEN_FEE",
      creator: CREATOR,
      token: WETH,
      vault: VAULT,
      amount: "2000000000000000000",
    });
    expect(m.claimToken).toHaveBeenCalledWith({
      type: "CLAIM_CREATOR_TOKEN_FEE",
      creator: CREATOR,
      token: TOKEN,
      vault: VAULT,
      amount: "3000000000000000000000",
    });
    expect(m.claimToken).toHaveBeenCalledTimes(2);
  });

  it("shows a disabled empty-state button for a creator vault with zero pre-grad balance", () => {
    m.useCreatorClaimable.mockReturnValue({ data: ethClaimable("0"), isSuccess: true });
    m.useCreatorCurveClaimable.mockReturnValue({ data: [], isSuccess: true });
    m.useCreatorTokenClaimable.mockReturnValue({ data: [], isSuccess: true });

    renderPanel();

    const ethButton = screen.getByRole("button", { name: "Nothing to claim ETH" });
    const postGradButton = screen.getByRole("button", {
      name: "Nothing to claim post-graduation LP fees",
    });
    expect((ethButton as HTMLButtonElement).disabled).toBe(true);
    expect((postGradButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows available post-grad token buckets even before the API has materialized accrued rows", () => {
    m.useCreatorClaimable.mockReturnValue({ data: ethClaimable("0"), isSuccess: true });
    m.useCreatorTokenClaimable.mockReturnValue({ data: [], isSuccess: true });
    m.useOnchainCreatorTokenBuckets.mockReturnValue({
      buckets: [
        {
          creator: CREATOR,
          token: WETH,
          vault: VAULT,
          claimable: "0",
          claimableUsd: null,
          isWeth: true,
        },
        {
          creator: CREATOR,
          token: TOKEN,
          vault: VAULT,
          claimable: "0",
          claimableUsd: null,
          isWeth: false,
        },
      ],
      isLoading: false,
    });

    renderPanel();

    expect(screen.getByText("Post-graduation LP fees")).toBeTruthy();
    expect(screen.getByText("0.0000 WETH")).toBeTruthy();
    expect(screen.getByText("0 MOON")).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: /Nothing to claim/i });
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it("keeps the created token section when the API has only the shared WETH bucket", () => {
    m.useCreatorTokenClaimable.mockReturnValue({
      data: [
        tokenBucket({
          token: WETH,
          claimable: "5000000000000",
          claimableUsd: usdValue({ usd: "0.01725" }),
          totalAccrued: "5000000000000",
        }),
      ],
      isSuccess: true,
    });
    m.useOnchainCreatorTokenBuckets.mockReturnValue({
      buckets: [
        {
          creator: CREATOR,
          token: TOKEN,
          vault: VAULT,
          claimable: "0",
          claimableUsd: null,
          isWeth: false,
        },
      ],
      isLoading: false,
    });

    renderPanel();

    expect(screen.getAllByText("0.0000050 WETH").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("0 MOON")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Claim post-graduation LP fees" })).toBeTruthy();
  });

  it("includes unswept curve fees in the pre-grad claim and sweeps before claim", () => {
    m.useCreatorClaimable.mockReturnValue({ data: ethClaimable("0"), isSuccess: true });
    m.useCreatorCurveClaimable.mockReturnValue({
      data: [
        {
          creator: CREATOR,
          token: TOKEN,
          ticker: "MOON",
          curve: "0x00000000000000000000000000000000000000ee",
          unsweptEth: "40310377681372",
          asOf: "2026-07-15T00:00:00.000Z",
        },
      ],
      isSuccess: true,
    });
    m.useCreatorTokenClaimable.mockReturnValue({ data: [], isSuccess: true });

    renderPanel();

    expect(screen.getByText("Pending sweep")).toBeTruthy();
    expect(screen.getAllByText("0.000040 ETH").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/sweep tx/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Sweep \+ claim/i }));

    expect(m.claimEth).toHaveBeenCalledWith(
      {
        type: "CLAIM_CREATOR_FEE",
        creator: CREATOR,
        vault: VAULT,
        amountEth: "40310377681372",
      },
      { sweepCurves: ["0x00000000000000000000000000000000000000ee"] },
    );
  });
});
