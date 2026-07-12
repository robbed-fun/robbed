/**
 * Launch stepper state (§5.3: "form → upload/pin → sign → live"). Pure enum +
 * label map so the progression is testable and the UI stays presentational.
 */
export type LaunchStep =
  | "idle" // filling the form
  | "uploading" // POST /v1/uploads/image (eager, on file select)
  | "pinning" // POST /v1/metadata (canonicalize + pin)
  | "verifying" // §12.19 client hash re-verification
  | "verify-failed" // BLOCKED — hash/canonical mismatch, never signed
  | "signing" // awaiting the wallet signature
  | "pending" // tx broadcast, awaiting the RPC receipt
  | "soft-confirmed" // receipt success — token tradeable <1s (§5.3)
  | "indexing" // waiting for the token to be indexed before redirect (grace)
  | "live" // indexed — redirecting to /t/[address]
  | "live-unindexed" // soft-confirmed but not yet indexed past the grace window
  | "error"; // reverted / broadcast failure / rejected

/** Ordered stepper nodes shown as a progress rail (terminal states excluded). */
export const LAUNCH_STEP_ORDER: LaunchStep[] = [
  "uploading",
  "pinning",
  "verifying",
  "signing",
  "pending",
  "soft-confirmed",
  "live",
];

export function launchStepLabel(step: LaunchStep): string {
  switch (step) {
    case "idle":
      return "Ready";
    case "uploading":
      return "Uploading image";
    case "pinning":
      return "Pinning metadata";
    case "verifying":
      return "Verifying hash";
    case "verify-failed":
      return "Verification failed";
    case "signing":
      return "Awaiting signature";
    case "pending":
      return "Confirming transaction";
    // §12.56: the visible "Soft-confirmed" launch label is dropped (the internal
    // `soft-confirmed` step name is unchanged). This node means "receipt success
    // — token tradeable now" (§5.3), so it reads as "Tradeable".
    case "soft-confirmed":
      return "Tradeable";
    case "indexing":
      return "Opening your token";
    case "live":
      return "Live";
    case "live-unindexed":
      return "Tradeable — indexing";
    case "error":
      return "Error";
  }
}

/** True while the flow is mid-submit (disables the form / submit button). */
export function isLaunchInFlight(step: LaunchStep): boolean {
  return (
    step === "uploading" ||
    step === "pinning" ||
    step === "verifying" ||
    step === "signing" ||
    step === "pending" ||
    step === "soft-confirmed" ||
    step === "indexing"
  );
}
