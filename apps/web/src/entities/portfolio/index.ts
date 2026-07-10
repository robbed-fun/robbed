/**
 * Public API for the `portfolio` entity (FSD reference/public-api). The
 * `/portfolio` view (§5.4 / ROBBED_ redesign page 4) consumes ONLY this barrel:
 *   - `model/queries`  — the four `/v1/portfolio/*` TanStack Query hooks.
 *   - `ui/PnlRange`    — honest nullable/range PnL display (§5.2).
 *   - `ui/HoldingRow`  — a HOLDINGS table/card row + the shared grid template
 *                        and the typed `holdingColumns` model.
 *   - `lib/format`     — portfolio-local display formatters.
 * The `api/portfolio` transport stays internal (hooks are the surface).
 */
export * from "./model/queries";
export * from "./ui/PnlRange";
export * from "./ui/HoldingRow";
export * from "./lib/format";
