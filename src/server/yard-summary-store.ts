import { and, asc, eq, notExists, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";
import { YardInventory, type YardSummary } from "~/lib/yard-inventory";
import { yardInventory, yardSummary } from "~/schema";
import { YardVehicles } from "./yard-vehicles";

/** A yard of a source, as yard_inventory and cache tags name it. */
export type YardKey = { source: string; code: string };

/**
 * What a refresh did: how many summaries it stored, and the yards whose
 * pages show something new (no summary before, or another content hash).
 */
export type YardSummaryRefresh = { stored: number; changed: YardKey[] };

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

/** A yard to summarize, with what its stored summary had, if any. */
type YardToStore = YardKey & { updatedAt: Date; contentHash: string | null };

/**
 * Reads each yard once and stores its summary for the publication read
 * (`updatedAt`), stamping `content_changed_at` when what its pages show
 * changed. Returns the yards that changed.
 */
async function store(
  database: LibSQLDatabase,
  yards: readonly YardToStore[],
  now: Date,
): Promise<YardKey[]> {
  const changed = new Set<number>();
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < yards.length; index = next++) {
      const yard = yards[index];
      if (!yard) continue;
      const read = await YardVehicles.all(database, yard.source, yard.code);
      const contentHash = YardInventory.contentHash(read.vehicles);
      const isChanged = contentHash !== yard.contentHash;
      if (isChanged) changed.add(index);
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
          contentHash,
          contentChangedAt: now,
        })
        .onConflictDoUpdate({
          target: [yardSummary.source, yardSummary.locationCode],
          set: {
            builtFor: yard.updatedAt,
            data,
            contentHash,
            ...(isChanged && { contentChangedAt: now }),
          },
        });
    }
  };
  await Promise.all(Array.from({ length: REBUILD_CONCURRENCY }, worker));
  return yards
    .filter((_, index) => changed.has(index))
    .map(({ source, code }) => ({ source, code }));
}

/** Every yard with live inventory and what its stored summary has, if any. */
function yardsWithSummaries(database: LibSQLDatabase) {
  return database
    .select({
      source: yardInventory.source,
      code: yardInventory.locationCode,
      updatedAt: yardInventory.updatedAt,
      builtFor: yardSummary.builtFor,
      contentHash: yardSummary.contentHash,
    })
    .from(yardInventory)
    .leftJoin(
      yardSummary,
      and(
        eq(yardSummary.source, yardInventory.source),
        eq(yardSummary.locationCode, yardInventory.locationCode),
      ),
    )
    .orderBy(asc(yardInventory.source), asc(yardInventory.locationCode));
}

/**
 * Yard page summaries kept in Turso (yard_summary), so a summary that falls
 * out of the data cache costs one row instead of a read of the yard's
 * vehicles (1-12K rows). Deploys store any that are missing (`fill`), the
 * inventory refresh stores the published ones (`refresh`), and pages read
 * them (`read`).
 */
export const YardSummaryStore = {
  /**
   * A yard's stored summary, as of the last refresh that stored it: the
   * same read the cached pages show until that refresh expires them. Null
   * when none is stored or it is unreadable; the caller reads the yard.
   */
  async read(
    database: LibSQLDatabase,
    source: string,
    code: string,
  ): Promise<YardSummary | null> {
    const [row] = await database
      .select({ data: yardSummary.data })
      .from(yardSummary)
      .where(
        and(eq(yardSummary.source, source), eq(yardSummary.locationCode, code)),
      )
      .limit(1);
    return row ? parse(row.data) : null;
  },

  /**
   * Stores a summary for every yard whose stored one is missing or older
   * than its latest publication, and drops those of yards that left
   * yard_inventory. Also rebuilds every yard of `rebuild`: the sources of
   * runs that ended without publishing since the last refresh (they may
   * have written vehicles while yard_inventory still names the old
   * publication), or "all" when that refresh's read is unknown. Reads each
   * such yard once; a yard published since its read is stored for the
   * publication read and stored again next time. Returns the yards whose
   * vehicles changed anything their pages show.
   */
  async refresh(
    database: LibSQLDatabase,
    now: Date,
    rebuild: readonly string[] | "all",
  ): Promise<YardSummaryRefresh> {
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
    const stale = (await yardsWithSummaries(database)).filter(
      (yard) =>
        rebuild === "all" ||
        rebuild.includes(yard.source) ||
        yard.builtFor === null ||
        yard.builtFor.getTime() !== yard.updatedAt.getTime(),
    );
    return { stored: stale.length, changed: await store(database, stale, now) };
  },

  /**
   * Stores a summary for every yard that has none, as a deploy does after
   * migrating (and after `clear`), so no page reads a whole yard while it
   * waits for the next refresh.
   */
  async fill(database: LibSQLDatabase, now: Date): Promise<{ stored: number }> {
    const missing = (await yardsWithSummaries(database)).filter(
      (yard) => yard.builtFor === null,
    );
    await store(database, missing, now);
    return { stored: missing.length };
  },

  /**
   * Drops every stored summary, after vehicles changed without a
   * publication (a search-index migration rewrote their identities). Call
   * `fill` after it.
   */
  async clear(database: LibSQLDatabase): Promise<void> {
    await database.delete(yardSummary);
  },
} as const;
