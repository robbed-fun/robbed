# apps/api — Hono API on Bun (owner: robbed-indexer)

Hono + Postgres: API-mediated R2 uploads, moderation queue, search (pg_trgm), creator endpoints. Design docs: `docs/developers/api.md` (routes, uploads, moderation, metadata integrity), `docs/developers/architecture.md` (off-chain architecture, confirmation states).

- `bun run dev` (hot reload) · `bun test` · `bun run typecheck`
- `openapi.yaml` documents every route and must parse as YAML (doc-check gate f) — update it in the same change as any route change.
- All request/response schemas come from `@robbed/shared` (Zod) — never redeclare (anti-drift rule); shape changes go through robbed-shared.
- API-owned tables are applied by the compose `apimigrations` one-shot — NOT the postgres init dir (a file mount inside that ro dir mount fails).
