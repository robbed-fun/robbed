/**
 * Public API for the `token` entity (FSD reference/public-api).
 *
 * PLACEMENT NOTE (hoodpad-frontend): the token sort/filter vocabulary + URL
 * parsers (`model/params`) live in this entity — sorting/filtering the token list
 * is a property of the token domain, consumed downward by both the Discover view
 * and the token-grid widget. The base REST client stays in `shared/api` (it is
 * the business-agnostic typed client over the frozen `@robbed/shared` contract),
 * so there is no `entities/token/api` segment for a pure refactor.
 */
export { TokenCard } from "./ui/TokenCard";
export * from "./model/params";
