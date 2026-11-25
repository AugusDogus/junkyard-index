import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import type { MakeRollupRow } from "~/lib/make-inventory";

// The rollup reads every live vehicle, so it reads the table in order
// (`not indexed`). Through an index, SQLite looks up each row separately,
// which Turso serves several times slower: minutes instead of seconds.
// Drizzle's query builder has no index hints, so this is plain SQL, and its
// rows are validated here.
/** A rollup row with the states and colors its vehicles list. */
export type RollupRow = MakeRollupRow & {
  states: string[];
  colors: string[];
};

// json_group_array(distinct ...) lists null for vehicles without a value;
// filters offer only real values.
const valuesSchema = z
  .string()
  .transform((text, context) => {
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      context.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(z.array(z.string().nullable()))
  .transform((values) => values.filter((value): value is string => !!value));

const modelGroupSchema = z.object({
  source: z.string(),
  code: z.string(),
  make: z.string(),
  model: z.string(),
  count: z.number().int(),
  minYear: z.number().int(),
  maxYear: z.number().int(),
  states: valuesSchema,
  colors: valuesSchema,
});

/**
 * The live-inventory aggregate the make and model pages list, and the
 * states and colors the search filters offer. It reads the whole vehicle
 * table, so it runs once per publication, not per request; the states and
 * colors cost no extra rows (976K with them, 973K without, on production in
 * November 2026). Per-yard counts come from `yard_inventory`, which
 * ingestion maintains.
 */
export const InventoryRollup = {
  /** Live vehicles per yard and raw make and model. */
  async models(database: LibSQLDatabase): Promise<RollupRow[]> {
    const rows = await database.all(sql`
      select source, location_code as code, make, model, count(*) as count,
        min(year) as minYear, max(year) as maxYear,
        json_group_array(distinct state) as states,
        json_group_array(distinct color) as colors
      from vehicle not indexed
      where missing_since_at is null
      group by source, location_code, make, model
    `);
    return z.array(modelGroupSchema).parse(rows);
  },
} as const;
