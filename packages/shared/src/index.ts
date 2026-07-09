/**
 * @hoodpad/shared — frozen cross-service interface artifacts (contract-first).
 *
 * Module map (api.md §5): abi/events (canonical ABIs), confirmation,
 * channels, ws-messages, api-types, events (decoded structs), db-rows,
 * constants, metadata (canonicalization + keccak256 — spec §8.3/§12.19).
 */
export * from "./constants";
export * from "./confirmation";
export * from "./channels";
export * from "./ws-messages";
export * from "./api-types";
export * from "./events";
export * from "./db-rows";
export * from "./metadata";
export * from "./metadata.fixtures";
export * from "./abi/events";
