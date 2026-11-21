// Orchestration only: the workflow passes its steps in, so this module stays
// free of database and network imports and can run in the workflow bundle.
import type { ConsumerMode } from "./consumer-flags";
import type { ConsumerTickSummary } from "./consumer-report";

export type MaintenanceTask =
  | "outbox-retention"
  | "prune-runs"
  | "stale-snapshots"
  | "terminal-intents";

/**
 * One maintenance task's result. Complete: nothing eligible is left. A failed
 * task keeps what it deleted before failing; tomorrow's run retries the rest.
 */
export type MaintenanceTaskResult =
  | {
      task: MaintenanceTask;
      status: "done";
      deleted: number;
      complete: boolean;
    }
  | {
      task: MaintenanceTask;
      status: "failed";
      deleted: number;
      message: string;
    };

export type IngestionMaintenanceResult =
  | { status: "paused" }
  | { status: "completed"; failed: boolean; tasks: MaintenanceTaskResult[] };

/**
 * The daily ingestion-maintenance tick: deletes outbox changes the search
 * projector no longer needs (first, so runs left without changes can be
 * pruned the same day), prunes old ingestion runs, deletes Blob snapshot
 * chunks of runs no longer active, and purges delivered or cancelled
 * notification intents older than 30 days. Each task runs even if
 * another fails, and each result is a value. None depends on an ingestion
 * pass completing or on search.
 */
export async function runIngestionMaintenance(operations: {
  mode(): Promise<ConsumerMode>;
  outboxRetention(): Promise<MaintenanceTaskResult>;
  pruneRuns(): Promise<MaintenanceTaskResult>;
  staleSnapshots(): Promise<MaintenanceTaskResult>;
  terminalIntents(): Promise<MaintenanceTaskResult>;
}): Promise<IngestionMaintenanceResult> {
  // Invoke step callbacks without serializing the operations object as `this`.
  const { mode, outboxRetention, pruneRuns, staleSnapshots, terminalIntents } =
    operations;
  if ((await mode()) === "paused") return { status: "paused" };
  const tasks: MaintenanceTaskResult[] = [];
  for (const [task, run] of [
    ["outbox-retention", outboxRetention],
    ["prune-runs", pruneRuns],
    ["stale-snapshots", staleSnapshots],
    ["terminal-intents", terminalIntents],
  ] as const) {
    try {
      tasks.push(await run());
    } catch (error) {
      tasks.push({
        task,
        status: "failed",
        deleted: 0,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    status: "completed",
    failed: tasks.some((task) => task.status === "failed"),
    tasks,
  };
}

/** Flattens a maintenance result into Sentry attributes. */
export function summarizeIngestionMaintenance(
  result: IngestionMaintenanceResult,
): ConsumerTickSummary {
  if (result.status === "paused") return { status: "paused" };
  const summary: Record<string, string | number | boolean | null> = {
    status: result.status,
    failed: result.failed,
  };
  for (const task of result.tasks) {
    summary[`${task.task}.status`] = task.status;
    summary[`${task.task}.deleted`] = task.deleted;
    if (task.status === "done")
      summary[`${task.task}.complete`] = task.complete;
    else summary[`${task.task}.message`] = task.message;
  }
  return summary;
}
