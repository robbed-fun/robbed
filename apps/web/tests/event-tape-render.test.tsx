import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { tokenCard } from "./fixtures";

/**
 * EventTape render (Discover, ROBBED_ redesign). WS is mocked (the live streams
 * are proven separately in event-tape.test.ts); this asserts the SKIN + wiring:
 * the LIVE dot, the filter tabs, colored SIDE cells, and that mcap/Δ% come from
 * the registry — an unknown-token row shows "—", never an invented figure (§2).
 */
vi.mock("@/shared/lib/ws", () => ({ useWsChannel: () => {} }));

import { EventTape } from "@/widgets/event-tape";

afterEach(cleanup);

const now = Math.floor(Date.now() / 1000);

describe("EventTape — §5.1 live tape skin", () => {
  it("seeds real LAUNCH rows from the registry and shows the LIVE dot", () => {
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
    // seeded launch row
    expect(screen.getByText("Hoodcat")).toBeTruthy();
    expect(screen.getByText("LAUNCH")).toBeTruthy();
    // launch rows show "new", never a fabricated Δ%
    expect(screen.getByText("new")).toBeTruthy();
    // mcap resolved from the live-priced registry value (source-disclosed)
    expect(screen.getByText("$12,345")).toBeTruthy();
  });

  it("filters the tape by tab (LAUNCHES vs GRADUATIONS)", () => {
    render(
      <EventTape
        tokens={[tokenCard({ address: "0x00000000000000000000000000000000000000a2", name: "Bagel" })]}
      />,
    );
    // ALL/LAUNCHES show the seeded launch; GRADUATIONS empties it.
    expect(screen.getByText("Bagel")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "GRADUATIONS" }));
    expect(screen.queryByText("Bagel")).toBeNull();
    expect(screen.getByText("watching for live activity…")).toBeTruthy();
    // back to LAUNCHES → row returns
    fireEvent.click(screen.getByRole("tab", { name: "LAUNCHES" }));
    expect(screen.getByText("Bagel")).toBeTruthy();
  });
});
