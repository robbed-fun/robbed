/**
 * pg-backed DbPort — the fallback sweep's read-only query against the
 * indexer-owned `tokens` table. Read-only: the keeper NEVER mutates indexer
 * state (moderation/listing gates only; chain state is the source of truth).
 */
import { Pool } from "pg";
import { queryGraduatedLpPositions, queryReadyCurves, queryTreasuryFeeCurves } from "./db";
import type { DbPort, GraduatedLpPosition, ReadyCurve, TreasuryFeeCurve } from "./types";

export class PgKeeperDb implements DbPort {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 2, application_name: "robbed-keeper" });
  }

  findReadyCurves(): Promise<ReadyCurve[]> {
    return queryReadyCurves(this.pool);
  }

  findTreasuryFeeCurves(): Promise<TreasuryFeeCurve[]> {
    return queryTreasuryFeeCurves(this.pool);
  }

  findGraduatedLpPositions(): Promise<GraduatedLpPosition[]> {
    return queryGraduatedLpPositions(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
