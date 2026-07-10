/**
 * Not-yet-indexed grace before redirecting to `/t/[address]` (web.md §4
 * pending-shell case; §5.3 "token tradeable <1s, soft-confirmed").
 *
 * DECISION (hoodpad-frontend; basis: web.md WS decide-yourself — "REST is the
 * source of resumable truth"): the Token Detail server view `notFound()`s on a
 * 404 (M3-5, owned elsewhere, not touched here), so the flagship launch flow must
 * NOT navigate until the API can actually resolve the new token — otherwise the
 * creator lands on a 404 for their own launch. We therefore poll
 * `GET /v1/tokens/:address` (the same endpoint the detail view fetches) until it
 * resolves, then navigate. On a single FCFS sequencer + fast indexer this is
 * typically sub-second. If the grace window elapses without an indexed token
 * (indexer lagging/down) we DON'T force a 404 — the stepper surfaces a manual
 * "Open your token" link and lets the creator retry, never dropping their launch.
 *
 * Poll-over-WS is chosen deliberately: it is deterministic, needs no channel
 * plumbing on the launch screen, and an indexed WS `launch` implies the same REST
 * row anyway (one indexer). The whole thing is injectable for tests.
 */

export interface WaitForIndexedOptions {
  address: string;
  /** Resolves the token summary; throws/ rejects while the token is not indexed. */
  fetchToken: (address: string) => Promise<unknown>;
  /** Max poll attempts before giving up (default 30). */
  maxAttempts?: number;
  /** Delay between attempts, ms (default 500 → ~15s window). */
  delayMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Abort signal — stops polling if the user navigates away. */
  signal?: AbortSignal;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll until the token resolves. Returns `true` once indexed, `false` if the
 * grace window elapses (caller then shows the manual-open fallback). A resolved
 * `fetchToken` (any non-throwing return) counts as indexed.
 */
export async function waitForIndexed(opts: WaitForIndexedOptions): Promise<boolean> {
  const {
    address,
    fetchToken,
    maxAttempts = 30,
    delayMs = 500,
    sleep = defaultSleep,
    signal,
  } = opts;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) return false;
    try {
      await fetchToken(address);
      return true;
    } catch {
      // Not indexed yet (typically a 404). Wait and retry — a fetch error is
      // never treated as terminal; only running out of attempts ends the grace.
    }
    if (attempt < maxAttempts - 1) await sleep(delayMs);
  }
  return false;
}
