import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionProjectorCheckpoint } from "~/schema";

const CHECKPOINT_NAME = "search-projector:rebuild-wait";
const MINUTE_MS = 60 * 1000;
const BASE_MS = 15 * MINUTE_MS;
const MAX_MS = 6 * 60 * MINUTE_MS;

/**
 * Why a requested rebuild cannot start yet: the copy would pass the plan's
 * record cap, or there is no live index to copy settings from.
 */
export type SearchRebuildWaitReason = "record_cap" | "missing_live_index";

/** A requested rebuild that waits, and when it is tried again. */
export interface SearchRebuildWait {
  reason: SearchRebuildWaitReason;
  attempts: number;
  retryAt: Date;
}

function isReason(value: string | null): value is SearchRebuildWaitReason {
  return value === "record_cap" || value === "missing_live_index";
}

/**
 * The wait before a requested rebuild is prepared again, kept apart from
 * the projector's circuit breaker: a rebuild that cannot start must not stop
 * the incremental projection into the live index.
 */
export const SearchRebuildWait = {
  checkpointName: CHECKPOINT_NAME,

  /** The current wait, or null when a requested rebuild may be prepared. */
  async read(
    database: LibSQLDatabase,
    now: Date,
  ): Promise<SearchRebuildWait | null> {
    const [row] = await database
      .select()
      .from(ingestionProjectorCheckpoint)
      .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME))
      .limit(1);
    if (!row || row.blockedUntil === null || !isReason(row.lastErrorTag)) {
      return null;
    }
    if (now >= row.blockedUntil) return null;
    return {
      reason: row.lastErrorTag,
      attempts: row.failureCount,
      retryAt: row.blockedUntil,
    };
  },

  /** Records a failed prepare: retry after 15 minutes, doubling to 6 hours. */
  async record(
    database: LibSQLDatabase,
    params: { reason: SearchRebuildWaitReason; now: Date },
  ): Promise<SearchRebuildWait> {
    const [row] = await database
      .select({ failureCount: ingestionProjectorCheckpoint.failureCount })
      .from(ingestionProjectorCheckpoint)
      .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME))
      .limit(1);
    const attempts = (row?.failureCount ?? 0) + 1;
    const retryAt = new Date(
      params.now.getTime() +
        Math.min(MAX_MS, BASE_MS * 2 ** Math.max(0, attempts - 1)),
    );
    const state = {
      kind: "wait",
      failureCount: attempts,
      lastErrorTag: params.reason,
      blockedUntil: retryAt,
      updatedAt: params.now,
    };
    await database
      .insert(ingestionProjectorCheckpoint)
      .values({ name: CHECKPOINT_NAME, lastProcessedChangeId: 0, ...state })
      .onConflictDoUpdate({
        target: ingestionProjectorCheckpoint.name,
        set: state,
      });
    return { reason: params.reason, attempts, retryAt };
  },

  /** Clears the wait once a rebuild was prepared. */
  async clear(database: LibSQLDatabase, now: Date): Promise<void> {
    await database
      .update(ingestionProjectorCheckpoint)
      .set({
        failureCount: 0,
        lastErrorTag: null,
        blockedUntil: null,
        lastSuccessAt: now,
        updatedAt: now,
      })
      .where(eq(ingestionProjectorCheckpoint.name, CHECKPOINT_NAME));
  },
} as const;
