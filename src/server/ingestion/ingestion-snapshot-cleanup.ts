import { and, eq, isNull, ne } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { urgiisPublishedStatePath } from "./urgiis-history";

const STALE_SNAPSHOT_RUN_BATCH_SIZE = 50;

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

/** One batch of stale snapshot cleanup. Complete: no stale run is left. */
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
  /** Deletes these source runs' chunks and returns how many it deleted. */
  async deleteRunSnapshots(
    database: LibSQLDatabase,
    snapshotStore: IngestionSnapshotStore,
    rows: readonly { id: string; snapshotChunks: string }[],
  ): Promise<number> {
    let deleted = 0;
    const retainedCensus = rows.length
      ? await urgiisPublishedStatePath(database)
      : null;
    for (const row of rows) {
      const chunks = parseSnapshotChunks(row.snapshotChunks);
      const pathnames = chunks.filter((path) => path !== retainedCensus);
      await snapshotStore.delete(pathnames);
      await database
        .update(ingestionSourceRun)
        .set({
          snapshotChunks: JSON.stringify(
            chunks.filter((path) => path === retainedCensus),
          ),
        })
        .where(eq(ingestionSourceRun.id, row.id));
      deleted += pathnames.length;
    }
    return deleted;
  },

  /** Deletes one batch of chunks left by runs no longer active. */
  async staleBatch(
    database: LibSQLDatabase,
    snapshotStore: IngestionSnapshotStore,
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
      .limit(STALE_SNAPSHOT_RUN_BATCH_SIZE);
    const chunksDeleted = await IngestionSnapshotCleanup.deleteRunSnapshots(
      database,
      snapshotStore,
      rows,
    );
    return {
      runs: rows.length,
      chunksDeleted,
      complete: rows.length < STALE_SNAPSHOT_RUN_BATCH_SIZE,
    };
  },
} as const;
