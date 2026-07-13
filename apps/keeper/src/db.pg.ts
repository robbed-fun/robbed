/**
 * pg-backed DbPort — the fallback sweep's read-only query against the
 * indexer-owned `tokens` table. Read-only: the keeper NEVER mutates indexer
 * state (moderation/listing gates only; chain state is the source of truth).
 */
import { Pool } from "pg";
import { queryReadyCurves } from "./db";
import type { DbPort, ReadyCurve } from "./types";

export class PgKeeperDb implements DbPort {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 2, application_name: "robbed-keeper" });
  }

  findReadyCurves(): Promise<ReadyCurve[]> {
    return queryReadyCurves(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
