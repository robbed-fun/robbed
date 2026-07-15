import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenAddressLink } from "@/entities/token";
import { CopyAddressButton } from "@/shared/ui";
import { explorer } from "@/shared/lib/chain";

/**
 * Address affordances:
 *  - TokenAddressLink builds its href from the CHAIN CONFIG explorer builder
 *    (`shared/lib/chain`) — never a hardcoded testnet/mainnet host — so the same
 * component is correct on 4663 and 46630 (chain-facts).
 *  - CopyAddressButton copies to the clipboard and confirms accessibly.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TokenAddressLink", () => {
  it("links a token address to the stable explorer address page (URL derived from chain config)", () => {
    const addr = "0x1111111111111111111111111111111111111111";
    render(<TokenAddressLink address={addr} kind="token" />);
    const a = screen.getByRole("link");
    // href is exactly what the chain-config builder produces — no inlined host.
    expect(a.getAttribute("href")).toBe(explorer.token(addr));
    expect(a.getAttribute("href")).toContain("/address/");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("links a creator address to the explorer /address page", () => {
    const addr = "0x2222222222222222222222222222222222222222";
    render(<TokenAddressLink address={addr} kind="address" />);
    const a = screen.getByRole("link");
    expect(a.getAttribute("href")).toBe(explorer.address(addr));
    expect(a.getAttribute("href")).toContain("/address/");
  });

  it("renders the shortened address as the link text", () => {
    const addr = "0x1234567890123456789012345678901234567890";
    render(<TokenAddressLink address={addr} kind="token" />);
    // 0x1234…7890 (EIP-55 checksummed then sliced by the shared formatter).
    expect(screen.getByRole("link").textContent).toMatch(/^0x1234….*7890$/i);
  });
});

describe("CopyAddressButton", () => {
  it("is an accessible, keyboard-activatable button labelled 'Copy address'", () => {
    render(<CopyAddressButton value="0xabc" />);
    const btn = screen.getByRole("button", { name: /copy address/i });
    expect(btn.tagName).toBe("BUTTON"); // natively keyboard-activatable
  });

  it("copies the value to the clipboard and flips to a copied confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyAddressButton value="0xdeadbeef" />);
    fireEvent.click(screen.getByRole("button", { name: /copy address/i }));

    expect(writeText).toHaveBeenCalledWith("0xdeadbeef");
    // aria-label flips to the copied state once the write resolves.
    await screen.findByRole("button", { name: /address copied/i });
  });

  it("no-ops (never throws, never false-confirms) when the clipboard API is absent", () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<CopyAddressButton value="0xabc" />);
    const btn = screen.getByRole("button", { name: /copy address/i });
    expect(() => fireEvent.click(btn)).not.toThrow();
    // still idle — a confirmation must only mean the write actually happened.
    expect(screen.getByRole("button", { name: /copy address/i })).toBeTruthy();
  });
});
