import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster, toast, useToast } from "@/shared/ui";

/**
 * Toaster + imperative `toast()` API (launch feedback). The store is a
 * module singleton, so `toast.dismiss()` resets it between tests.
 *
 * Covers the contract the LaunchForm relies on: error → assertive `alert`,
 * success/info → polite `status`, manual close, auto-dismiss, sticky (duration 0),
 * id-dedupe, and token-only styling (no raw color — web.md).
 */
afterEach(() => {
  act(() => toast.dismiss());
  cleanup();
});

describe("Toaster + toast()", () => {
  it("renders nothing until a toast is pushed", () => {
    render(<Toaster />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("error → assertive alert carrying the message + ERROR tag (token accent)", () => {
    render(<Toaster />);
    act(() => {
      toast.error("Connect a wallet to launch.");
    });
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("Connect a wallet to launch.");
    expect(alert.textContent).toContain("ERROR");
    // Accent is a design token, never a raw color.
    expect(alert.className).toContain("border-l-red");
  });

  it("success + info → polite status rows with OK / INFO tags", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Token launched — it's tradeable now.");
      toast.info("still indexing");
    });
    const statuses = screen.getAllByRole("status");
    expect(statuses.some((n) => n.textContent?.includes("OK"))).toBe(true);
    expect(statuses.some((n) => n.textContent?.includes("INFO"))).toBe(true);
  });

  it("manual close removes the toast", () => {
    render(<Toaster />);
    act(() => {
      toast.error("boom");
    });
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("auto-dismisses after its duration", () => {
    vi.useFakeTimers();
    try {
      render(<Toaster />);
      act(() => {
        toast.error("temporary", { duration: 3000 });
      });
      expect(screen.getByRole("alert")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("duration 0 stays sticky (no auto-dismiss)", () => {
    vi.useFakeTimers();
    try {
      render(<Toaster />);
      act(() => {
        toast.error("sticky", { duration: 0 });
      });
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole("alert")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dedupes by explicit id (replaces in place)", () => {
    render(<Toaster />);
    act(() => {
      toast.error("first", { id: "dup" });
      toast.error("second", { id: "dup" });
    });
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain("second");
  });

  it("useToast() returns the same stable imperative API", () => {
    expect(useToast()).toBe(toast);
  });
});
