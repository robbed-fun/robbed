/**
 * Public API for the `get-testnet-eth` feature (FSD public-api rule:
 * feature-sliced.design/docs/reference/public-api).
 */
export { FaucetCta } from "./ui/FaucetCta";
export { useFaucetCta, shouldShowFaucetCta } from "./model/use-faucet-cta";
export { faucetsFor, buildFaucetUrl, type FaucetLinks } from "./config/faucets";
