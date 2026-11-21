import { eq, max, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionProjectorCheckpoint, ingestionRun } from "~/schema";
import type { ConsumerMode } from "./consumer-flags";
import type {
  InventoryDownstreamDue,
  InventoryRefreshBackoff,
  InventoryRefreshFailure,
} from "./inventory-downstream-consumer";

// Holds the highest publication sequence the inventory-downstream consumer
// finished (homepage snapshot, cache revalidation, warmup and IndexNow), in
// last_success_at when the tick that finished it checked, and its failed
// refreshes in failure_count, last_error_tag and blocked_until.
const CHECKPOINT_NAME = "inventory-downstream";

/**
 * Refreshing reads every live vehicle for the homepage snapshot, so a newer
 * publication waits until the last refresh is at least this old.
 */
export const INVENTORY_DOWNSTREAM_INTERVAL_MS = 3 * 60 * 60 * 1000;

// The hourly cron fires a little early or late each time, and the workflow
// re-checks after it starts. Without slack, a tick 3 hours later that fires a
// few seconds earlier would wait a fourth hour.
const INTERVAL_SLACK_MS = 10 * 60 * 1000;

// A failed refresh read every vehicle; retry after 3 hours, doubling up to a day.
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

function backoffMs(failureCount: number): number {
  return Math.min(
    MAX_BACKOFF_MS,
    INVENTORY_DOWNSTREAM_INTERVAL_MS * 2 ** Math.max(0, failureCount - 1),
  );
}

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
          select ${ingestionProjectorCheckpoint.lastSuccessAt}
          from ${ingestionProjectorCheckpoint}
          where ${eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME)}
        )`,
        failureCount: sql<number | null>`(
          select ${ingestionProjectorCheckpoint.failureCount}
          from ${ingestionProjectorCheckpoint}
          where ${eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME)}
        )`,
        lastErrorTag: sql<string | null>`(
          select ${ingestionProjectorCheckpoint.lastErrorTag}
          from ${ingestionProjectorCheckpoint}
          where ${eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME)}
        )`,
        blockedUntil: sql<number | null>`(
          select ${ingestionProjectorCheckpoint.blockedUntil}
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
    const blockedUntil = state?.blockedUntil ?? null;
    // The same slack as the success gate: a tick firing a moment before the
    // deadline retries now instead of an hour later.
    if (
      blockedUntil !== null &&
      now.getTime() < blockedUntil - INTERVAL_SLACK_MS
    ) {
      return {
        status: "backing_off",
        publicationSequence: latest,
        refreshedThrough,
        failureCount: state?.failureCount ?? 0,
        lastErrorTag: state?.lastErrorTag ?? null,
        retryAt: new Date(blockedUntil).toISOString(),
      };
    }
    const refreshedAt = state?.refreshedAt ?? null;
    if (
      refreshedAt !== null &&
      now.getTime() - refreshedAt <
        INVENTORY_DOWNSTREAM_INTERVAL_MS - INTERVAL_SLACK_MS
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

  /**
   * Records that the consumer finished this publication, stamped with the
   * tick's check time, and clears any failure backoff. Never moves backward.
   */
  async record(
    database: LibSQLDatabase,
    publicationSequence: number,
    checkedAt: Date,
  ): Promise<void> {
    const success = {
      lastProcessedChangeId: publicationSequence,
      lastSuccessAt: checkedAt,
      failureCount: 0,
      lastErrorTag: null,
      blockedUntil: null,
      updatedAt: checkedAt,
    };
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({ name: CHECKPOINT_NAME, ...success })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: success,
        setWhere: sql`${ingestionProjectorCheckpoint.lastProcessedChangeId} < ${publicationSequence}`,
      });
  },

  /**
   * Records a failed refresh without moving the checkpoint, and blocks the
   * consumer until a backoff passes: 3 hours, doubling to at most a day.
   */
  async recordFailure(
    database: LibSQLDatabase,
    failure: InventoryRefreshFailure,
    checkedAt: Date,
  ): Promise<InventoryRefreshBackoff> {
    const [row] = await database
      .select({ failureCount: ingestionProjectorCheckpoint.failureCount })
      .from(ingestionProjectorCheckpoint)
      .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME));
    const failureCount = (row?.failureCount ?? 0) + 1;
    const blockedUntil = new Date(
      checkedAt.getTime() + backoffMs(failureCount),
    );
    const failed = {
      failureCount,
      lastErrorTag: `refresh_${failure.stage}`,
      blockedUntil,
      updatedAt: checkedAt,
    };
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({ name: CHECKPOINT_NAME, lastProcessedChangeId: 0, ...failed })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: failed,
      });
    return { failureCount, retryAt: blockedUntil.toISOString() };
  },
} as const;
