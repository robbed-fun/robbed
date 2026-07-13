/**
 * Creator-fee claim surface (spec §7 / §12.63). `GET /v1/creators/:address/
 * claimable` → the shared `CreatorClaimable` DTO: lifetime accrued/claimed from
 * the indexed `creator_claimable` roll-up + the AUTHORITATIVE live
 * `CreatorVault.balanceOf(creator)` as `claimableEth` (falling back to the
 * event-derived mirror when no RPC is configured). USD is computed at request
 * time (§2). Read-only; never touches chain state (§8.4).
 *
 * Vault resolution: the creator's `creator_claimable.vault` (once they have
 * accrued) else the configured `CREATOR_VAULT_ADDRESS`. When NEITHER exists (a
 * v1/treasury-only deployment with no vault, and the creator never accrued) the
 * endpoint 404s — there is no vault to read. Endpoint shape is a sensible default
 * pending architect ratification (flagged).
 */
import { Hono } from "hono";
import { addressSchema, creatorClaimableSchema } from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { parse } from "../lib/validate";
import { usdFromWei } from "../lib/usd";
import { resolveSnapshot } from "../projections/common";
import { toCreatorClaimable } from "../projections/creatorClaimable";
import { loadProjectionContext } from "./context";

export function creatorRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/creators/:address/claimable", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());

    const [row, ctx] = await Promise.all([
      deps.db.getCreatorClaimable(address),
      loadProjectionContext(deps),
    ]);

    // Vault: the creator's own row wins (indexed from events), else the config
    // fallback. No vault anywhere ⇒ nothing to claim on this deployment ⇒ 404.
    const vault = row?.vault ?? deps.config.creatorVaultAddress ?? null;
    if (!vault) throw errors.notFound("no creator-fee vault for this deployment");

    // Authoritative live balanceOf; null (no RPC / failure) ⇒ projection uses the
    // accrued − claimed mirror. Cold read, never the hot path (row-9 rule).
    const liveBalanceEth = await deps.creatorVaultBalance.read({ vault, creator: address });

    const snap = resolveSnapshot(ctx.ethUsd);
    const nowMs = deps.now();
    const body = toCreatorClaimable({
      creator: address,
      vault,
      row,
      liveBalanceEth,
      usd: (claimableEth) => usdFromWei(claimableEth, snap, nowMs),
      asOf: new Date(nowMs).toISOString(),
    });
    return ok(c, creatorClaimableSchema.parse(body));
  });

  return app;
}
