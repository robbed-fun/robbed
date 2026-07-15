/**
 * Top-holders table — SERVER-side sorted + keyset-paginated
 *. `?sort` comes from the shared closed allowlist (`holderListQuerySchema`
 * → 400 on anything else — the ORDER BY security boundary): rank/amount/percent →
 * balance, address → holder, label → a deterministic structural-role CASE. First page
 * (default limit) is the top-N view. Every row carries its true balance-desc
 * `rank` (ROW_NUMBER over the whole token) plus the creator/curve/lp_pool/vault
 * flags and v1.2 advisory `botFlags`/`clusterId` from indexer `address_flags`
 * (computed at query time — indexer.md). Uniform `{ items, nextCursor }`.
 */
import { Hono } from "hono";
import { addressSchema, holderListQuerySchema, paginatedHoldersResponseSchema } from "@robbed/shared";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { ok } from "../lib/envelope";
import { decodeCursor, encodeCursor } from "../lib/pagination";
import { HOLDER_DIR_DEFAULT, HOLDER_SORT_DEFAULT, holderSortKey } from "../lib/listSort";
import { parse, parseQuery } from "../lib/validate";
import { type SpecialAddresses, toHolderRow } from "../projections/holder";

export function holderRoutes(deps: AppDeps) {
  const app = new Hono();

  app.get("/v1/tokens/:address/holders", async (c) => {
    const address = parse(addressSchema, c.req.param("address").toLowerCase());
    const token = await deps.db.getTokenListRow(address);
    if (!token) throw errors.notFound("token not found");
    // sort/dir/cursor/limit from the shared allowlist schema (out-of-allowlist ⇒ 400).
    const q = parseQuery(holderListQuerySchema, c);
    const sort = q.sort ?? HOLDER_SORT_DEFAULT;
    const dir = q.dir ?? HOLDER_DIR_DEFAULT;
    const cursor = decodeCursor(deps.config.SESSION_SECRET, q.cursor);

    const vaults = new Set<string>();
    if (deps.config.TREASURY_ADDRESS) vaults.add(deps.config.TREASURY_ADDRESS.toLowerCase());
    if (deps.config.LP_FEE_VAULT_ADDRESS) vaults.add(deps.config.LP_FEE_VAULT_ADDRESS.toLowerCase());
    // ONE special-address object feeds both the structural label-sort CASE
    // (getHolders) and the flag projection (toHolderRow) — the label shown and
    // the label sorted by are single-sourced (projections/holder.ts SpecialAddresses).
    const special: SpecialAddresses = {
      creator: token.creator,
      curve: token.curve_address,
      pool: token.v3_pool_address,
      vaults,
    };

    const rows = await deps.db.getHolders({
      token: address,
      sort,
      dir,
      cursorKey: cursor?.k ?? null,
      cursorId: cursor?.i ?? null,
      limit: q.limit + 1,
      special,
    });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    const items = page.map((r) => toHolderRow(r, token.total_supply, special));
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(deps.config.SESSION_SECRET, { k: holderSortKey(sort, last), i: last.holder })
        : null;
    return ok(c, paginatedHoldersResponseSchema.parse({ items, nextCursor }));
  });

  return app;
}
