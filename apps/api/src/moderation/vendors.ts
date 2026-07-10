/**
 * Auto-moderation vendor interfaces + stub implementations + prod boot guard
 * (§4.3; OI-A7 vendor selection OPEN §13). Vendor undecided, so the pipeline is
 * built against interfaces; stubs ship for local/test; PRODUCTION REFUSES TO
 * BOOT on stubs unless `MODERATION_ALLOW_STUBS=true` (logged loudly).
 *
 * NOTE for hoodpad-shared: api.md §4.3 mentions these interfaces "in
 * packages/shared", but ONLY the API service runs moderation — no cross-service
 * consumer exists — so they live here. Flag if central placement is desired.
 */
export interface CsamHashMatcher {
  /** e.g. PhotoDNA / IWF-class hash match. */
  check(imageBytes: Uint8Array): Promise<{ match: boolean; vendorRef?: string }>;
}

export interface ContentClassifier {
  /** 0..1 scores. */
  classify(imageBytes: Uint8Array): Promise<{ nsfw: number; violence: number }>;
}

export interface ModerationVendors {
  csam: CsamHashMatcher;
  classifier: ContentClassifier;
  /** True when either vendor is a stub (drives the boot guard). */
  usingStubs: boolean;
}

/** dev/null CSAM matcher — never matches. */
export class AlwaysCleanMatcher implements CsamHashMatcher {
  async check(): Promise<{ match: boolean }> {
    return { match: false };
  }
}

/** dev/null classifier — always benign. */
export class StubClassifier implements ContentClassifier {
  async classify(): Promise<{ nsfw: number; violence: number }> {
    return { nsfw: 0, violence: 0 };
  }
}

export function stubVendors(): ModerationVendors {
  return {
    csam: new AlwaysCleanMatcher(),
    classifier: new StubClassifier(),
    usingStubs: true,
  };
}

/**
 * Boot guard (§4.3): in production, refuse to start on stub vendors unless the
 * capped-beta escape hatch is explicitly set. Throws (fail-closed) otherwise.
 */
export function assertVendorsBootable(
  vendors: ModerationVendors,
  env: string,
  allowStubs: boolean,
): void {
  if (!vendors.usingStubs) return;
  if (env === "production" && !allowStubs) {
    throw new Error(
      "REFUSING TO BOOT: moderation running on STUB vendors in production. " +
        "Set MODERATION_ALLOW_STUBS=true only for capped beta (§4.3, OI-A7).",
    );
  }
  if (vendors.usingStubs) {
    console.warn(
      "[moderation] WARNING: using STUB moderation vendors — NOT for real users (§4.3, OI-A7).",
    );
  }
}
