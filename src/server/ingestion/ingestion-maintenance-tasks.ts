import { SearchOutbox } from "./search-outbox";
import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { MaintenanceTaskResult } from "./ingestion-maintenance";
import { pruneIngestionRuns } from "./ingestion-run-retention";
import {
  IngestionSnapshotCleanup,
  SnapshotCleanupError,
} from "./ingestion-snapshot-cleanup";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";

/** Delivered and cancelled notification intents are kept this long. */
export const TERMINAL_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const TERMINAL_INTENT_BATCH_SIZE = 5_000;
// Bounds one daily run; anything left is picked up the next day.
const MAX_BATCHES_PER_RUN = 20;
const OUTBOX_BATCH_SIZE = 5_000;
// About 300K changes a day: the cutover's leftovers clear in one run.
const OUTBOX_MAX_BATCHES_PER_RUN = 60;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The daily ingestion-maintenance tasks; each returns its result as a value. */
export const IngestionMaintenanceTasks = {
  async pruneRuns(
    database: LibSQLDatabase,
    now: Date,
  ): Promise<MaintenanceTaskResult> {
    const pruning = await pruneIngestionRuns({ database, now });
    return pruning.status === "done"
      ? { task: "prune-runs", ...pruning }
      : {
          task: "prune-runs",
          status: "failed",
          deleted: pruning.deleted,
          message: `batch ${pruning.batch}: ${pruning.message}`,
        };
  },

  /**
   * Deletes Blob chunks registered on runs that are no longer active, within
   * a time budget. Deletions are recorded as they happen, so a failed or
   * stopped run keeps its progress and the next one resumes.
   */
  async staleSnapshots(
    database: LibSQLDatabase,
    snapshotStore: IngestionSnapshotStore,
    now: () => number = Date.now,
  ): Promise<MaintenanceTaskResult> {
    let deleted = 0;
    // Blob deletes are paced and wait out rate limits, so cleanup stops at
    // its budget, recording what it deleted; the next run resumes there.
    const budget = IngestionSnapshotCleanup.budget(now);
    try {
      for (let batch = 1; batch <= MAX_BATCHES_PER_RUN; batch += 1) {
        const cleanup = await IngestionSnapshotCleanup.staleBatch(
          database,
          snapshotStore,
          budget,
        );
        deleted += cleanup.chunksDeleted;
        if (cleanup.status === "complete") {
          return {
            task: "stale-snapshots",
            status: "done",
            deleted,
            complete: true,
          };
        }
        if (cleanup.status === "stopped" || now() >= budget.deadline) break;
      }
      return {
        task: "stale-snapshots",
        status: "done",
        deleted,
        complete: false,
      };
    } catch (error) {
      return {
        task: "stale-snapshots",
        status: "failed",
        deleted:
          deleted + (error instanceof SnapshotCleanupError ? error.deleted : 0),
        message: message(error),
      };
    }
  },

  /**
   * Deletes outbox changes the search projector no longer needs, in id
   * order. After the cutover rebuild that is every leftover change of the
   * skipped period, so this runs more batches than the other tasks.
   */
  async outboxRetention(
    database: LibSQLDatabase,
    now: Date,
  ): Promise<MaintenanceTaskResult> {
    let deleted = 0;
    try {
      for (let batch = 1; batch <= OUTBOX_MAX_BATCHES_PER_RUN; batch += 1) {
        const rows = await SearchOutbox.pruneBatch(database, {
          now,
          limit: OUTBOX_BATCH_SIZE,
        });
        deleted += rows;
        if (rows < OUTBOX_BATCH_SIZE) {
          return {
            task: "outbox-retention",
            status: "done",
            deleted,
            complete: true,
          };
        }
      }
      return {
        task: "outbox-retention",
        status: "done",
        deleted,
        complete: false,
      };
    } catch (error) {
      return {
        task: "outbox-retention",
        status: "failed",
        deleted,
        message: message(error),
      };
    }
  },

  /** Purges delivered or cancelled notification intents older than 30 days. */
  async terminalIntents(
    database: LibSQLDatabase,
    now: Date,
  ): Promise<MaintenanceTaskResult> {
    const cutoff = now.getTime() - TERMINAL_INTENT_RETENTION_MS;
    let deleted = 0;
    try {
      for (let batch = 1; batch <= MAX_BATCHES_PER_RUN; batch += 1) {
        const result = await database.run(sql`
          delete from search_notification_intent
          where id in (
            select id from search_notification_intent
            where status in ('delivered', 'cancelled')
              and created_at < ${cutoff}
            order by created_at, id
            limit ${TERMINAL_INTENT_BATCH_SIZE}
          )
        `);
        deleted += result.rowsAffected;
        if (result.rowsAffected < TERMINAL_INTENT_BATCH_SIZE) {
          return {
            task: "terminal-intents",
            status: "done",
            deleted,
            complete: true,
          };
        }
      }
      return {
        task: "terminal-intents",
        status: "done",
        deleted,
        complete: false,
      };
    } catch (error) {
      return {
        task: "terminal-intents",
        status: "failed",
        deleted,
        message: message(error),
      };
    }
  },
} as const;
