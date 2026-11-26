import { and, eq, isNull, ne, notExists, or, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { YardInventory, type YardSummary } from "~/lib/yard-inventory";
import { yardInventory, yardSummary } from "~/schema";
import { YardVehicles } from "./yard-vehicles";

/** Yards whose summaries are rebuilt at once; each reads one whole yard. */
const REBUILD_CONCURRENCY = 4;

const summarySchema: z.ZodType<YardSummary> = z.object({
  fingerprint: z.string(),
  total: z.number().int(),
  makes: z.array(
    z.object({ key: z.string(), make: z.string(), count: z.number().int() }),
  ),
  arrivals: z.array(
    z.object({ key: z.string(), knownAt: z.array(z.number()) }),
  ),
  makeLists: z.array(
    z.object({
      key: z.string(),
      fingerprint: z.string(),
      spellings: z.array(z.string()),
    }),
  ),
});

function parse(data: string): YardSummary | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = summarySchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * Yard page summaries kept in Turso (yard_summary), so a summary that falls
 * out of the data cache costs 2 rows instead of a read of the yard's
 * vehicles (1-12K rows). The inventory refresh stores them; pages read them.
 */
export const YardSummaryStore = {
  /**
   * The stored summary of a yard for its latest publication, or null when
   * none is stored for it (never stored, unreadable, or stored for an
   * earlier publication), so the caller reads the yard.
   */
  async read(
    database: LibSQLDatabase,
    source: string,
    code: string,
  ): Promise<YardSummary | null> {
    const [row] = await database
      .select({ data: yardSummary.data })
      .from(yardSummary)
      .innerJoin(
        yardInventory,
        and(
          eq(yardInventory.source, yardSummary.source),
          eq(yardInventory.locationCode, yardSummary.locationCode),
        ),
      )
      .where(
        and(
          eq(yardSummary.source, source),
          eq(yardSummary.locationCode, code),
          eq(yardSummary.builtFor, yardInventory.updatedAt),
        ),
      )
      .limit(1);
    return row ? parse(row.data) : null;
  },

  /**
   * Stores a summary for every yard whose stored one is missing or older
   * than its latest publication, and drops those of yards that left
   * yard_inventory. Reads each such yard once; a yard published since its
   * read is stored for the publication read and stored again next time.
   */
  async refresh(database: LibSQLDatabase): Promise<{ stored: number }> {
    await database.delete(yardSummary).where(
      notExists(
        database
          .select({ one: sql`1` })
          .from(yardInventory)
          .where(
            and(
              eq(yardInventory.source, yardSummary.source),
              eq(yardInventory.locationCode, yardSummary.locationCode),
            ),
          ),
      ),
    );
    const stale = await database
      .select({
        source: yardInventory.source,
        code: yardInventory.locationCode,
        updatedAt: yardInventory.updatedAt,
      })
      .from(yardInventory)
      .leftJoin(
        yardSummary,
        and(
          eq(yardSummary.source, yardInventory.source),
          eq(yardSummary.locationCode, yardInventory.locationCode),
        ),
      )
      .where(
        or(
          isNull(yardSummary.builtFor),
          ne(yardSummary.builtFor, yardInventory.updatedAt),
        ),
      );
    let next = 0;
    const worker = async () => {
      for (let yard = stale[next++]; yard !== undefined; yard = stale[next++]) {
        const read = await YardVehicles.all(database, yard.source, yard.code);
        const data = JSON.stringify(
          YardInventory.summary(read.vehicles, read.rawMakes),
        );
        await database
          .insert(yardSummary)
          .values({
            source: yard.source,
            locationCode: yard.code,
            builtFor: yard.updatedAt,
            data,
          })
          .onConflictDoUpdate({
            target: [yardSummary.source, yardSummary.locationCode],
            set: { builtFor: yard.updatedAt, data },
          });
      }
    };
    await Promise.all(Array.from({ length: REBUILD_CONCURRENCY }, worker));
    return { stored: stale.length };
  },

  /**
   * Drops every stored summary, after vehicles changed without a
   * publication (a search-index migration rewrote their identities).
   */
  async clear(database: LibSQLDatabase): Promise<void> {
    await database.delete(yardSummary);
  },
} as const;
