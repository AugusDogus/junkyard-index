import { eq, max, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionProjectorCheckpoint, ingestionRun } from "~/schema";
import type { ConsumerMode } from "./consumer-flags";
import type { InventoryDownstreamDue } from "./inventory-downstream-consumer";

// Holds the highest publication sequence the inventory-downstream consumer
// finished (homepage snapshot, cache revalidation, warmup and IndexNow), and
// in updated_at when it finished it.
const CHECKPOINT_NAME = "inventory-downstream";

/**
 * Refreshing reads every live vehicle for the homepage snapshot, so a newer
 * publication waits until the last refresh is at least this old.
 */
export const INVENTORY_DOWNSTREAM_INTERVAL_MS = 3 * 60 * 60 * 1000;

/**
 * The inventory-downstream consumer's checkpoint. It reads only Turso
 * publications (`publication_sequence`), never search state, so a stalled
 * ingestion pass or a blocked Algolia cannot hold it back. Its parts keep
 * their own checkpoints too (inventory-snapshot, inventory-cache-refresh,
 * indexnow-announcement), so a workflow from an older deployment that still
 * runs the pass-end refresh and this consumer never redo each other's work.
 */
export const InventoryDownstream = {
  checkpointName: CHECKPOINT_NAME,

  /** Whether a refresh is due now; a paused consumer reads nothing. */
  async due(
    database: LibSQLDatabase,
    now: Date,
    mode: ConsumerMode,
  ): Promise<InventoryDownstreamDue> {
    if (mode === "paused") return { status: "paused" };
    const [state] = await database
      .select({
        latest: max(ingestionRun.publicationSequence),
        refreshedThrough: sql<number | null>`(
          select ${ingestionProjectorCheckpoint.lastProcessedChangeId}
          from ${ingestionProjectorCheckpoint}
          where ${eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME)}
        )`,
        refreshedAt: sql<number | null>`(
          select ${ingestionProjectorCheckpoint.updatedAt}
          from ${ingestionProjectorCheckpoint}
          where ${eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME)}
        )`,
      })
      .from(ingestionRun);
    const latest = state?.latest ?? null;
    const refreshedThrough = state?.refreshedThrough ?? 0;
    if (latest === null || latest <= refreshedThrough) {
      return { status: "current", refreshedThrough };
    }
    const refreshedAt = state?.refreshedAt ?? null;
    if (
      refreshedAt !== null &&
      now.getTime() - refreshedAt < INVENTORY_DOWNSTREAM_INTERVAL_MS
    ) {
      return {
        status: "recent",
        publicationSequence: latest,
        refreshedThrough,
        nextRefreshAt: new Date(
          refreshedAt + INVENTORY_DOWNSTREAM_INTERVAL_MS,
        ).toISOString(),
      };
    }
    return {
      status: "due",
      publicationSequence: latest,
      refreshedThrough,
      checkedAt: now.toISOString(),
    };
  },

  /** Records that the consumer finished this publication; never moves backward. */
  async record(
    database: LibSQLDatabase,
    publicationSequence: number,
    now: Date,
  ): Promise<void> {
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({
        name: CHECKPOINT_NAME,
        lastProcessedChangeId: publicationSequence,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: { lastProcessedChangeId: publicationSequence, updatedAt: now },
        setWhere: sql`${ingestionProjectorCheckpoint.lastProcessedChangeId} < ${publicationSequence}`,
      });
  },
} as const;
