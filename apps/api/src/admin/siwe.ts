/**
 * SIWE (EIP-4361) admin login (§6.2). Nonce is single-use in Redis (replay
 * defense); signature verified with viem; the recovered address must be in the
 * config allowlist (OI-A8 open — dev allowlist meanwhile). On success a stateless
 * session cookie is issued (session.ts).
 *
 * The signature verifier is INJECTABLE so the login lifecycle can be unit-tested
 * without a real wallet signature. Default verifier is viem `verifyMessage`
 * (EOA). NOTE: EIP-1271 smart-account verification needs a public client and is
 * not wired in v1 — flagged; Safe signers sign as EOAs.
 */
import { recoverMessageAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";
import type { Redis } from "../lib/redis";
import { randomToken } from "../lib/crypto";
import { errors } from "../lib/errors";

const NONCE_TTL_SECONDS = 10 * 60;
const nonceKey = (nonce: string) => `siwe:nonce:${nonce}`;

export type SignatureVerifier = (args: {
  address: `0x${string}`;
  message: string;
  signature: `0x${string}`;
}) => Promise<boolean>;

/** Default EOA verifier: recover the signer offline and compare (no client). */
export const viemVerifier: SignatureVerifier = async ({ address, message, signature }) => {
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    return recovered.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
};

/** Issue a fresh nonce and store it single-use in Redis. */
export async function issueNonce(redis: Redis): Promise<string> {
  const nonce = randomToken(16).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
  await redis.set(nonceKey(nonce), "1", { exSeconds: NONCE_TTL_SECONDS, nx: true });
  return nonce;
}

export interface VerifiedLogin {
  address: string; // lowercased
  nonce: string;
}

/**
 * Verify a SIWE login. Steps: parse → allowlist check → signature check → nonce
 * burn (delete after successful use so a replay fails). Throws `unauthorized`.
 */
export async function verifySiweLogin(
  args: { message: string; signature: `0x${string}` },
  deps: {
    redis: Redis;
    allowlist: Set<string>;
    verify?: SignatureVerifier;
    nowSec?: number;
  },
): Promise<VerifiedLogin> {
  const parsed = parseSiweMessage(args.message);
  const address = parsed.address?.toLowerCase();
  const nonce = parsed.nonce;
  if (!address || !nonce) throw errors.unauthorized("malformed SIWE message");

  if (parsed.expirationTime && parsed.expirationTime.getTime() < (deps.nowSec ?? Date.now() / 1000) * 1000) {
    throw errors.unauthorized("SIWE message expired");
  }
  if (!deps.allowlist.has(address)) throw errors.unauthorized("address not in admin allowlist");

  // Nonce must exist (issued + unused); burn it now to prevent replay.
  const present = await deps.redis.get(nonceKey(nonce));
  if (!present) throw errors.unauthorized("unknown or reused nonce");

  const verify = deps.verify ?? viemVerifier;
  const ok = await verify({
    address: address as `0x${string}`,
    message: args.message,
    signature: args.signature,
  });
  if (!ok) throw errors.unauthorized("signature verification failed");

  await deps.redis.del(nonceKey(nonce)); // single-use
  return { address, nonce };
}
