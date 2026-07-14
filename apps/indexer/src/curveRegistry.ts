/**
 * curve → token routing for the `Trade` handler (indexer.md). The `Trade`
 * event is emitted by the BondingCurve and carries no token field, so the
 * handler resolves the token from the emitting curve address
 * (`event.log.address`).
 *
 * Same zero-steady-state-read pattern as `GraduationRegistry`: populated by the
 * `TokenCreated` handler, lazily hydrated ONCE from the `tokens` table on the
 * first `Trade` after a restart (Ponder resumes from a checkpoint and won't
 * re-emit old `TokenCreated` events). One full scan of `tokens` on first use,
 * then never again.
 */
export class CurveRegistry {
  private readonly byCurve = new Map<string, string>(); // curve → token
  private hydrated = false;

  register(curveAddress: string, tokenAddress: string): void {
    this.byCurve.set(curveAddress.toLowerCase(), tokenAddress.toLowerCase());
  }

  async hydrateOnce(loader: () => Promise<Array<{ curve: string; token: string }>>): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    for (const { curve, token } of await loader()) this.register(curve, token);
  }

  lookup(curveAddress: string): string | undefined {
    return this.byCurve.get(curveAddress.toLowerCase());
  }

  get size(): number {
    return this.byCurve.size;
  }
}

export const curveRegistry = new CurveRegistry();
