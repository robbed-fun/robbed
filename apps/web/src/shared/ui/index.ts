/**
 * Public API for the `shared/ui` slice (FSD: feature-sliced.design/docs/reference/public-api).
 *
 * Two kinds of business-agnostic UI live here and are re-exported together so the
 * rest of the app imports from ONE path (`@/shared/ui`):
 *   - `./kit/*` — the vendored shadcn primitives (Button, Badge, Card, …). These
 *     are lint-EXEMPT for raw colors (they own their token contract); the
 *     token-bypass lint excludes `shared/ui/kit`.
 *   - `./*` — robbed's own business-agnostic display components (Amount,
 *     UsdAmount, ProgressBar, RelativeTime, EmptyState, ErrorState, AddressLink,
 *     TokenAvatar). These ARE linted (no raw colors) like all our source.
 *
 * Intra-slice imports (e.g. ProgressBar → ./kit/progress) use RELATIVE paths, not
 * this barrel, to avoid an index self-cycle.
 */

// shadcn kit (restyled to the ROBBED_ terminal tokens — Phase F)
export * from "./kit/badge";
export * from "./kit/button";
export * from "./kit/card";
export * from "./kit/input";
export * from "./kit/progress";
export * from "./kit/skeleton";
export * from "./kit/tabs";
export * from "./kit/textarea";
export * from "./kit/tooltip";

// business-agnostic display UI (pre-redesign set — still consumed by widgets)
export * from "./Amount";
export * from "./UsdAmount";
export * from "./ProgressBar";
export * from "./RelativeTime";
export * from "./EmptyState";
export * from "./ErrorState";
export * from "./AddressLink";
export * from "./TokenAvatar";

// ROBBED_ terminal atoms (redesign Phase F — docs/design/robbed-redesign-plan.md)
export * from "./MonoText";
export * from "./Chip";
export * from "./TabBar";
export * from "./SideBadge";
export * from "./Delta";
export * from "./StatCell";
export * from "./CursorTag";
export * from "./Wordmark";
export * from "./Divider";
export * from "./AddressChip";
export * from "./LiveDot";
export * from "./AmountInput";

// reusable headless table (TanStack Table v8 wrapper — stable-ref contract)
export * from "./DataTable";
