/**
 * Next route file for Token Detail `/t/[address]` — ROUTING ONLY (FSD Next.js
 * guide). Screen composition + data fetching live in the `views/token-detail`
 * slice; this file only unwraps the (Next 16) Promise params and delegates.
 *
 * The per-token `og:image` is set inside `generateTokenMetadata` and points at
 * the API-served, R2-cached PNG (`{API_ORIGIN}/v1/og/{address}.png`) — the web no
 * longer renders OG images itself (that dropped `@vercel/og`/resvg-WASM from the
 * Cloudflare Worker bundle to fit the 3 MiB Free limit).
 */
import type { Metadata } from "next";

import TokenDetailView, { generateTokenMetadata } from "@/views/token-detail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}): Promise<Metadata> {
  const { address } = await params;
  return generateTokenMetadata(address);
}

export default async function Page({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return <TokenDetailView address={address} />;
}
