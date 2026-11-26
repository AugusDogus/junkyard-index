import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import {
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  InventoryStaleness,
  type StalenessClasses,
} from "~/lib/inventory-staleness";
import { ingestionProjectorCheckpoint } from "~/schema";
import { loadSourceFreshness } from "./durable-health";

// Holds the classification (StalenessClasses, as JSON) the inventory caches
// were last expired for.
const CHECKPOINT_NAME = "inventory-staleness";

/**
 * One hourly check. Unchanged: every source is in the class the caches were
 * last expired for. Recovered: only `sources` changed, each back to current;
 * the new class is stored without expiring the caches, since each of them
 * published, and the inventory refresh for that publication expires them.
 * Expired: the caches were expired because `changed` sources moved class, or
 * because no readable classification was stored ("unknown").
 */
export type StalenessBoundaryCheck =
  | { status: "unchanged" }
  | { status: "recovered"; sources: IngestionSource[] }
  | { status: "expired"; changed: IngestionSource[] | "unknown" };

/** The stored classification, or null when none is stored or it is unreadable. */
function parse(cursor: string | null): StalenessClasses | null {
  if (cursor === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(cursor);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const classes: StalenessClasses = {};
  for (const [source, kind] of Object.entries(value)) {
    if (!isIngestionSource(source) || (kind !== "stale" && kind !== "hidden"))
      return null;
    classes[source] = kind;
  }
  return classes;
}

export const StalenessBoundary = {
  checkpointName: CHECKPOINT_NAME,

  /**
   * Expires the inventory caches (`revalidate`) when a source passed 36
   * hours (its listings gain "Last checked") or 7 days (it hides), or when
   * an ingestion outage began or ended (held sources show or hide), since
   * the classification stored last time. A source going stale publishes
   * nothing, so no publication expires them then. A source coming back to
   * current did publish, and the inventory refresh for that publication
   * (at most 3 hours later) expires the caches with its new inventory, so a
   * check whose changes are all recoveries only stores them: every page
   * would otherwise regenerate up to twice for one publication. Compares
   * with the stored
   * classification, not a time window, so a late or missed tick still
   * catches every change. `revalidate` gets the sources that moved class,
   * or "unknown" when nothing was stored. When it throws, nothing is stored
   * and the error propagates, so the next tick tries again.
   */
  async check(params: {
    database: LibSQLDatabase;
    now: Date;
    revalidate: (changed: IngestionSource[] | "unknown") => void;
  }): Promise<StalenessBoundaryCheck> {
    const [freshness, [stored]] = await Promise.all([
      loadSourceFreshness(params.database, params.now),
      params.database
        .select({ cursor: ingestionProjectorCheckpoint.jobCursor })
        .from(ingestionProjectorCheckpoint)
        .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME))
        .limit(1),
    ]);
    const classes = InventoryStaleness.classes(
      new Map(freshness.map((row) => [row.source, row.lastPublishedAt])),
      params.now.getTime(),
    );
    const previous = parse(stored?.cursor ?? null);
    const changed =
      previous === null
        ? "unknown"
        : InventoryStaleness.changedClasses(previous, classes);
    if (changed !== "unknown" && changed.length === 0)
      return { status: "unchanged" };
    const recovered =
      changed !== "unknown" &&
      changed.every((source) => classes[source] === undefined);
    if (!recovered) params.revalidate(changed);
    const state = {
      kind: "staleness",
      jobCursor: JSON.stringify(classes),
      lastSuccessAt: params.now,
      updatedAt: params.now,
    };
    await params.database
      .insert(ingestionProjectorCheckpoint)
      .values({ name: CHECKPOINT_NAME, ...state })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: state,
      });
    return recovered
      ? { status: "recovered", sources: changed }
      : { status: "expired", changed };
  },
} as const;
