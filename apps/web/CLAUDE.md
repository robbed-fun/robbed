# apps/web — Next.js frontend (owner: robbed-frontend)

Next.js 16 + React 19 — **exact majors, no ranges** — App Router on Bun, structured with Feature-Sliced Design (`entities/ features/ widgets/ views/ shared/`), wagmi v2 + viem + RainbowKit, TanStack Query + WebSocket, lightweight-charts, Tailwind dark-first, satori OG images.

Three pages (design doc `docs/developers/web.md`): Discover `/`, Token Detail `/t/[address]`, Launch `/launch` — including the Trust panel and all user-facing copy. The copy rules load with this subtree (`.claude/rules/lp-copy.md`): canonical LP sentence, never "order book", confirmation tiers named soft-confirmed → posted-to-L1 → finalized.

## Commands

- `bun run typecheck` · `bun run test` (Vitest: copy-lint + component tests)
- e2e lives in `e2e/` (own CLAUDE.md; owner **robbed-e2e**) — `bun run e2e` needs a running stack (`bun run dev:d` at repo root)
- Cloudflare deploys via OpenNext: root `deploy:cf:mainnet` / `deploy:cf:testnet` scripts

## Gotchas

- `.env.mainnet` / `.env.testnet` / `.env.production` are **committed build config** — `NEXT_PUBLIC_*` only, public by construction. A real secret goes in `.env.local` (ignored) or a Worker secret binding, never in these files.
- All data shapes come from `@robbed/shared` + the API — never redeclare (anti-drift rule).
- Humanize contract errors by decoding the ABI error name — never substring-match viem's verbose message text.
- `cloudflare-env.d.ts` is generated (`bun run cf-typegen`), not committed; `next-env.d.ts` IS committed.
