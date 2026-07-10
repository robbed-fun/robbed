import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * ROBBED_ AppHeader + MobileNav (redesign Phase F). Asserts the mockup header
 * contract — wordmark · discover/portfolio nav · `+ CREATE` (green outline →
 * /create, the RENAMED route) · wallet — and the mobile-first collapse: the
 * desktop nav/search/CTA are `md:`-gated while MobileNav is `md:hidden` with
 * the same three destinations. Wallet + search features are mocked (they need
 * wagmi/RainbowKit providers; their own suites cover them).
 */
const { pathnameRef } = vi.hoisted(() => ({ pathnameRef: { current: "/" } }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));
vi.mock("@/features/connect-wallet", () => ({
  WalletConnectButton: () => <div data-testid="wallet-chip" />,
}));
vi.mock("@/features/search-tokens", () => ({
  SearchBox: () => <input data-testid="search-box" />,
}));

// Imported AFTER the mocks are registered.
import { AppHeader } from "@/widgets/app-header";
import { MobileNav } from "@/widgets/mobile-nav";

afterEach(cleanup);

describe("AppHeader", () => {
  it("renders wordmark · nav · search · + CREATE → /create · wallet chip", () => {
    pathnameRef.current = "/";
    render(<AppHeader />);

    // ROBBED_ wordmark links home
    expect(screen.getByRole("link", { name: "ROBBED_ home" })).toBeTruthy();

    // primary nav
    const discover = screen.getByRole("link", { name: "discover" });
    const portfolio = screen.getByRole("link", { name: "portfolio" });
    expect(discover.getAttribute("href")).toBe("/");
    expect(portfolio.getAttribute("href")).toBe("/portfolio");

    // active state from the pathname: `/` → discover active, portfolio muted
    expect(discover.getAttribute("aria-current")).toBe("page");
    expect(portfolio.getAttribute("aria-current")).toBeNull();
    expect(portfolio.className).toContain("text-muted");

    // + CREATE goes to the RENAMED /create route (green outline variant)
    const create = screen.getByRole("link", { name: "+ CREATE" });
    expect(create.getAttribute("href")).toBe("/create");
    expect(create.className).toContain("border-primary");

    // wallet chip + search present
    expect(screen.getByTestId("wallet-chip")).toBeTruthy();
    expect(screen.getAllByTestId("search-box").length).toBeGreaterThan(0);
  });

  it("token-detail paths keep `discover` active (section membership)", () => {
    pathnameRef.current = "/t/0xabc";
    render(<AppHeader />);
    expect(
      screen.getByRole("link", { name: "discover" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("mobile-first collapse: desktop nav + CTA are md-gated, mobile search row is md:hidden", () => {
    pathnameRef.current = "/";
    const { container } = render(<AppHeader />);
    const nav = container.querySelector('nav[aria-label="Primary"]');
    expect(nav?.className).toContain("hidden");
    expect(nav?.className).toContain("md:flex");
    expect(screen.getByRole("link", { name: "+ CREATE" }).className).toContain(
      "md:inline-flex",
    );
    // second (mobile) search row
    const mobileRow = container.querySelector(".md\\:hidden");
    expect(mobileRow).toBeTruthy();
  });
});

describe("MobileNav", () => {
  it("is a bottom bar (md:hidden) with discover / portfolio / + create", () => {
    pathnameRef.current = "/portfolio";
    render(<MobileNav />);
    const nav = screen.getByRole("navigation", { name: "Primary mobile" });
    expect(nav.className).toContain("md:hidden");
    expect(nav.className).toContain("bottom-0");

    const portfolio = screen.getByRole("link", { name: "portfolio" });
    expect(portfolio.getAttribute("aria-current")).toBe("page");

    const create = screen.getByRole("link", { name: "+ create" });
    expect(create.getAttribute("href")).toBe("/create");
    expect(create.className).toContain("text-green");
  });
});
