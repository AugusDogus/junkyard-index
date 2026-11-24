import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import {
  SnapshotDeleteDeadlineError,
  type IngestionSnapshotStore,
} from "./ingestion-snapshot-store";
import { urgiisPublishedStatePath } from "./urgiis-history";

const STALE_SNAPSHOT_RUN_BATCH_SIZE = 50;
// Each slice's deletion is recorded before the next starts, so a failure or
// a stop keeps what was deleted and the next cleanup resumes after it.
const DELETE_SLICE_SIZE = 250;
/**
 * How long one cleanup step spends deleting blobs. Workflow runs steps
 * inline and starts one up to 5 min into an 800 s invocation, after earlier
 * steps (outbox retention and run pruning come before stale snapshots), so
 * cleanup gets 3 min and no Blob wait or request runs past them. What is
 * left resumes in the next step or tick.
 */
export const SNAPSHOT_CLEANUP_BUDGET_MS = 3 * 60 * 1_000;

/** When cleanup stops, by its clock. */
export type SnapshotCleanupBudget = { deadline: number; now: () => number };

/** What a cleanup deleted, and whether it stopped at its budget first. */
export type RunSnapshotDeletion = {
  deleted: number;
  status: "complete" | "stopped";
};

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

/**
 * One batch of stale snapshot cleanup. complete: no stale run is left; more:
 * the batch was full, so more may be; stopped: it reached its budget.
 */
export type StaleSnapshotCleanup = {
  runs: number;
  chunksDeleted: number;
  status: "complete" | "more" | "stopped";
};

/**
 * Staged snapshot chunks live in Blob storage, registered on their source run.
 * A run that left the active slot no longer needs them, except URG's latest
 * published census, which seeds its next run.
 */
export const IngestionSnapshotCleanup = {
  /** A cleanup budget of {@link SNAPSHOT_CLEANUP_BUDGET_MS} from now. */
  budget(now: () => number = Date.now): SnapshotCleanupBudget {
    return { deadline: now() + SNAPSHOT_CLEANUP_BUDGET_MS, now };
  },

  /**
   * Deletes these source runs' chunks, recording each slice as it goes.
   * Stops between slices, or inside a delete, at the budget's deadline and
   * reports it; a failure throws {@link SnapshotCleanupError} with the count.
   */
  async deleteRunSnapshots(
    database: LibSQLDatabase,
    snapshotStore: IngestionSnapshotStore,
    rows: readonly { id: string; snapshotChunks: string }[],
    budget: SnapshotCleanupBudget,
  ): Promise<RunSnapshotDeletion> {
    let deleted = 0;
    const retainedCensus = rows.length
      ? await urgiisPublishedStatePath(database)
      : null;
    const policy = { kind: "paced", deadline: budget.deadline } as const;
    try {
      for (const row of rows) {
        const chunks = parseSnapshotChunks(row.snapshotChunks);
        const kept = chunks.filter((path) => path === retainedCensus);
        let remaining = chunks.filter((path) => path !== retainedCensus);
        while (remaining.length > 0) {
          if (budget.now() >= budget.deadline)
            return { deleted, status: "stopped" };
          const slice = remaining.slice(0, DELETE_SLICE_SIZE);
          await snapshotStore.delete(slice, policy);
          remaining = remaining.slice(slice.length);
          await database
            .update(ingestionSourceRun)
            .set({ snapshotChunks: JSON.stringify([...kept, ...remaining]) })
            .where(eq(ingestionSourceRun.id, row.id));
          deleted += slice.length;
        }
      }
    } catch (error) {
      // The slice in flight stays registered, so the next cleanup retries it.
      if (error instanceof SnapshotDeleteDeadlineError)
        return { deleted, status: "stopped" };
      throw new SnapshotCleanupError(deleted, error);
    }
    return { deleted, status: "complete" };
  },

  /** Deletes one batch of chunks left by runs no longer active. */
  async staleBatch(
    database: LibSQLDatabase,
    snapshotStore: IngestionSnapshotStore,
    budget: SnapshotCleanupBudget,
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
    const deletion = await IngestionSnapshotCleanup.deleteRunSnapshots(
      database,
      snapshotStore,
      rows,
      budget,
    );
    return {
      runs: rows.length,
      chunksDeleted: deletion.deleted,
      status:
        deletion.status === "stopped"
          ? "stopped"
          : rows.length < STALE_SNAPSHOT_RUN_BATCH_SIZE
            ? "complete"
            : "more",
    };
  },
} as const;
