import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";

/**
 * A source's newest accepted publication: an accepted, successful source run
 * whose ingestion run committed inventory to Turso (`inventory_published_at`).
 *
 * This is the one meaning of "published" for the schedule (done for the day),
 * retries, validation baselines, connector seeds, freshness and status.
 * Search publication (`search_published_at`) can lag it or be skipped, so it
 * never decides whether a source published.
 */
export interface SourcePublication {
  runId: string;
  sourceRunId: string;
  publishedAt: Date;
  uniqueVehicles: number;
}

const acceptedPublication = (source: string, excludeRunId?: string) =>
  and(
    eq(ingestionSourceRun.source, source),
    eq(ingestionSourceRun.status, "success"),
    eq(ingestionSourceRun.acceptanceStatus, "accepted"),
    isNotNull(ingestionRun.inventoryPublishedAt),
    excludeRunId === undefined
      ? undefined
      : ne(ingestionSourceRun.runId, excludeRunId),
  );

export const SourcePublication = {
  /**
   * SQL that is true when the joined `ingestion_source_run` and
   * `ingestion_run` rows are an accepted publication. Use it in aggregates
   * that cannot call `latestAccepted`.
   */
  acceptedSql: sql`(${ingestionSourceRun.acceptanceStatus} = 'accepted' and ${ingestionRun.inventoryPublishedAt} is not null)`,

  /** The column that dates a publication. */
  publishedAt: ingestionRun.inventoryPublishedAt,

  /**
   * The source's newest accepted publication, or null when it has none.
   * `excludeRunId` leaves out a run, such as the one being validated.
   */
  async latestAccepted(
    database: LibSQLDatabase,
    source: string,
    options: { excludeRunId?: string } = {},
  ): Promise<SourcePublication | null> {
    const [latest] = await database
      .select({
        runId: ingestionRun.id,
        sourceRunId: ingestionSourceRun.id,
        publishedAt: ingestionRun.inventoryPublishedAt,
        uniqueVehicles: ingestionSourceRun.uniqueVehicles,
      })
      .from(ingestionSourceRun)
      .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
      .where(acceptedPublication(source, options.excludeRunId))
      .orderBy(desc(ingestionRun.inventoryPublishedAt))
      .limit(1);
    if (!latest?.publishedAt) return null;
    return { ...latest, publishedAt: latest.publishedAt };
  },

  /**
   * The newest accepted publication's terminal cursor, raw as stored (null
   * when that run saved none), or null when the source has no accepted
   * publication. Failed, rejected and unpublished runs never seed a census.
   * Kept apart from `latestAccepted` because some cursors are megabytes.
   */
  async latestAcceptedCursor(
    database: LibSQLDatabase,
    source: string,
  ): Promise<{ runId: string; cursor: string | null } | null> {
    const [latest] = await database
      .select({ runId: ingestionRun.id, cursor: ingestionSourceRun.nextCursor })
      .from(ingestionSourceRun)
      .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
      .where(acceptedPublication(source))
      .orderBy(desc(ingestionRun.inventoryPublishedAt))
      .limit(1);
    return latest ?? null;
  },
} as const;
