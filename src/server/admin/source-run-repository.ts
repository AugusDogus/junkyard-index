import { desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { IngestionSource } from "~/lib/ingestion-source";
import { ingestionRun, ingestionSourceRun, yardInventory } from "~/schema";
import type { ActiveRun } from "./source-overview";
import type { SourceRun, SourceRunErrors } from "./source-run";

/** Characters of error text a list loads per run, enough for a summary. */
export const ERROR_EXCERPT_CHARS = 4_000;
/** Characters of error text a run's page shows; a few runs store megabytes. */
export const ERROR_TEXT_LIMIT_CHARS = 100_000;

// Leaves out cursors and snapshot chunk lists, which reach megabytes.
const runColumns = {
  id: ingestionSourceRun.id,
  runId: ingestionSourceRun.runId,
  source: ingestionSourceRun.source,
  status: ingestionSourceRun.status,
  acceptanceStatus: ingestionSourceRun.acceptanceStatus,
  runStatus: ingestionRun.status,
  stage: ingestionRun.stage,
  startedAt: ingestionSourceRun.startedAt,
  completedAt: ingestionSourceRun.completedAt,
  inventoryPublishedAt: ingestionRun.inventoryPublishedAt,
  pagesProcessed: ingestionSourceRun.pagesProcessed,
  vehiclesProcessed: ingestionSourceRun.vehiclesProcessed,
  uniqueVehicles: ingestionSourceRun.uniqueVehicles,
  duplicateVehicles: ingestionSourceRun.duplicateVehicles,
  rejectedVehicles: ingestionSourceRun.rejectedVehicles,
};

function errorColumns(chars: number) {
  return {
    errors: sql<
      string | null
    >`substr(${ingestionSourceRun.errors}, 1, ${chars})`,
    validationErrors: sql<
      string | null
    >`substr(${ingestionSourceRun.validationErrors}, 1, ${chars})`,
  };
}

/**
 * Bounded reads of ingestion runs for the admin dashboard. Every read is
 * limited by a time window, an id list or a row limit, and none touches the
 * vehicle table.
 */
export const SourceRunRepository = {
  /** Every source run started after `since`, through the started_at index. */
  recent(database: LibSQLDatabase, since: Date): Promise<SourceRun[]> {
    return database
      .select(runColumns)
      .from(ingestionSourceRun)
      .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
      .where(gt(ingestionSourceRun.startedAt, since));
  },

  /** The first `ERROR_EXCERPT_CHARS` of each listed run's error text. */
  async errorExcerpts(
    database: LibSQLDatabase,
    sourceRunIds: readonly string[],
  ): Promise<Map<string, SourceRunErrors>> {
    if (sourceRunIds.length === 0) return new Map();
    const rows = await database
      .select({
        id: ingestionSourceRun.id,
        ...errorColumns(ERROR_EXCERPT_CHARS),
      })
      .from(ingestionSourceRun)
      .where(inArray(ingestionSourceRun.id, [...sourceRunIds]));
    return new Map(rows.map(({ id, ...errors }) => [id, errors]));
  },

  /**
   * The source's newest runs with their error text, each field cut at
   * `ERROR_TEXT_LIMIT_CHARS` (`errorsCutOff` says whether either was).
   */
  forSource(
    database: LibSQLDatabase,
    source: IngestionSource,
    limit: number,
  ): Promise<(SourceRun & SourceRunErrors & { errorsCutOff: boolean })[]> {
    return database
      .select({
        ...runColumns,
        ...errorColumns(ERROR_TEXT_LIMIT_CHARS),
        errorsCutOff: sql<boolean>`(
          coalesce(length(${ingestionSourceRun.errors}), 0) > ${ERROR_TEXT_LIMIT_CHARS}
          or coalesce(length(${ingestionSourceRun.validationErrors}), 0) > ${ERROR_TEXT_LIMIT_CHARS}
        )`.mapWith(Boolean),
      })
      .from(ingestionSourceRun)
      .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
      .where(eq(ingestionSourceRun.source, source))
      .orderBy(desc(ingestionSourceRun.startedAt))
      .limit(limit);
  },

  /** Runs holding a source's active slot: at most one per source. */
  activeRuns(database: LibSQLDatabase): Promise<ActiveRun[]> {
    return database
      .select({
        runId: ingestionRun.id,
        source: ingestionRun.source,
        stage: ingestionRun.stage,
        startedAt: ingestionRun.startedAt,
        lastProgressAt: ingestionRun.lastProgressAt,
      })
      .from(ingestionRun)
      .where(eq(ingestionRun.activeSlot, 1));
  },

  /** Vehicles on the site per source, summed from yard_inventory. */
  async publishedCounts(
    database: LibSQLDatabase,
  ): Promise<Map<string, number>> {
    const rows = await database
      .select({
        source: yardInventory.source,
        vehicles: sql<number>`sum(${yardInventory.vehicleCount})`.mapWith(
          Number,
        ),
      })
      .from(yardInventory)
      .groupBy(yardInventory.source);
    return new Map(rows.map((row) => [row.source, row.vehicles]));
  },
} as const;
