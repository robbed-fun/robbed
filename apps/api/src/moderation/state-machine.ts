/**
 * Visibility state machine. PURE — vendor scores + flags →
 * `{ visibility, reason }`. Precedence (fail-closed on CSAM, fail-OPEN on vendor
 * outage so an outage can't blank the site):
 *   1. csam            → hidden (short-circuit, irreversible-by-UI)
 *   2. vendorUnavailable → pending_review (fail-open, retry/backoff)
 *   3. nsfw ≥ HIDE     → hidden
 *   4. nsfw ≥ REVIEW   → pending_review
 *   5. impersonation   → pending_review (flag ≠ hidden; renders as a badge)
 * 6. else → visible (`pending_review` REMAINS LISTED)
 */
import type { ModerationVisibility } from "@robbed/shared";

export interface ModerationSignals {
  csam: boolean;
  nsfw: number | null;
  violence?: number | null;
  vendorUnavailable?: boolean;
  impersonation?: boolean;
}

export interface VisibilityThresholds {
  hide: number; // default 0.95
  review: number; // default 0.80
}

export interface VisibilityVerdict {
  visibility: ModerationVisibility;
  reason: string;
}

export function evaluateVisibility(
  s: ModerationSignals,
  t: VisibilityThresholds,
): VisibilityVerdict {
  if (s.csam) return { visibility: "hidden", reason: "csam_match" };
  if (s.vendorUnavailable) {
    return { visibility: "pending_review", reason: "vendor_unavailable_fail_open" };
  }
  const nsfw = s.nsfw ?? 0;
  if (nsfw >= t.hide) return { visibility: "hidden", reason: "nsfw_over_hide_threshold" };
  if (nsfw >= t.review) {
    return { visibility: "pending_review", reason: "nsfw_over_review_threshold" };
  }
  if (s.impersonation) {
    return { visibility: "pending_review", reason: "impersonation_flag" };
  }
  return { visibility: "visible", reason: "clean" };
}
