/**
 * Top holders with creator/curve/lp_pool/vault flags (§5.2 top-20, api.md §3.4)
 * plus the v1.2 advisory `botFlags`/`clusterId` from indexer `address_flags`.
 * Flags are computed at query time (indexer.md §3.6 — not stored).
 */
import { Hono } from "hono";
import { addressSchema, holdersResponseSchema } from "@robbed/shared";
import { z } from "zod";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { clampLimit } from "../lib/pagination";
import { parse, parseQuery } from "../lib/validate";
import { type SpecialAddresses, toHolderRow } from "../projections/holder";

const holdersQuerySchema = z.object({ limit: z.string().optional() });

export function holderRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/tokens/:address/holders", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    const token = await deps.db.getTokenListRow(address);
    if (!token) throw errors.notFound("token not found");
    const q = parseQuery(holdersQuerySchema, c);
    const limit = clampLimit(q.limit ?? "20");

    const vaults = new Set<string>();
    if (deps.config.TREASURY_ADDRESS) vaults.add(deps.config.TREASURY_ADDRESS.toLowerCase());
    if (deps.config.LP_FEE_VAULT_ADDRESS) vaults.add(deps.config.LP_FEE_VAULT_ADDRESS.toLowerCase());
    const special: SpecialAddresses = {
      creator: token.creator,
      curve: token.curve_address,
      pool: token.v3_pool_address,
      vaults,
    };

    const rows = await deps.db.getHolders({ token: address, limit });
    const holders = rows.map((r) => toHolderRow(r, token.total_supply, special));
    return ok(c, holdersResponseSchema.parse({ holders, holderCount: token.holder_count }));
  });

  return app;
}
