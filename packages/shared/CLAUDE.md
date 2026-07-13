# packages/shared — the single source of cross-service truth (owner: robbed-shared)

Every cross-service type, Zod schema (WS/REST), event ABI artifact, and the metadata canonicalizer lives HERE, once. Zod-first: TS types via `z.infer`. Apps consume via `workspace:*` — they never redeclare (the anti-drift rule loads with this subtree).

- `bun test` · `bun run typecheck` — **every change ships tests**; canonicalizer changes need exhaustive vectors.
- `src/abi/` is codegen output from `contracts/script/codegen-abi.ts`, COMMITTED and consumed without a build step (§12.38). Regenerate, never hand-edit.
- Shared lib versions pin via pnpm catalogs (`zod` / `viem` / `hono`) in `pnpm-workspace.yaml`.
- Workspace config (pnpm-workspace.yaml, root package.json, pnpm-lock.yaml) is also robbed-shared territory — route dependency/workspace changes through that agent.
