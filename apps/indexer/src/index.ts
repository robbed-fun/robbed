/**
 * Indexing-function entry. Imports every handler module so its `ponder.on(...)`
 * registration runs. ES modules are singletons, so even if Ponder also
 * auto-discovers the files under `src/handlers/`, each registers exactly once.
 *
 * Six event families (indexer.md §1, §12.15-16):
 *   TokenCreated · Trade · Graduated · V3 Swap · V3 Collect · LaunchToken Transfer
 */
import "./handlers/setup";
import "./handlers/tokenCreated";
import "./handlers/trade";
import "./handlers/graduated";
import "./handlers/swap";
import "./handlers/collect";
import "./handlers/transfer";
