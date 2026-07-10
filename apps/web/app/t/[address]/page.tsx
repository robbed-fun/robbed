/**
 * Next route file for Token Detail `/t/[address]` — ROUTING ONLY (FSD Next.js
 * guide). Screen composition + data fetching live in the `views/token-detail`
 * slice; this file only unwraps the (Next 16) Promise params and delegates.
 *
 * The per-token OG image auto-wires from the sibling `opengraph-image.tsx` (M3-8)
 * — no explicit og:image wiring here.
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
