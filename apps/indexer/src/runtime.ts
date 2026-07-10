/**
 * Process-wide indexer config singleton for handlers (curve constants, WETH,
 * addresses). Loaded once at import; `ponder.config.ts` performs the same load +
 * the static assertions at startup, so by the time handlers run the env is
 * validated. Tests import the PURE lib modules directly and never import this,
 * so `loadConfig`'s fail-closed env checks don't affect the unit suite.
 */
import { loadConfig } from "./config";

export const config = loadConfig();
