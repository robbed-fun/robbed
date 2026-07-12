/**
 * Public API for the `switch-network` feature (FSD public-api rule:
 * feature-sliced.design/docs/reference/public-api). The hook and the
 * presentational banner are exported SEPARATELY so the composing widget owns
 * the single `useNetworkGuard` instance (see WrongNetworkBanner note).
 */
export { useNetworkGuard, type NetworkGuard } from "./model/use-network-guard";
export { WrongNetworkBanner } from "./ui/WrongNetworkBanner";
