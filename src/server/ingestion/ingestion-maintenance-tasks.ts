import { sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { MaintenanceTaskResult } from "./ingestion-maintenance";
import { pruneIngestionRuns } from "./ingestion-run-retention";
import { IngestionSnapshotCleanup } from "./ingestion-snapshot-cleanup";
import type { IngestionSnapshotStore } from "./ingestion-snapshot-store";

/** Delivered and cancelled notification intents are kept this long. */
export const TERMINAL_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const TERMINAL_INTENT_BATCH_SIZE = 5_000;
// Bounds one daily run; anything left is picked up the next day.
const MAX_BATCHES_PER_RUN = 20;

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

  /** Deletes Blob chunks registered on runs that are no longer active. */
  async staleSnapshots(
    database: LibSQLDatabase,
    snapshotStore: IngestionSnapshotStore,
  ): Promise<MaintenanceTaskResult> {
    let deleted = 0;
    try {
      for (let batch = 1; batch <= MAX_BATCHES_PER_RUN; batch += 1) {
        const cleanup = await IngestionSnapshotCleanup.staleBatch(
          database,
          snapshotStore,
        );
        deleted += cleanup.chunksDeleted;
        if (cleanup.complete) {
          return {
            task: "stale-snapshots",
            status: "done",
            deleted,
            complete: true,
          };
        }
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
