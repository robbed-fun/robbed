import { LP_COPY } from "@robbed/shared";

/**
 * Single re-export of the canonical LP sentence (; CLAUDE.md hard
 * rule). Every LP-destiny surface (Trust panel item 5, Launch EconomicsPanel,
 * tooltips, OG alt text) imports `LP_DESTINY_COPY` from here — never a second
 * spelling. The forbidden LP verb (CLAUDE.md hard rule) must never appear; the
 * copy-lint test (tests/copy-lint.test.ts) asserts no other spelling exists.
 *
 * We re-export (not re-declare) the shared constant so the string lives ONCE in
 * `@robbed/shared` (anti-drift rule 2) and cannot drift from the API/indexer.
 */
export const LP_DESTINY_COPY = LP_COPY;

/**
 * Approved AMM framing : ROBBED_ is a bonding-curve AMM with soft
 * confirmations. The forbidden exchange/finality framings are asserted-absent by
 * tests/copy-lint.test.ts — the literal phrases are intentionally NOT
 * materialised here so this file never trips its own lint (or the repo hook).
 */
export const AMM_TAGLINE = "Soft-confirmed trading" as const;

/**
 * Brand (ROBBED_ redesign, user-directed — recorded as a spec deviation for
 * robbed-architect : robbed → ROBBED_). Titles/strings use this constant;
 * the rendered wordmark (with the blinking green `_`) is `<Wordmark />` in
 * shared/ui.
 */
export const BRAND = "ROBBED_" as const;
