import { eq, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  INVENTORY_HIDDEN_AFTER_DAYS,
  INVENTORY_STALE_AFTER_HOURS,
  InventoryStaleness,
} from "~/lib/inventory-staleness";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { SourcePublication } from "./source-publication";

/**
 * Hours after a source's last accepted inventory publication before every
 * status check (/api/status, /api/status/[source]) calls it stale: the rule
 * public listings use too (INVENTORY_STALE_AFTER_HOURS).
 */
export const SOURCE_STALE_AFTER_HOURS = INVENTORY_STALE_AFTER_HOURS;

/**
 * Days of runs the freshness read covers. Longer than the hide window plus
 * the longest run (under a day in November 2026, three days for a cold URG
 * census), so a source missing from it has not published within
 * INVENTORY_HIDDEN_AFTER_DAYS.
 */
export const SOURCE_FRESHNESS_LOOKBACK_DAYS = INVENTORY_HIDDEN_AFTER_DAYS * 2;

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
  return InventoryStaleness.isCurrent(lastPublishedAt, now.getTime());
}

/**
 * Each source's latest attempt and accepted publication in the last
 * SOURCE_FRESHNESS_LOOKBACK_DAYS. Kept apart from the ingestion runtime so pages and status routes that read
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
        sql`${ingestionSourceRun.startedAt} > ${now.getTime() - SOURCE_FRESHNESS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000}`,
      )
      // `+source` stops SQLite walking the whole table in source-index order
      // to group; it reads the started_at range instead (9.7 s to 0.3 s on
      // production in November 2026; 50 ms for 14 days on November 24).
      .groupBy(sql`+${ingestionSourceRun.source}`)
  );
}
