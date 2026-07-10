/**
 * Ponder `:setup` hook (runs once before indexing begins) — launches the M2-6
 * confirmation tracker and M2-7 metadata verifier side-processes. `startSidecars`
 * is idempotent and fire-and-forget; a failure there is logged and never blocks
 * indexing (the loops are advisory — they never gate chain state, §8.4).
 */
import { ponder } from "ponder:registry";
import { startSidecars } from "../sidecar";

ponder.on("CurveFactory:setup", async () => {
  void startSidecars();
});
