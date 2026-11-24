import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { IngestionSource } from "~/lib/ingestion-source";
import { InventoryStaleness } from "~/lib/inventory-staleness";
import { loadSourceFreshness } from "./durable-health";

/**
 * How far back each hourly check looks for a crossed threshold: an hour,
 * plus slack for a late cron tick. A crossing seen by two ticks expires the
 * caches twice, which only costs one extra rebuild.
 */
export const STALENESS_CHECK_WINDOW_MS = 70 * 60 * 1000;

/**
 * The active sources that passed 36 hours or 7 days without an accepted
 * publication in the last STALENESS_CHECK_WINDOW_MS. Publications expire
 * the inventory caches themselves; a source going stale publishes nothing,
 * so the hourly inventory-downstream cron expires them when this is not
 * empty, and labels and hides apply within the hour.
 */
export async function sourcesPastStalenessBoundary(
  database: LibSQLDatabase,
  now: Date,
): Promise<IngestionSource[]> {
  const freshness = await loadSourceFreshness(database, now);
  return InventoryStaleness.changedBetween(
    new Map(freshness.map((row) => [row.source, row.lastPublishedAt])),
    now.getTime() - STALENESS_CHECK_WINDOW_MS,
    now.getTime(),
  );
}
