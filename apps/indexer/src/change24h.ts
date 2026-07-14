/**
 * 24h change anchor resolver — RE-EXPORT of the canonical shared implementation.
 *
 * ZERO-DRIFT (CLAUDE.md anti-drift rule) this logic
 * has ≥2 consumers — the indexer's `volume_eth_24h` decay/materialization job AND
 * the API `card`/`detail` projections — so its single source of truth now lives
 * in `packages/shared` (`@robbed/shared/change24h`). This module previously held
 * a byte-identical copy; that duplicate has been removed. The local path is kept
 * as a thin re-export so any indexer job importing `./change24h` transparently
 * gets the one shared implementation (no second copy can drift).
 *
 * Semantics (indexer.md) unchanged — see the shared source.
 */
export {
  computeChange24hPct,
  selectAnchorPrice,
  type AnchorCandle,
  type Change24hInput,
} from "@robbed/shared/change24h";
