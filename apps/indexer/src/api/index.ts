/**
 * Ponder API endpoints file — REQUIRED by Ponder ≥0.9 (`ponder dev` refuses to
 * boot without it; ponder.sh/docs/api-reference/ponder/api-endpoints).
 *
 * Dev/debug surface ONLY: exposes the auto-generated GraphQL API over the
 * Ponder-owned tables (host :4269 in the compose stack). The product read API
 * is apps/api (Hono) — nothing in the product may query this endpoint.
 * Shape is verbatim from the Ponder docs (docs-first, 2026-07-10).
 */
import { db } from "ponder:api";
import schema from "ponder:schema";
import { Hono } from "hono";
import { graphql } from "ponder";

const app = new Hono();

app.use("/", graphql({ db, schema }));
app.use("/graphql", graphql({ db, schema }));

export default app;
