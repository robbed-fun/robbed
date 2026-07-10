/**
 * Next route file for Portfolio `/portfolio` — ROUTING ONLY (FSD Next.js
 * guide). NEW route from the ROBBED_ redesign (user-directed; §5/§5.4
 * deviation recorded). Screen composition lives in the `views/portfolio`
 * slice (Phase F shell; the Portfolio page agent fills it).
 */
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "Holdings, activity, and created tokens on Robinhood Chain.",
};

export { default } from "@/views/portfolio";
