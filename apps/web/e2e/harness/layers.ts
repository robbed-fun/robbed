/**
 * ── truth-layer assertion markers (plan I-5a/I-5b) ───────────────────────────
 * A flow's `assertable-layers` (apps/web/e2e/user-flows.md, honouring the waivers) are
 * asserted through these three wrappers. They are BOTH runtime `test.step`s AND
 * the STATIC markers the `e2e:coverage` gate greps for: a spec must call exactly
 * the wrappers matching its declared layers — no more (over-assert), no fewer
 * (under-assert). Keep the wrapper NAMES verbatim; the coverage parser matches
 * `assertOnChain(` / `assertIndexed(` / `assertUi(` textually.
 */
import { test } from "@playwright/test";

export type Layer = "on-chain" | "indexed" | "ui";

/** ON-CHAIN: a receipt status / revert / contract read on the anvil fork. */
export async function assertOnChain(label: string, fn: () => Promise<void>): Promise<void> {
  await test.step(`on-chain · ${label}`, fn);
}

/** INDEXED: a record materialised by the indexer, read over REST/WS. */
export async function assertIndexed(label: string, fn: () => Promise<void>): Promise<void> {
  await test.step(`indexed · ${label}`, fn);
}

/** UI: a DOM assertion in apps/web (rendered value, badge, disabled state, error). */
export async function assertUi(label: string, fn: () => Promise<void>): Promise<void> {
  await test.step(`ui · ${label}`, fn);
}
