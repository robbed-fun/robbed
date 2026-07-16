"use client";

import type { TokenDetail } from "@robbed/shared";
import { WalletCards } from "lucide-react";
import { useCallback, useState } from "react";
import { useAccount } from "wagmi";

import { cn } from "@/shared/lib/utils";
import { toast } from "@/shared/ui";

import {
  type WatchAssetProvider,
  requestWatchAsset,
} from "../model/watch-asset";

declare global {
  interface Window {
    ethereum?: WatchAssetProvider;
  }
}

export function AddTokenToWalletButton({
  token,
  className,
}: {
  token: Pick<TokenDetail, "address" | "ticker" | "imageUrl">;
  className?: string;
}) {
  const { connector, isConnected } = useAccount();
  const [pending, setPending] = useState(false);

  const onClick = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (pending) return;
      if (!isConnected) {
        toast.info("Connect wallet to add this token.", { id: "watch-asset-connect" });
        return;
      }
      const provider = await providerFor(connector);
      if (!provider) {
        toast.error("Connected wallet does not support adding tokens.", {
          id: "watch-asset-provider",
        });
        return;
      }
      setPending(true);
      try {
        const result = await requestWatchAsset(provider, token);
        if (result.requested) {
          toast.success(
            result.image === "retry-omitted"
              ? "Token request sent without logo."
              : "Token request sent to wallet.",
            { id: "watch-asset-ok" },
          );
        }
      } catch {
        toast.error("Wallet could not add this token.", { id: "watch-asset-error" });
      } finally {
        setPending(false);
      }
    },
    [connector, isConnected, pending, token],
  );

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-label="Add token to wallet"
      title="Add token to wallet"
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center align-middle leading-none text-faint transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
    >
      <WalletCards aria-hidden className="h-3.5 w-3.5" />
    </button>
  );
}

async function providerFor(connector: ReturnType<typeof useAccount>["connector"]) {
  if (connector) {
    const provider = await connector.getProvider().catch(() => null);
    if (isWatchAssetProvider(provider)) return provider;
  }
  if (typeof window !== "undefined" && isWatchAssetProvider(window.ethereum)) {
    return window.ethereum;
  }
  return null;
}

function isWatchAssetProvider(value: unknown): value is WatchAssetProvider {
  return (
    !!value &&
    typeof value === "object" &&
    "request" in value &&
    typeof (value as { request?: unknown }).request === "function"
  );
}
