# ROBBED_ — Per-Service Plans (index)

**Genre: EXECUTION** — granular, per-service working plans: the build sliced by *who* (service) rather than by *when* (phase). They expand each master-plan item into its file map, the specific test that proves it, and its intra-service dependencies. **Owner of this index:** robbed-architect; each plan is owned by its service agent (table below). Does **not** belong here: system design ("what the system is" → `docs/services/`), decision records (→ `docs/decisions.md`), operational how-to (→ `docs/runbooks/`), completed/superseded plans (→ `docs/archive/`). Genre map: [`docs/README.md`](../README.md).

**Naming rule (2026-07-12):** every plan file is **`<service>-plan.md`** — basenames stay unique across all of `docs/` so named-doc resolution in tooling (`scripts/doc-check.ts`) and in prose can never collide with `docs/services/<service>.md` (the old `api.md`-in-both-directories collision class is retired; decisions.md §14).

## Authority rule (read this first)

`docs/implementation-plan.md` is the **single `/goal` checkbox authority** — it holds the canonical item IDs, the verify commands, and the done/not-done state. These per-service plans are **detail, not a second source of truth.** Every task here links back to its master item ID (e.g. `⇐ M1-8`). If a per-service plan and the master plan ever disagree, **the master plan wins and the per-service plan is corrected** (development-flow §1). Do not check boxes here; `/goal` tracks state in the master plan only.

## The plans

| Service | Plan | Owning agent | Master-plan slice | Driving design doc |
|---|---|---|---|---|
| Contracts | [contracts-plan.md](contracts-plan.md) | robbed-contracts | M1-* · T-1/T-3/T-4 · I-2/I-4/I-5a (chain legs) | docs/services/contracts.md |
| Shared package | [shared-plan.md](shared-plan.md) | robbed-shared | M2-1 · X-1/X-6/X-13 · workspace config | (interfaces across all service docs) |
| Indexer | [indexer-plan.md](indexer-plan.md) | robbed-indexer | M2-0/0b · M2-4…M2-8 · M2-13/14 · T-5 | docs/services/indexer.md |
| API + WS | [api-plan.md](api-plan.md) | robbed-indexer | M2-2 · M2-9…M2-12 · I-1/I-3 | docs/services/api.md |
| Web | [web-plan.md](web-plan.md) | robbed-frontend | M3-* · I-5a/I-5b · M3-11 flow catalog | docs/services/web.md |

Integration (Phase I), Testnet (Phase T) and Prod-prep (Phase P) are cross-service and stay in the master plan; each per-service plan lists only its own legs of those phases.

## How to use

- `/goal` reads the **master plan** and picks the next eligible item.
- The owning agent, when it starts that item, opens **its per-service plan** for the sub-task breakdown, file map, and the proving test.
- When a service's shape must change (a shared schema, an interface), the change follows the development-flow ratification protocol — the design doc changes first, then the per-service plan, then the master item if the sequencing shifts.
- When a plan is **completed or superseded**, it moves to `docs/archive/` with a completion date and a superseding pointer (see [`docs/archive/README.md`](../archive/README.md)); it is never silently deleted.
