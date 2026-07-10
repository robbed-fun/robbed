/**
 * Object storage boundary (R2 in prod, minio in dev/CI — same S3 API). Behind an
 * INTERFACE so route tests inject an in-memory fake. The concrete impl uses
 * Bun's native `S3Client` (no extra dependency; §8 "R2 presigned upload" is
 * satisfied on the API→R2 leg with server credentials — never a browser-direct
 * presign of unmoderated bytes, api.md §3.1/§12.19).
 *
 * Objects are CONTENT-ADDRESSED → writes are idempotent and dedupe:
 *   images/{keccak256}.webp   metadata/{hash}.json
 */
export interface Storage {
  imageKey(keccak: string): string;
  metadataKey(hash: string): string;
  imageUrl(keccak: string): string;
  metadataUrl(hash: string): string;
  putImage(keccak: string, bytes: Uint8Array): Promise<void>;
  putMetadata(hash: string, json: string): Promise<void>;
  imageExists(keccak: string): Promise<boolean>;
  ping(): Promise<boolean>;
}

export interface StorageConfig {
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  bucket: string;
  publicBaseUrl: string;
}

function stripHashPrefix(h: string): string {
  return h.startsWith("0x") ? h.slice(2) : h;
}

export function createBunStorage(cfg: StorageConfig): Storage {
  // Bun global; typed loosely to avoid a hard compile dep on @types/bun S3.
  const { S3Client } = (globalThis as unknown as {
    Bun: { S3Client: new (o: unknown) => BunS3Client };
  }).Bun;
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    bucket: cfg.bucket,
  });
  const base = cfg.publicBaseUrl.replace(/\/+$/, "");

  const imageKey = (keccak: string) => `images/${stripHashPrefix(keccak)}.webp`;
  const metadataKey = (hash: string) => `metadata/${stripHashPrefix(hash)}.json`;

  return {
    imageKey,
    metadataKey,
    imageUrl: (keccak) => `${base}/${imageKey(keccak)}`,
    metadataUrl: (hash) => `${base}/${metadataKey(hash)}`,
    async putImage(keccak, bytes) {
      await client.file(imageKey(keccak)).write(bytes, { type: "image/webp" });
    },
    async putMetadata(hash, json) {
      await client.file(metadataKey(hash)).write(json, { type: "application/json" });
    },
    async imageExists(keccak) {
      return client.file(imageKey(keccak)).exists();
    },
    async ping() {
      try {
        // A HEAD on a well-known key path; existence false is still "reachable".
        await client.file("healthz").exists();
        return true;
      } catch {
        return false;
      }
    },
  };
}

interface BunS3File {
  write(data: Uint8Array | string, opts?: { type?: string }): Promise<number>;
  exists(): Promise<boolean>;
}
interface BunS3Client {
  file(key: string): BunS3File;
}
