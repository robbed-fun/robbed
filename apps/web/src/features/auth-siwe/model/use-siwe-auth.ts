"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";

import { sameOriginGet, sameOriginPost } from "@/shared/api";
import { env } from "@/shared/lib/env";

/**
 * SIWE (EIP-4361) sign-in for the comment author (spec §12.63b). Flow:
 *   GET  /v1/auth/nonce                     → single-use nonce
 *   sign an EIP-4361 message (viem `createSiweMessage`, wagmi `useSignMessage`)
 *   POST /v1/auth/login { message, signature } → sets `robbed_user_session` cookie
 *
 * All three hit THIS origin (same-origin proxy, next.config rewrite) with
 * `credentials: "include"`, since the cookie is same-origin + the API CORS is
 * credential-less.
 *
 * NOTE / GAP (robbed-shared): the auth request/response DTOs (`{ nonce }`,
 * `{ message, signature }`, `{ address }`) are NOT in `@robbed/shared` — no shared
 * schema exists for the SIWE lifecycle. These local schemas validate the wire
 * shape (they are NOT redeclarations of an existing shared type); flagged so the
 * lifecycle DTOs can be single-sourced later, matching the comment/creator DTOs.
 *
 * Session awareness: the `HttpOnly` cookie is unreadable by JS, so auth state is
 * per-session React state — set on a successful login. It resets when the
 * connected wallet changes (a new signer needs its own session); a stale/expired
 * cookie surfaces as a 401 on POST, which the panel handles by re-prompting login.
 */

const nonceSchema = z.object({ nonce: z.string().min(1) });
const loginResponseSchema = z.object({ address: z.string() });

export type SiwePhase = "idle" | "authenticating" | "error";

export interface SiweAuth {
  /** Lowercased address whose session is active this tab, else null. */
  authedAddress: string | null;
  phase: SiwePhase;
  error: string | null;
  /** Sign in the CONNECTED wallet; resolves true on success. */
  login: () => Promise<boolean>;
  reset: () => void;
}

export function useSiweAuth(): SiweAuth {
  const { address, chainId } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [authedAddress, setAuthedAddress] = useState<string | null>(null);
  const [phase, setPhase] = useState<SiwePhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // A different connected signer invalidates the current session view.
  const prevAccount = useRef<string | undefined>(address?.toLowerCase());
  useEffect(() => {
    const acct = address?.toLowerCase();
    if (acct !== prevAccount.current) {
      prevAccount.current = acct;
      setAuthedAddress(null);
      setPhase("idle");
      setError(null);
    }
  }, [address]);

  const login = useCallback(async (): Promise<boolean> => {
    if (!address) {
      setError("Connect a wallet to sign in.");
      return false;
    }
    setPhase("authenticating");
    setError(null);
    try {
      const { nonce } = await sameOriginGet("/v1/auth/nonce", nonceSchema);
      const message = createSiweMessage({
        address,
        chainId: chainId ?? env.chainId(),
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: "1",
        statement: "Sign in to comment on ROBBED_.",
      });
      const signature = await signMessageAsync({ message });
      const res = await sameOriginPost(
        "/v1/auth/login",
        { message, signature },
        loginResponseSchema,
      );
      setAuthedAddress(res.address.toLowerCase());
      setPhase("idle");
      return true;
    } catch (e) {
      setPhase("error");
      setError(humanizeAuthError(e));
      return false;
    }
  }, [address, chainId, signMessageAsync]);

  const reset = useCallback(() => {
    setAuthedAddress(null);
    setPhase("idle");
    setError(null);
  }, []);

  // The active session is only valid for the CURRENTLY-connected signer.
  const authed =
    authedAddress && address && authedAddress === address.toLowerCase()
      ? authedAddress
      : null;

  return { authedAddress: authed, phase, error, login, reset };
}

function humanizeAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/user rejected|denied|rejected the request/i.test(msg)) {
    return "Signature rejected in wallet.";
  }
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}
