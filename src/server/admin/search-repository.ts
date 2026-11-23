import { desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, vehicleChange } from "~/schema";

/** Unprocessed changes are counted up to this many, then shown as "N+". */
export const BACKLOG_COUNT_CAP = 10_000;

/** One ingestion run that published to search. */
export type SearchPublication = {
  runId: string;
  source: string;
  searchPublishedAt: Date;
  inventoryPublishedAt: Date | null;
  /** Vehicles in Turso when the run committed. */
  publishedVehicleCount: number | null;
  /**
   * published, or published_degraded when a source run in it was rejected:
   * for a single-source run, that source kept its previous inventory; for an
   * older run of every source ("all"), some sources were left out.
   */
  inventoryOutcome: string | null;
};

/** Changes no search publication has processed yet. */
export type UnprocessedChanges = {
  /** Capped at BACKLOG_COUNT_CAP; `capped` says whether there are more. */
  count: number;
  capped: boolean;
  oldestCreatedAt: Date | null;
};

/**
 * Bounded reads of search publication state: each uses an index and a limit,
 * and none touches the vehicle table or Algolia.
 */
export const SearchRepository = {
  /** Newest search publications, through the search_published_at index. */
  async recentPublications(
    database: LibSQLDatabase,
    limit: number,
  ): Promise<SearchPublication[]> {
    const rows = await database
      .select({
        runId: ingestionRun.id,
        source: ingestionRun.source,
        searchPublishedAt: ingestionRun.searchPublishedAt,
        inventoryPublishedAt: ingestionRun.inventoryPublishedAt,
        publishedVehicleCount: ingestionRun.publishedVehicleCount,
        inventoryOutcome: ingestionRun.inventoryOutcome,
      })
      .from(ingestionRun)
      .where(isNotNull(ingestionRun.searchPublishedAt))
      .orderBy(desc(ingestionRun.searchPublishedAt))
      .limit(limit);
    return rows.flatMap(({ searchPublishedAt, ...row }) =>
      searchPublishedAt === null ? [] : [{ ...row, searchPublishedAt }],
    );
  },

  /**
   * Outbox rows with no processed_at, through the processed_at index. Runs
   * publishing search inline delete their rows once searchable, so in inline
   * mode these are changes still waiting for search.
   */
  async unprocessedChanges(
    database: LibSQLDatabase,
  ): Promise<UnprocessedChanges> {
    const [counted, oldest] = await Promise.all([
      database.run(sql`
        select count(*) as n from (
          select 1 from ${vehicleChange}
          where ${vehicleChange.processedAt} is null
          limit ${BACKLOG_COUNT_CAP + 1}
        )
      `),
      database
        .select({ createdAt: vehicleChange.createdAt })
        .from(vehicleChange)
        .where(isNull(vehicleChange.processedAt))
        .orderBy(vehicleChange.processedAt, vehicleChange.id)
        .limit(1),
    ]);
    const count = Number(counted.rows[0]?.n ?? 0);
    return {
      count: Math.min(count, BACKLOG_COUNT_CAP),
      capped: count > BACKLOG_COUNT_CAP,
      oldestCreatedAt: oldest[0]?.createdAt ?? null,
    };
  },

  /**
   * Whether a run is marked as owing a full search rebuild, through the
   * full_reindex_required index: the table stores the flag after each run's
   * error text.
   */
  async fullReindexRequired(database: LibSQLDatabase): Promise<boolean> {
    const [row] = await database
      .select({ id: ingestionRun.id })
      .from(ingestionRun)
      .where(eq(ingestionRun.fullReindexRequired, true))
      .limit(1);
    return row !== undefined;
  },
} as const;
