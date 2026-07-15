/**
 * Ponder `:setup` hook (runs once before indexing begins) — launches the M2-6
 * confirmation tracker and M2-7 metadata verifier side-processes. `startSidecars`
 * is idempotent and fire-and-forget; a failure there is logged and never blocks
 * indexing (the loops are advisory — they never gate chain state).
 */
import { ponder } from "ponder:registry";
import { startSidecars } from "../sidecar";

// Persistent `ponder start` resumes from _ponder_checkpoint and does not replay
// the setup event after crash recovery. Compose opts into import-time sidecar
// boot so watermarks/metadata/metrics still start on every process start.
if (process.env.INDEXER_SIDECAR_BOOT === "eager") {
  void startSidecars();
}

ponder.on("CurveFactory:setup", async () => {
  void startSidecars();
});
