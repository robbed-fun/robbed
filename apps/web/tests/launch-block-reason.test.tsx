import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Launch-blocked reason. Two layers:
 *   1. `launchBlockReason` — the pure priority ladder (not connected → uploading →
 *      image error → field error → creates-paused → in-flight).
 *   2. `LaunchForm` wiring — the button stays CLICKABLE while blocked, renders the
 *      reason as a persistent helper line, and on click fires an error toast with
 *      that reason instead of silently doing nothing (the reported bug).
 */

// Mutable wallet state so the render test can start disconnected.
const account = { isConnected: false as boolean, address: undefined as string | undefined };

vi.mock("wagmi", () => ({
  useAccount: () => account,
  usePublicClient: () => undefined,
  useWriteContract: () => ({ writeContractAsync: vi.fn() }),
  useReadContracts: () => ({ data: undefined, isLoading: false, isError: false }),
}));

// The trade entity (optimistic reducer + stepper badge) is not under test here.
vi.mock("@/entities/trade", () => ({
  useOptimisticTrades: () => ({
    submit: vi.fn(),
    attachHash: vi.fn(),
    applyReceipt: vi.fn(),
    reject: vi.fn(),
    trades: [],
  }),
  tradeDisplayState: () => "pending",
  ConfirmationBadge: () => null,
}));

import { LaunchForm, launchBlockReason } from "@/features/launch-token";
import { Toaster, toast } from "@/shared/ui";

const base = {
  isConnected: true,
  imageUploading: false,
  imageError: null as string | null,
  fieldError: null as string | null,
  createsPaused: false,
  step: "idle" as const,
};

describe("launchBlockReason · priority ladder", () => {
  it("not-connected wins over every other reason", () => {
    expect(
      launchBlockReason({ ...base, isConnected: false, fieldError: "x", createsPaused: true }),
    ).toBe("Connect a wallet to launch.");
  });

  it("uploading is surfaced before field errors", () => {
    expect(
      launchBlockReason({ ...base, imageUploading: true, fieldError: "Name is required." }),
    ).toMatch(/finish uploading/i);
  });

  it("image error is surfaced (its own sentence)", () => {
    expect(launchBlockReason({ ...base, imageError: "Logo upload failed: 500" })).toBe(
      "Logo upload failed: 500",
    );
  });

  it("field error is passed through verbatim", () => {
    expect(launchBlockReason({ ...base, fieldError: "Ticker is required." })).toBe(
      "Ticker is required.",
    );
  });

  it("creates-paused message", () => {
    expect(launchBlockReason({ ...base, createsPaused: true })).toBe("Token creation is paused.");
  });

  it("mid-flight launch", () => {
    expect(launchBlockReason({ ...base, step: "signing" })).toBe("Launch already in progress.");
  });

  it("uploading step alone is NOT treated as a launch in-flight", () => {
    // (only reachable via `step`, image flags false) — the ladder's last rung is
    // isLaunchInFlight, which includes "uploading"; guard the wording anyway.
    expect(launchBlockReason({ ...base, step: "uploading" })).toBe("Launch already in progress.");
  });

  it("nothing blocking → null", () => {
    expect(launchBlockReason(base)).toBeNull();
  });
});

describe("LaunchForm · surfaces the block reason", () => {
  afterEach(() => {
    act(() => toast.dismiss());
    cleanup();
    account.isConnected = false;
  });

  it("disconnected: helper line shows, button is clickable, click fires the toast, no submit", () => {
    account.isConnected = false;
    render(
      <>
        <LaunchForm />
        <Toaster />
      </>,
    );

    // Persistent, muted helper line (visible without a click).
    expect(screen.getAllByText("Connect a wallet to launch.").length).toBeGreaterThan(0);

    // Button is NOT natively disabled (clickable so it can explain itself).
    const btn = screen.getByRole("button", { name: /launch token/i });
    expect(btn.hasAttribute("disabled")).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("true");

    // No toast yet.
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(btn);

    // Click surfaced the reason as an error toast...
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Connect a wallet to launch.");
    // ...and did NOT enter the launch flow (no stepper card).
    expect(screen.queryByText("Launching")).toBeNull();
  });
});
