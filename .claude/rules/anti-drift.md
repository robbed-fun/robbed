---
paths:
  - "apps/**"
  - "packages/**"
---

# Anti-drift — one source for every shared shape

- Every cross-service type, schema, or ABI lives ONCE in `packages/shared` (Zod-first; TS types via `z.infer`). Apps import — **never redeclare**.
- Any logic used by ≥2 services is extracted to `packages/*`.
- ABIs in `packages/shared/src/abi/` are codegen output from `contracts/script/codegen-abi.ts`, committed and consumed without a build step (§12.38) — regenerate, never hand-edit or paste locally.
- Internal deps via `workspace:*`; shared lib versions via pnpm catalogs (`pnpm-workspace.yaml`); one lockfile: `pnpm-lock.yaml`.
- `packages/*` and workspace config (pnpm-workspace.yaml, root package.json, lockfile) are owned by the **robbed-shared** agent — propose shape changes there; app agents consume, never define.
