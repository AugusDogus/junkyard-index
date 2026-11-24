import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { urgiisPublishedStatePath } from "./urgiis-history";

const STALE_SNAPSHOT_RUN_BATCH_SIZE = 50;
// Each slice's deletion is recorded before the next starts, so a failure or
// a stop keeps what was deleted and the next cleanup resumes after it.
const DELETE_SLICE_SIZE = 250;

/** A cleanup that failed after deleting some chunks, which stay recorded. */
export class SnapshotCleanupError extends Error {
  readonly _tag = "SnapshotCleanupError";

  constructor(
    readonly deleted: number,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "SnapshotCleanupError";
  }
}

export function parseSnapshotChunks(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((pathname) => typeof pathname === "string")
  ) {
    throw new Error(
      `ingestion_source_run.snapshot_chunks must be a JSON array of Blob pathnames; got ${json.slice(0, 200)}.`,
    );
  }
  return parsed;
}

/** One batch of stale snapshot cleanup. Complete: no stale run is left; a
 * batch that stopped early is never complete. */
export type StaleSnapshotCleanup = {
  runs: number;
  chunksDeleted: number;
  complete: boolean;
};

/**
 * Staged snapshot chunks live in Blob storage, registered on their source run.
 * A run that left the active slot no longer needs them, except URG's latest
 * published census, which seeds its next run.
 */
export const IngestionSnapshotCleanup = {
  /**
   * Deletes these source runs' chunks and returns how many it deleted,
   * recording each slice as it goes. Stops between slices once `shouldStop`
   * says so; a failure throws {@link SnapshotCleanupError} with the count.
   */
  async deleteRunSnapshots(
    database: LibSQLDatabase,
    snapshotStore: IngestionSnapshotStore,
    rows: readonly { id: string; snapshotChunks: string }[],
    shouldStop: () => boolean = () => false,
  ): Promise<number> {
    let deleted = 0;
    const retainedCensus = rows.length
      ? await urgiisPublishedStatePath(database)
      : null;
    try {
      for (const row of rows) {
        const kept = parseSnapshotChunks(row.snapshotChunks).filter(
          (path) => path === retainedCensus,
        );
        let remaining = parseSnapshotChunks(row.snapshotChunks).filter(
          (path) => path !== retainedCensus,
        );
        while (remaining.length > 0) {
          if (shouldStop()) return deleted;
          const slice = remaining.slice(0, DELETE_SLICE_SIZE);
          await snapshotStore.delete(slice);
          remaining = remaining.slice(slice.length);
          await database
            .update(ingestionSourceRun)
            .set({ snapshotChunks: JSON.stringify([...kept, ...remaining]) })
            .where(eq(ingestionSourceRun.id, row.id));
          deleted += slice.length;
        }
      }
    } catch (error) {
      throw new SnapshotCleanupError(deleted, error);
    }
    return deleted;
  },

  /** Deletes one batch of chunks left by runs no longer active. */
  async staleBatch(
    database: LibSQLDatabase,
    snapshotStore: IngestionSnapshotStore,
    shouldStop: () => boolean = () => false,
  ): Promise<StaleSnapshotCleanup> {
    const retainedCensus = await urgiisPublishedStatePath(database);
    const rows = await database
      .select({
        id: ingestionSourceRun.id,
        snapshotChunks: ingestionSourceRun.snapshotChunks,
      })
      .from(ingestionSourceRun)
      .innerJoin(ingestionRun, eq(ingestionRun.id, ingestionSourceRun.runId))
      .where(
        and(
          isNull(ingestionRun.activeSlot),
          ne(ingestionSourceRun.snapshotChunks, "[]"),
          // A row holding only the retained census has nothing to delete;
          // selecting it again would starve the rest of the batch.
          retainedCensus === null
            ? undefined
            : ne(
                ingestionSourceRun.snapshotChunks,
                JSON.stringify([retainedCensus]),
              ),
        ),
      )
      .orderBy(asc(ingestionSourceRun.id))
      .limit(STALE_SNAPSHOT_RUN_BATCH_SIZE);
    const chunksDeleted = await IngestionSnapshotCleanup.deleteRunSnapshots(
      database,
      snapshotStore,
      rows,
      shouldStop,
    );
    return {
      runs: rows.length,
      chunksDeleted,
      complete: rows.length < STALE_SNAPSHOT_RUN_BATCH_SIZE && !shouldStop(),
    };
  },
} as const;
