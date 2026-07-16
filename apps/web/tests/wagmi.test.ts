import { describe, expect, it } from "vitest";

import { buildConnectors } from "@/shared/lib/wagmi";

describe("buildConnectors — mobile wallet support", () => {
  it("keeps injected-only dev mode when WalletConnect is not configured", () => {
    expect(buildConnectors("")).toHaveLength(1);
  });

  it("adds first-class mobile wallets plus generic WalletConnect when configured", () => {
    expect(buildConnectors("test-walletconnect-project")).toHaveLength(7);
  });
});
