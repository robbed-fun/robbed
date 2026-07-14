import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Creator-click search deep link (DISC-4 nuance) `TokenCard` pushes
 * `/?q=<creator>`; the header's `UrlSeededSearchBox` reads `?q=` back via
 * `useSearchParams` and seeds `SearchBox` (`initialQ`), closing the round-trip.
 * jsdom-level proof: the box's value equals the deep-linked query, and re-seeds
 * when the param changes (client navigation).
 */
const { searchParamsRef } = vi.hoisted(() => ({
  searchParamsRef: { current: new URLSearchParams("") },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

// SearchBox's live query leg is not under test here — resolve empty results so
// the debounced query never touches the network.
vi.mock("@/shared/api", () => ({
  searchTokens: vi.fn(async () => ({ results: [] })),
}));

// Imported AFTER the mocks are registered.
import { UrlSeededSearchBox } from "@/features/search-tokens";

afterEach(cleanup);

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("UrlSeededSearchBox (creator ?q= deep link)", () => {
  it("seeds the search box from ?q=", () => {
    searchParamsRef.current = new URLSearchParams("q=0xabcdef12creator");
    renderWithQuery(<UrlSeededSearchBox />);
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    expect(box.value).toBe("0xabcdef12creator");
  });

  it("renders un-seeded when no ?q= is present", () => {
    searchParamsRef.current = new URLSearchParams("");
    renderWithQuery(<UrlSeededSearchBox />);
    const box = screen.getByRole("searchbox") as HTMLInputElement;
    expect(box.value).toBe("");
  });

  it("re-seeds when a new deep link changes the param (client navigation)", () => {
    searchParamsRef.current = new URLSearchParams("q=hoodcat");
    const { rerender, unmount } = renderWithQuery(<UrlSeededSearchBox />);
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("hoodcat");

    searchParamsRef.current = new URLSearchParams("q=bagel");
    // A fresh QueryClientProvider tree isn't needed — same tree, new params.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <UrlSeededSearchBox />
      </QueryClientProvider>,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("bagel");
    unmount();
  });
});
