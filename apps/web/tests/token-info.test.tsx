import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TokenInfo } from "@/views/token-detail/ui/TokenInfo";

import { tokenDetail } from "./fixtures";

/**
 * TokenInfo refactor guard — the key-value block now renders through the shared
 * `DataTable` (same chrome as the sibling HolderTable/TradeFeed), so this asserts
 * the DataTable-titled section, the ruled rows, and the conditional V3-pool row.
 *
 * The former LP-destiny floor tests are GONE (USER-DIRECTED 2026-07-14, D-74):
 * the D-14 LP-copy sentence is no longer a required render on token detail, so
 * this panel no longer emits it. The "never 'burned'" wording rule is enforced
 * elsewhere (copy-lint section 1); it is not re-asserted here.
 */

afterEach(cleanup);

describe("TokenInfo — shared DataTable key-value rows", () => {
  it("renders the 'Token info' TableLabel and the base key-value rows", () => {
    render(<TokenInfo token={tokenDetail()} />);
    expect(screen.getByRole("heading", { name: "Token info" })).toBeTruthy();
    expect(screen.getByText("Contract")).toBeTruthy();
    expect(screen.getByText("Curve")).toBeTruthy();
    expect(screen.getByText("Creator")).toBeTruthy();
    // creator profile: short-address link + launched count from the fixture (3)
    expect(screen.getByText(/·\s*3\s*launched/)).toBeTruthy();
  });

  it("renders the V3-pool row ONLY when the token has a v3PoolAddress", () => {
    const { rerender } = render(<TokenInfo token={tokenDetail()} />);
    expect(screen.queryByText("V3 pool")).toBeNull();

    rerender(
      <TokenInfo
        token={tokenDetail({
          v3PoolAddress: "0x00000000000000000000000000000000000000f3",
        })}
      />,
    );
    expect(screen.getByText("V3 pool")).toBeTruthy();
  });
});
