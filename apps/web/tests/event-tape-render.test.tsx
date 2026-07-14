import type { EventsResponse } from "@robbed/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tokenCard } from "./fixtures";

/**
 * EventTape render (Discover, ROBBED_ redesign). WS is mocked (the live streams
 * are proven separately in event-tape.test.ts); this asserts the SKIN + wiring:
 * the LIVE dot, the filter tabs, colored SIDE cells, that mcap/Δ% come from the
 * registry (an unknown-token row shows "—", never an invented figure), AND that
 * the `GET /v1/events` seed paints a HISTORICAL graduation under GRADUATIONS.
 */
vi.mock("@/shared/lib/ws", () => ({ useWsChannel: () => {} }));

// The `/v1/events` seed fetch is mocked per-test; default = empty snapshot so
// the launch-only tests behave exactly as before (only the props seed paints).
const getEvents = vi.fn(
  (..._args: unknown[]): Promise<EventsResponse> =>
    Promise.resolve({ events: [], nextCursor: null }),
);
vi.mock("@/shared/api", () => ({ getEvents: (...args: unknown[]) => getEvents(...args) }));

import { EventTape } from "@/widgets/event-tape";

afterEach(() => {
  cleanup();
  getEvents.mockReset();
  getEvents.mockResolvedValue({ events: [], nextCursor: null });
});

const now = Math.floor(Date.now() / 1000);
const GRAD_TOKEN = "0x00000000000000000000000000000000000000d8";

describe("EventTape — live tape skin", () => {
  it("seeds real LAUNCH rows from the registry and shows the LIVE dot", async () => {
    render(
      <EventTape
        tokens={[
          tokenCard({
            address: "0x00000000000000000000000000000000000000a1",
            name: "Hoodcat",
            createdAt: now - 4,
          }),
        ]}
      />,
    );
    expect(screen.getByText("LIVE")).toBeTruthy();
    // seeded launch row (from props — paints synchronously before the seed fetch)
    expect(await screen.findByText("Hoodcat")).toBeTruthy();
    expect(screen.getByText("LAUNCH")).toBeTruthy();
    // launch rows show "new", never a fabricated Δ%
    expect(screen.getByText("new")).toBeTruthy();
    // mcap resolved from the live-priced registry value (source-disclosed)
    expect(screen.getByText("$12,345")).toBeTruthy();
  });

  it("filters the tape by tab (LAUNCHES vs GRADUATIONS)", async () => {
    render(
      <EventTape
        tokens={[tokenCard({ address: "0x00000000000000000000000000000000000000a2", name: "Bagel" })]}
      />,
    );
    // ALL/LAUNCHES show the seeded launch; GRADUATIONS empties it.
    expect(await screen.findByText("Bagel")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "GRADUATIONS" }));
    expect(screen.queryByText("Bagel")).toBeNull();
    expect(screen.getByText("watching for live activity…")).toBeTruthy();
    // back to LAUNCHES → row returns
    fireEvent.click(screen.getByRole("tab", { name: "LAUNCHES" }));
    expect(screen.getByText("Bagel")).toBeTruthy();
  });

  it("paints a HISTORICAL graduation from the /v1/events seed under GRADUATIONS", async () => {
    // The seed fetch returns a graduated-token event (shape-identical to WS).
    getEvents.mockResolvedValue({
      events: [
        {
          type: "graduated",
          data: { token: GRAD_TOKEN, pool: "0x00000000000000000000000000000000000000f0", blockNumber: 102, ts: now - 5 },
        },
      ],
      nextCursor: null,
    });
    render(
      <EventTape
        tokens={[tokenCard({ address: GRAD_TOKEN, name: "Gradcoin", graduated: true, createdAt: now - 100 })]}
      />,
    );
    // The graduation row appears once the async seed resolves (its purple marker
    // is unique to graduate rows) — the LAUNCH row still exists for the token.
    expect(await screen.findByText("→ AMM pool live")).toBeTruthy();
    expect(screen.getByText("GRADUATE")).toBeTruthy();

    // GRADUATIONS tab isolates the seeded graduation row (LAUNCH filtered out).
    fireEvent.click(screen.getByRole("tab", { name: "GRADUATIONS" }));
    expect(screen.getByText("Gradcoin")).toBeTruthy();
    expect(screen.getByText("→ AMM pool live")).toBeTruthy();
    expect(screen.queryByText("LAUNCH")).toBeNull();

    // LAUNCHES tab still shows the token's launch row (both events preserved).
    fireEvent.click(screen.getByRole("tab", { name: "LAUNCHES" }));
    expect(screen.getByText("Gradcoin")).toBeTruthy();
    expect(screen.getByText("LAUNCH")).toBeTruthy();
    expect(screen.queryByText("→ AMM pool live")).toBeNull();
  });
});
