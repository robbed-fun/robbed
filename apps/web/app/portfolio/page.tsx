/**
 * Next route file for Portfolio `/portfolio` — ROUTING ONLY (FSD Next.js
 * guide). NEW route from the ROBBED_ redesign (user-directed; §5/§5.4
 * deviation recorded). Screen composition + the `/v1/portfolio/*` reads live in
 * the `views/portfolio` slice; the default export receives `searchParams`
 * (`?address=` for viewing another wallet) straight from Next.
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Holdings, activity, and created tokens on Robinhood Chain.",
};

export { default } from "@/views/portfolio";
