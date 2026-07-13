/**
 * Comment moderation hook (§8.4; spec §12.63b). Off-chain comments run through a
 * SWAPPABLE moderator before they are listed/broadcast — but the TEXT-moderation
 * VENDOR is an undecided §13 NEEDS-USER item (OI-A7 covers images only), so this
 * is an INTERFACE with a stub default, never a hardcoded vendor. A real vendor
 * (text CSAM/abuse/spam classifier) later implements `CommentModerator` and is
 * injected via `AppDeps.commentModerator` with no route change.
 *
 * The verdict reuses the SAME `ModerationVisibility` enum + the pure
 * `evaluateVisibility` state machine (state-machine.ts) as token/image
 * moderation — no new moderation vocabulary is invented. Default (stub) →
 * `visible` (the existing clean default); only `visible` comments are broadcast
 * on WS, and `hidden` comments are excluded from the public list.
 */
import type { ModerationVisibility } from "@robbed/shared";
import { evaluateVisibility } from "./state-machine";

export interface CommentModerationInput {
  tokenAddress: string;
  author: string;
  body: string;
}

export interface CommentModerationVerdict {
  visibility: ModerationVisibility;
  reason: string;
}

export interface CommentModerator {
  moderate(input: CommentModerationInput): Promise<CommentModerationVerdict>;
  /** True when this is the no-op stub (drives a prod boot warning, like vendors). */
  readonly usingStub?: boolean;
}

/**
 * Stub moderator — passes everything as `visible` (the existing clean default).
 * NOT for real users: a production comment surface must inject a real text
 * moderator. Kept behind the interface so swapping it needs no route change.
 */
export function stubCommentModerator(): CommentModerator {
  return {
    usingStub: true,
    async moderate() {
      return { visibility: "visible", reason: "clean" };
    },
  };
}

/**
 * Boot guard (§4.3, mirrors `assertVendorsBootable`): in production, refuse to
 * start on the stub comment moderator unless the capped-beta escape hatch is
 * explicitly set. Reuses the SAME `MODERATION_ALLOW_STUBS` flag as the image
 * vendors — a prod deploy already sets it to boot on stub image vendors, so this
 * adds no new prod requirement, only fail-closed consistency (unmoderated
 * comments must never ship silently). Throws otherwise.
 */
export function assertCommentModeratorBootable(
  moderator: CommentModerator,
  env: string,
  allowStubs: boolean,
): void {
  if (!moderator.usingStub) return;
  if (env === "production" && !allowStubs) {
    throw new Error(
      "REFUSING TO BOOT: comment moderation running on the STUB moderator in production. " +
        "Set MODERATION_ALLOW_STUBS=true only for capped beta (§4.3; §13 text-vendor OPEN).",
    );
  }
  console.warn(
    "[moderation] WARNING: using the STUB comment moderator — NOT for real users (§4.3; §13).",
  );
}

/**
 * Convenience builder for a real moderator that produces the same signal shape
 * the token/image path uses ({ csam, nsfw, vendorUnavailable, ... }): it feeds
 * the shared `evaluateVisibility` state machine so comment and token moderation
 * share ONE precedence (fail-closed on CSAM, fail-open on vendor outage). Not
 * wired by default (no vendor yet); exported so the eventual vendor drops in.
 */
export function moderatorFromSignals(
  classify: (input: CommentModerationInput) => Promise<{
    csam: boolean;
    nsfw: number | null;
    vendorUnavailable?: boolean;
  }>,
  thresholds: { hide: number; review: number },
): CommentModerator {
  return {
    async moderate(input) {
      const s = await classify(input);
      return evaluateVisibility(
        { csam: s.csam, nsfw: s.nsfw, vendorUnavailable: s.vendorUnavailable },
        thresholds,
      );
    },
  };
}
