import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AddressChip,
  AmountInput,
  Chip,
  CursorTag,
  Delta,
  Divider,
  LiveDot,
  MonoLabel,
  MonoText,
  SideBadge,
  StatCell,
  Tab,
  TabBar,
  TextArea,
  Wordmark,
} from "@/shared/ui";

/**
 * ROBBED_ atomic kit (redesign Phase F) — render tests. Each atom must
 * (a) render its contract, and (b) style ONLY via design tokens: the class
 * assertions here pin the token utilities (text-green/bg-active/…) that map to
 * the exact hexes sampled from the ratified redesign; the copy-lint token-bypass
 * suite separately guarantees no raw color ever appears in the components.
 */

afterEach(cleanup);

describe("MonoText / MonoLabel", () => {
  it("MonoText maps tone + size to token utilities", () => {
    render(
      <MonoText tone="green" size="lg" numeric>
        1.40 ETH
      </MonoText>,
    );
    const el = screen.getByText("1.40 ETH");
    expect(el.className).toContain("text-green");
    expect(el.className).toContain("text-lg");
    expect(el.className).toContain("tabular-nums");
  });

  it("MonoLabel is the uppercase tracked micro-label (faint by default)", () => {
    render(<MonoLabel>you pay</MonoLabel>);
    const el = screen.getByText("you pay");
    expect(el.className).toContain("uppercase");
    expect(el.className).toContain("tracking-label");
    expect(el.className).toContain("text-faint");
  });
});

describe("Chip", () => {
  it("fill variant: active gets the bg-active fill, inactive is muted", () => {
    const { rerender } = render(<Chip active>ALL</Chip>);
    expect(screen.getByRole("button", { pressed: true }).className).toContain("bg-active");
    rerender(<Chip>ALL</Chip>);
    expect(screen.getByRole("button", { pressed: false }).className).toContain("text-muted");
  });

  it("outline variant: active goes green-bordered (quick-amount chips)", () => {
    render(
      <Chip variant="outline" active>
        0.5
      </Chip>,
    );
    const el = screen.getByRole("button");
    expect(el.className).toContain("border-green");
    expect(el.className).toContain("text-green");
  });
});

describe("TabBar / Tab", () => {
  it("exposes tablist/tab roles with aria-selected and active fill", () => {
    render(
      <TabBar aria-label="tape filter">
        <Tab active>ALL</Tab>
        <Tab>TRADES</Tab>
      </TabBar>,
    );
    expect(screen.getByRole("tablist")).toBeTruthy();
    const active = screen.getByRole("tab", { selected: true });
    expect(active.textContent).toBe("ALL");
    expect(active.className).toContain("bg-active");
    expect(screen.getByRole("tab", { selected: false }).className).toContain("text-muted");
  });
});

describe("SideBadge", () => {
  it.each([
    ["buy", "BUY", "text-green"],
    ["sell", "SELL", "text-red"],
    ["launch", "LAUNCH", "text-text"],
    ["graduate", "GRADUATE", "text-purple"],
  ] as const)("%s → %s in %s", (side, label, cls) => {
    render(<SideBadge side={side} />);
    const el = screen.getByText(label);
    expect(el.className).toContain(cls);
    cleanup();
  });

  it("accepts a label override (GRADUATE → AMM pool live)", () => {
    render(<SideBadge side="graduate" label="GRADUATE → AMM" />);
    expect(screen.getByText("GRADUATE → AMM").className).toContain("text-purple");
  });
});

describe("Delta", () => {
  it("positive → signed green, negative → red, zero → muted", () => {
    const { rerender } = render(<Delta value={41.2} />);
    expect(screen.getByText("+41.2%").className).toContain("text-green");
    rerender(<Delta value={-1.8} />);
    // True minus U+2212 (mockup "−1.8%"), never ASCII hyphen-minus.
    expect(screen.getByText("−1.8%").className).toContain("text-red");
    rerender(<Delta value={0} />);
    expect(screen.getByText("0.0%").className).toContain("text-muted");
  });

  it("null renders the placeholder faint (mockup's 'new' rows)", () => {
    render(<Delta value={null} placeholder="new" />);
    expect(screen.getByText("new").className).toContain("text-faint");
  });
});

describe("StatCell", () => {
  it("renders label above a tabular value", () => {
    render(
      <StatCell label="price" size="lg">
        0.00034 ETH
      </StatCell>,
    );
    expect(screen.getByText("price").className).toContain("uppercase");
    const value = screen.getByText("0.00034 ETH");
    expect(value.className).toContain("text-lg");
    expect(value.className).toContain("tabular-nums");
  });
});

describe("CursorTag / Wordmark", () => {
  it("CursorTag appends a blinking `_` cursor (inherits tone by default)", () => {
    const { container } = render(<CursorTag>rob responsibly</CursorTag>);
    expect(screen.getByText("rob responsibly")).toBeTruthy();
    const cursor = container.querySelector(".animate-blink");
    expect(cursor?.textContent).toBe("_");
    expect(cursor?.className).not.toContain("text-green");
  });

  it("Wordmark is ROBBED + a green blinking `_`", () => {
    const { container } = render(<Wordmark />);
    expect(screen.getByText("ROBBED").className).toContain("tracking-label");
    const cursor = container.querySelector(".animate-blink");
    expect(cursor?.textContent).toBe("_");
    expect(cursor?.className).toContain("text-green");
  });
});

describe("Divider / AddressChip / LiveDot", () => {
  it("Divider is a hairline separator (border-soft; strong bumps tone)", () => {
    const { rerender } = render(<Divider />);
    expect(screen.getByRole("separator").className).toContain("bg-border-soft");
    rerender(<Divider strong />);
    expect(screen.getByRole("separator").className).toContain("bg-border");
  });

  it("AddressChip shortens (EIP-55 checksummed), titles the full address, and renders the suffix", () => {
    // Lowercase in → checksummed mixed-case out (mockup "0x7fA3…c92E").
    const addr = "0x7fa300000000000000000000000000000010c92e";
    render(<AddressChip address={addr} suffix="you" />);
    const el = screen.getByTitle(addr);
    expect(el.textContent).toContain("0x7fA3…c92E");
    expect(el.textContent).toContain("· you");
  });

  it("LiveDot renders the green dot + LIVE label", () => {
    const { container } = render(<LiveDot />);
    expect(screen.getByText("LIVE").className).toContain("text-green");
    expect(container.querySelector(".bg-green.rounded-full, .rounded-full")).toBeTruthy();
  });
});

describe("AmountInput", () => {
  it("wires label/value/unit and forwards edits as strings", () => {
    const onValueChange = vi.fn();
    render(
      <AmountInput label="you pay" value="0.50" onValueChange={onValueChange} unit="ETH" />,
    );
    const input = screen.getByLabelText("you pay") as HTMLInputElement;
    expect(input.value).toBe("0.50");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(screen.getByText("ETH")).toBeTruthy();
    fireEvent.change(input, { target: { value: "0.75" } });
    expect(onValueChange).toHaveBeenCalledWith("0.75");
  });

  it("renders quick chips and fires onSelect (0.1/0.5/1/MAX)", () => {
    const onMax = vi.fn();
    render(
      <AmountInput
        value=""
        onValueChange={() => {}}
        unit="ETH"
        quick={[
          { label: "0.5", onSelect: () => {}, active: true },
          { label: "MAX", onSelect: onMax },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "0.5", pressed: true }).className).toContain(
      "border-green",
    );
    fireEvent.click(screen.getByRole("button", { name: "MAX" }));
    expect(onMax).toHaveBeenCalledOnce();
  });
});

describe("TextArea (kit)", () => {
  it("renders a token-styled textarea", () => {
    render(<TextArea placeholder="what is this token about" />);
    const el = screen.getByPlaceholderText("what is this token about");
    expect(el.tagName).toBe("TEXTAREA");
    expect(el.className).toContain("placeholder:text-faint");
  });
});
