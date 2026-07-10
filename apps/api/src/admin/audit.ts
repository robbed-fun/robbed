/**
 * Admin audit log (§6.2): every mutation records actor/action/target/reason/ts.
 * Written to the API-owned audit table via the RW role only (never indexer
 * tables). Thin wrapper so action names stay consistent across routes.
 */
import type { Db } from "../lib/db";

export const AUDIT_ACTIONS = {
  setVisibility: "moderation.set_visibility",
  setImpersonation: "moderation.set_impersonation",
  reverify: "metadata.reverify",
  login: "admin.login",
} as const;

export async function recordAudit(
  db: Db,
  entry: { actor: string; action: string; target: string; reason: string | null },
): Promise<void> {
  await db.insertAudit(entry);
}
