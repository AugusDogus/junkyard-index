import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  ingestionSourceCadenceDays,
  MAX_INGESTION_CADENCE_DAYS,
  type IngestionSource,
} from "~/lib/ingestion-source";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { SourcePublication } from "./source-publication";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Hours after a source's last accepted inventory publication before every
 * status check (/api/status, /api/status/[source], /admin) calls it stale: its
 * cadence plus 12 hours. Scheduled runs start at 07:00 UTC and publish within
 * hours; the 12 hours allow a late publication followed by an early one
 * without flagging a healthy source, and still catch a source that misses a
 * scheduled crawl. A daily source goes stale after 36 hours.
 */
export function sourceStaleAfterHours(source: IngestionSource): number {
  return ingestionSourceCadenceDays(source) * 24 + STALE_MARGIN_HOURS;
}

const STALE_MARGIN_HOURS = 12;

/** `sourceStaleAfterHours` of a daily source. */
export const DAILY_SOURCE_STALE_AFTER_HOURS = 24 + STALE_MARGIN_HOURS;

/**
 * How far back a source's accepted publication still dates its yards'
 * inventory on the site: its cadence plus 2 days, so one missed scheduled
 * crawl (all of its attempts that day failing) does not drop its yards.
 */
export function sourcePublicationLookbackMs(source: IngestionSource): number {
  return (ingestionSourceCadenceDays(source) + 2) * DAY_MS;
}

/** `sourcePublicationLookbackMs` of a daily source: 3 days. */
export const DAILY_PUBLICATION_LOOKBACK_MS = 3 * DAY_MS;

/** The freshness query's window: the longest source look-back. */
const FRESHNESS_LOOKBACK_MS = (MAX_INGESTION_CADENCE_DAYS + 2) * DAY_MS;

export interface IngestionSourceFreshness {
  source: string;
  lastAttemptAt: number;
  lastPublishedAt: number | null;
}

/**
 * Whether a source's last accepted publication is recent enough to call its
 * inventory fresh. A source with one failed attempt is still fresh; one that
 * misses a scheduled crawl goes stale after `sourceStaleAfterHours`.
 */
export function isFreshPublication(
  source: IngestionSource,
  lastPublishedAt: number | null,
  now: Date,
): boolean {
  return (
    lastPublishedAt !== null &&
    now.getTime() - lastPublishedAt <= sourceStaleAfterHours(source) * HOUR_MS
  );
}

/**
 * Each source's latest attempt and accepted publication within the longest
 * source look-back (`sourcePublicationLookbackMs`). Kept apart from the
 * ingestion runtime so pages and status routes that read it load no
 * connector or search client.
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
        sql`${ingestionSourceRun.startedAt} > ${now.getTime() - FRESHNESS_LOOKBACK_MS}`,
      )
      // `+source` stops SQLite walking the whole table in source-index order
      // to group; it reads the started_at range instead (9.7 s to 0.3 s on
      // production in November 2026).
      .groupBy(sql`+${ingestionSourceRun.source}`)
  );
}
