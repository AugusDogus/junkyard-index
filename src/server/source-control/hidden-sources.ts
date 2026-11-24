import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { HiddenSources } from "~/lib/hidden-source";
import { InventoryStaleness } from "~/lib/inventory-staleness";
import { loadSourceFreshness } from "~/server/ingestion/durable-health";
import { SourceControlRepository } from "./source-control-repository";

/**
 * The sources hidden from the public site at `now`: those the owner hid from
 * /admin, and those with no accepted publication within
 * INVENTORY_HIDDEN_AFTER_DAYS. The automatic hide is never stored, so a
 * source's next accepted publication shows it again without anyone acting.
 * Read without a cache; pages and routes use `getHiddenSources`.
 */
export async function loadHiddenSources(
  database: LibSQLDatabase,
  now: Date,
): Promise<HiddenSources> {
  const [owner, freshness] = await Promise.all([
    SourceControlRepository.hiddenSources(database),
    loadSourceFreshness(database, now),
  ]);
  const stale = InventoryStaleness.hiddenSources(
    new Map(freshness.map((row) => [row.source, row.lastPublishedAt])),
    now.getTime(),
  );
  return HiddenSources.of([...owner.list, ...stale]);
}
