import { type LaunchStep, isLaunchInFlight } from "./steps";

/**
 * Why the LAUNCH action is blocked — a single human sentence, in strict priority
 * order (§5.3). `null` ⇒ nothing is blocking and the click proceeds to
 * `validate()` + `launcher.launch(...)`.
 *
 * This exists because a bare `disabled` submit button hides the reason from the
 * user (the reported bug). The form now keeps the button clickable for every
 * reason here and, on click, surfaces this string in an error toast; it also
 * renders it as a persistent muted helper line. The ONLY case that keeps the
 * button truly disabled is a launch already mid-flight (double-submit guard) —
 * see `LaunchForm`.
 *
 * Priority (task/§5.3):
 *   1. not connected           → prompt to connect
 *   2. wrong network           → handled by the NetworkBanner guard (NOT here)
 *   3. logo still uploading     → wait
 *   4. logo upload errored      → surface the failure
 *   5. missing/invalid field    → the specific field message
 *   6. creates paused (§6.5)    → paused
 *   7. launch already in flight → in progress
 */
export interface BlockReasonInput {
  isConnected: boolean;
  imageUploading: boolean;
  /** `launcher.image.error` (already a user-ready sentence) or null. */
  imageError: string | null;
  /** First field-validation message (name/ticker/description/image/initial-buy) or null. */
  fieldError: string | null;
  /** Live `pauseCreates` from the factory (§6.5) — never affects sells elsewhere. */
  createsPaused: boolean;
  step: LaunchStep;
}

export function launchBlockReason(input: BlockReasonInput): string | null {
  if (!input.isConnected) return "Connect a wallet to launch.";
  // Wrong network is surfaced by the NetworkBanner guard, not duplicated here.
  if (input.imageUploading) return "Waiting for the logo image to finish uploading…";
  if (input.imageError) return input.imageError;
  if (input.fieldError) return input.fieldError;
  if (input.createsPaused) return "Token creation is paused.";
  if (isLaunchInFlight(input.step)) return "Launch already in progress.";
  return null;
}
