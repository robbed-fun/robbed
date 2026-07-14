/**
 * Public API for the `launch-token` feature (FSD reference/public-api) — the
 * Launch flow: form + shared-zod validation, API-mediated image upload
 *, client-side metadata-hash re-verification before signing (
 * normative), the atomic-initial-buy `createToken` write, live-read economics,
 * and the soft-confirmed stepper with the not-yet-indexed redirect grace.
 *
 * The `views/launch` screen composes `LaunchForm`; nothing reaches into the
 * slice's internals. Pure model units are re-exported for unit tests.
 */
export { LaunchForm } from "./ui/LaunchForm";
export { EconomicsPanel } from "./ui/EconomicsPanel";
export { LaunchProgress } from "./ui/LaunchProgress";
export { ImageUpload } from "./ui/ImageUpload";

// Model (pure — imported by tests)
export {
  launchTextSchema,
  validateImageFile,
  parseInitialBuyEth,
  ACCEPTED_IMAGE_MIME,
} from "./model/schema";
export { buildMetadataDocument, buildMetadataRequest } from "./model/build-metadata";
export { verifyMetadataHash, verifyFailureMessage } from "./model/verify-hash";
export { buildCreateTokenRequest } from "./model/create-token";
export {
  previewInitialBuy,
  initialBuyMinTokensOut,
  type InitialBuyPreview,
} from "./model/initial-buy-preview";
export { waitForIndexed } from "./model/index-grace";
export {
  type LaunchStep,
  LAUNCH_STEP_ORDER,
  launchStepLabel,
  isLaunchInFlight,
} from "./model/steps";
export { launchBlockReason, type BlockReasonInput } from "./model/block-reason";
export { useLaunch } from "./model/use-launch";
export { useLaunchEconomics } from "./model/use-launch-economics";
