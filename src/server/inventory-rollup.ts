import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import type { MakeRollupRow } from "~/lib/make-inventory";

// The rollup reads every live vehicle, so it reads the table in order
// (`not indexed`). Through an index, SQLite looks up each row separately,
// which Turso serves several times slower: minutes instead of seconds.
// Drizzle's query builder has no index hints, so this is plain SQL, and its
// rows are validated here.
const modelGroupSchema: z.ZodType<MakeRollupRow> = z.object({
  source: z.string(),
  code: z.string(),
  make: z.string(),
  model: z.string(),
  count: z.number().int(),
  minYear: z.number().int(),
  maxYear: z.number().int(),
});

/**
 * The live-inventory aggregate the make and model pages list. It reads the
 * whole vehicle table, so it runs once per publication, not per request.
 * Per-yard counts come from `yard_inventory`, which ingestion maintains.
 */
export const InventoryRollup = {
  /** Live vehicles per yard and raw make and model. */
  async models(database: LibSQLDatabase): Promise<MakeRollupRow[]> {
    const rows = await database.all(sql`
      select source, location_code as code, make, model, count(*) as count,
        min(year) as minYear, max(year) as maxYear
      from vehicle not indexed
      where missing_since_at is null
      group by source, location_code, make, model
    `);
    return z.array(modelGroupSchema).parse(rows);
  },
} as const;
