/**
 * Build the canonical metadata DOCUMENT the client hashes for the
 * re-verification. This is the same "fixed field set + version tag" the API
 * canonicalizes (api.md) the version comes from the shared
 * `METADATA_VERSION` and the shape is validated by the shared
 * `tokenMetadataSchema` — nothing is redeclared. Key ORDER is irrelevant (the
 * shared canonicalizer sorts keys), but we still parse through the schema so the
 * client can only ever commit to a document with exactly the fields the contract
 * schema allows.
 */
import {
  METADATA_VERSION,
  type MetadataRequest,
  type TokenMetadata,
  tokenMetadataSchema,
} from "@robbed/shared";

export interface BuildMetadataInput {
  name: string;
  ticker: string;
  description?: string;
  links?: MetadataRequest["links"];
  /** Our CDN URL for the re-encoded image (from POST /v1/uploads/image). */
  imageUrl: string;
  /** keccak256 of the re-encoded image bytes (content address). */
  imageHash: string;
}

/**
 * The document (with version) — hashed locally to re-verify the API's commitment.
 * Optional fields are omitted (not set to undefined) so the parsed object matches
 * exactly what the server canonicalizes.
 */
export function buildMetadataDocument(input: BuildMetadataInput): TokenMetadata {
  const doc: Record<string, unknown> = {
    version: METADATA_VERSION,
    name: input.name,
    ticker: input.ticker,
    imageUrl: input.imageUrl,
    imageHash: input.imageHash,
  };
  if (input.description !== undefined && input.description !== "") {
    doc.description = input.description;
  }
  if (input.links && Object.values(input.links).some((v) => v)) {
    doc.links = input.links;
  }
  return tokenMetadataSchema.parse(doc);
}

/** The request body for POST /v1/metadata (server adds the version tag). */
export function buildMetadataRequest(input: BuildMetadataInput): MetadataRequest {
  const req: MetadataRequest = {
    name: input.name,
    ticker: input.ticker,
    imageUrl: input.imageUrl,
    imageHash: input.imageHash,
  };
  if (input.description !== undefined && input.description !== "") {
    req.description = input.description;
  }
  if (input.links && Object.values(input.links).some((v) => v)) {
    req.links = input.links;
  }
  return req;
}
