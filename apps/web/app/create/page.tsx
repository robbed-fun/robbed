/**
 * Next route file for Create `/create` — ROUTING ONLY (FSD Next.js guide).
 * Renamed from `/launch` by the ROBBED_ redesign (user-directed; deviation
 * recorded for — `/launch` redirects here via next.config). Screen
 * composition + the entire launch flow live in the `views/create` slice.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create a token",
  description:
    "Launch an ownerless, fixed-supply token on Robinhood Chain — tradeable in under a second, soft-confirmed on the bonding curve.",
};

export { default } from "@/views/create";
