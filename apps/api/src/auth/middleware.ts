/**
 * User auth middleware (spec §12.63b). `requireUser` verifies the stateless
 * signed `robbed_user_session` cookie and pins the signer address onto the
 * context for the comment POST handler (`author` is taken from HERE, never the
 * client body). Throws `unauthorized` (401) when absent/invalid.
 *
 * Separate from `requireAdmin` (admin/middleware.ts): a user session confers NO
 * admin capability — it only proves "this address signed in". No allowlist, no
 * CSRF nonce (SameSite=Lax cookie is the CSRF defense — session.ts).
 */
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppDeps } from "../deps";
import { errors } from "../lib/errors";
import { USER_SESSION_COOKIE, verifyUserSession } from "./session";

export type UserVars = { userAddress?: string };

export function requireUser(deps: AppDeps): MiddlewareHandler<{ Variables: UserVars }> {
  return async (c, next) => {
    const cookie = getCookie(c, USER_SESSION_COOKIE);
    const session = verifyUserSession(
      deps.config.SESSION_SECRET,
      cookie,
      Math.floor(deps.now() / 1000),
    );
    if (!session) throw errors.unauthorized("sign-in required");
    c.set("userAddress", session.addr);
    await next();
  };
}
