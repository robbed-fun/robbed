/**
 * Indexing-function entry. Imports every handler module so its `ponder.on(...)`
 * registration runs. ES modules are singletons, so even if Ponder also
 * auto-discovers the files under `src/handlers/`, each registers exactly once.
 *
 * Six event families (indexer.md):
 *   TokenCreated · Trade · Graduated · V3 Swap · V3 Collect · LaunchToken Transfer
 */
import "./handlers/setup";
import "./handlers/tokenCreated";
import "./handlers/trade";
import "./handlers/graduated";
import "./handlers/swap";
import "./handlers/collect";
import "./handlers/transfer";
// Creator-fee leg — CreatorFeesSwept on the curve source; the CreatorVault
// bindings inside self-guard on config.creatorVault (absent-vault deployments skip).
import "./handlers/creatorFees";
// Post-grad 50/50 split — FeesSplit (LPFeeVault) + CreatorToken{Deposited,
// Claimed} (CreatorVault ERC20 leg); bindings self-guard on config.creatorVault too.
import "./handlers/creatorFeeSplit";
