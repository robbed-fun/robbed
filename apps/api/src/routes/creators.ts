/**
 * Creator-fee claim surface. `GET /v1/creators/:address
 * claimable` → the shared `CreatorClaimable` DTO: lifetime accrued/claimed from
 * the indexed `creator_claimable` roll-up + the AUTHORITATIVE live
 * `CreatorVault.balanceOf(creator)` as `claimableEth` (falling back to the
 * event-derived mirror when no RPC is configured). USD is computed at request
 * time. Read-only; never touches chain state.
 *
 * Vault resolution: the creator's `creator_claimable.vault` (once they have
 * accrued) else the configured `CREATOR_VAULT_ADDRESS`. When NEITHER exists (a
 * v1/treasury-only deployment with no vault, and the creator never accrued) the
 * endpoint 404s — there is no vault to read. Endpoint shape is a sensible default
 * pending architect ratification (flagged).
 */
import { Hono } from "hono";
import {
  addressSchema,
  creatorClaimableSchema,
  creatorCurveClaimableSchema,
  creatorTokenClaimableSchema,
} from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { parse } from "../lib/validate";
import { usdFromWei } from "../lib/usd";
import { resolveSnapshot } from "../projections/common";
import { toCreatorClaimable } from "../projections/creatorClaimable";
import { toCreatorTokenClaimable } from "../projections/creatorTokenClaimable";
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

  // GET /v1/creators/:address/curve-claimable → pre-grad creator fees that
  // still sit on BondingCurve.accruedCreatorFees and must be swept before the
  // CreatorVault claim can withdraw them.
  app.get("/v1/creators/:address/curve-claimable", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    const sources = await deps.db.listCreatorCurveFeeSources(address);
    const asOf = new Date(deps.now()).toISOString();

    const rows = await Promise.all(
      sources.map(async (source) => {
        const unsweptEth = await deps.creatorCurveFees.read({ curve: source.curve_address });
        return {
          creator: address,
          token: source.token.toLowerCase(),
          ticker: source.ticker,
          curve: source.curve_address.toLowerCase(),
          unsweptEth: unsweptEth ?? "0",
          asOf,
        };
      }),
    );

    return ok(
      c,
      creatorCurveClaimableSchema
        .array()
        .parse(rows.filter((row) => BigInt(row.unsweptEth) > 0n)),
    );
  });

  // ── Post-graduation 50/50 split claim surface ────────────────
  // GET /v1/creators/:address/claimable/:token → the shared CreatorTokenClaimable DTO
  // for ONE (creator, ERC20-token) pair, matching `claimERC20(creator, token)` 1:1.
  // `claimable` is the AUTHORITATIVE live `CreatorVault.tokenBalanceOf(creator, token)`
  // (mirror fallback when no RPC). `token` is a graduated launch token (sell-leg) OR
  // canonical WETH (buy-leg, aggregated across the creator's tokens); USD only on the
  // WETH leg. Read-only; never touches chain state. Endpoint shape is a
  // sensible default pending architect ratification (doc-lockstep).
  app.get("/v1/creators/:address/claimable/:token", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    const token = parse(addressSchema, c.req.param("token").toLowerCase());

    const [row, ctx] = await Promise.all([
      deps.db.getCreatorTokenClaimable(address, token),
      loadProjectionContext(deps),
    ]);

    // Vault: the creator's own (creator, token) row wins (indexed from events), else
    // the config fallback. No vault anywhere ⇒ nothing to claim on this deployment ⇒ 404.
    const vault = row?.vault ?? deps.config.creatorVaultAddress ?? null;
    if (!vault) throw errors.notFound("no creator-fee vault for this deployment");

    // Authoritative live tokenBalanceOf; null (no RPC / failure) ⇒ mirror. Cold read.
    const liveClaimable = await deps.creatorVaultBalance.readToken({ vault, creator: address, token });

    const snap = resolveSnapshot(ctx.ethUsd);
    const nowMs = deps.now();
    const isWeth = deps.config.wethAddress != null && token === deps.config.wethAddress;
    const body = toCreatorTokenClaimable({
      creator: address,
      token,
      vault,
      row,
      liveClaimable,
      isWeth,
      usd: (claimable) => usdFromWei(claimable, snap, nowMs),
      asOf: new Date(nowMs).toISOString(),
    });
    return ok(c, creatorTokenClaimableSchema.parse(body));
  });

  // GET /v1/creators/:address/token-claimable → all post-grad ERC20 claim
  // buckets for the Portfolio Created tab. This is the enumerable companion to
  // the single-row `/claimable/:token` endpoint; each row still overlays the live
  // CreatorVault.tokenBalanceOf read before returning.
  app.get("/v1/creators/:address/token-claimable", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());

    const [rows, ctx] = await Promise.all([
      deps.db.listCreatorTokenClaimable(address),
      loadProjectionContext(deps),
    ]);

    if (rows.length === 0 && !deps.config.creatorVaultAddress) {
      throw errors.notFound("no creator-fee vault for this deployment");
    }

    const snap = resolveSnapshot(ctx.ethUsd);
    const nowMs = deps.now();
    const asOf = new Date(nowMs).toISOString();
    const bodies = await Promise.all(
      rows.map(async (row) => {
        const vault = row.vault ?? deps.config.creatorVaultAddress;
        if (!vault) throw errors.notFound("no creator-fee vault for this deployment");
        const token = row.token.toLowerCase();
        const liveClaimable = await deps.creatorVaultBalance.readToken({
          vault,
          creator: address,
          token,
        });
        const isWeth = deps.config.wethAddress != null && token === deps.config.wethAddress;
        return toCreatorTokenClaimable({
          creator: address,
          token,
          vault,
          row,
          liveClaimable,
          isWeth,
          usd: (claimable) => usdFromWei(claimable, snap, nowMs),
          asOf,
        });
      }),
    );

    return ok(c, creatorTokenClaimableSchema.array().parse(bodies));
  });

  return app;
}
