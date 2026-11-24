import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { SourcePublication } from "./source-publication";

/**
 * Hours after a source's last accepted inventory publication before every
 * status check (/api/status, /api/status/[source]) calls it stale. Daily runs
 * start at 07:00 UTC and publish within hours; 36 hours allows a late
 * publication followed by an early one without flagging a healthy source, and
 * still catches a source that misses a whole day.
 */
export const SOURCE_STALE_AFTER_HOURS = 36;
const STALE_AFTER_MS = SOURCE_STALE_AFTER_HOURS * 60 * 60 * 1000;

export interface IngestionSourceFreshness {
  source: string;
  lastAttemptAt: number;
  lastPublishedAt: number | null;
}

/**
 * Whether a source's last accepted publication is recent enough to call its
 * inventory fresh. A daily source with one failed attempt is still fresh; a
 * source that misses its whole day goes stale after
 * `SOURCE_STALE_AFTER_HOURS`.
 */
export function isFreshPublication(
  lastPublishedAt: number | null,
  now: Date,
): boolean {
  return (
    lastPublishedAt !== null &&
    now.getTime() - lastPublishedAt <= STALE_AFTER_MS
  );
}

/**
 * Each source's latest attempt and accepted publication in the last 3 days.
 * Kept apart from the ingestion runtime so pages and status routes that read
 * it load no connector or search client.
 */
export async function loadSourceFreshness(
  database: LibSQLDatabase,
  now: Date,
): Promise<IngestionSourceFreshness[]> {
  return (
    database
      .select({
        source: ingestionSourceRun.source,
        lastAttemptAt: sql<number>`max(${ingestionSourceRun.startedAt})`,
        lastPublishedAt: sql<number | null>`max(case
        when ${SourcePublication.acceptedSql}
        then ${SourcePublication.publishedAt}
      end)`,
      })
      .from(ingestionSourceRun)
      .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
      .where(
        sql`${ingestionSourceRun.startedAt} > ${now.getTime() - 3 * 24 * 60 * 60 * 1000}`,
      )
      // `+source` stops SQLite walking the whole table in source-index order
      // to group; it reads the started_at range instead (9.7 s to 0.3 s on
      // production in November 2026).
      .groupBy(sql`+${ingestionSourceRun.source}`)
  );
}
