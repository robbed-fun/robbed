/**
 * Public API for the Token Detail view (FSD pages layer → `views`). The Next
 * route re-exports the default screen; `generateTokenMetadata` supplies the
 * per-token SSR metadata (og:image auto-wires from opengraph-image.tsx).
 */
export { default } from "./ui/TokenDetailView";
export { generateTokenMetadata } from "./model/metadata";
