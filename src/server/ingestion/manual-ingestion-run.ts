import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  isRetiredIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import type { PauseCause } from "~/server/source-control/source-control";

/**
 * Starting one source's ingestion now, outside the daily pass. It counts as
 * one of the day's attempts. Retired and paused sources are refused before
 * anything is written; busy means the source already has an active run,
 * which is left running.
 */
export type ManualIngestionRunStart =
  | {
      status: "started";
      source: IngestionSource;
      runId: string;
      workflowRunId: string;
    }
  | { status: "retired"; source: IngestionSource }
  | { status: "paused"; source: IngestionSource; cause: PauseCause }
  | { status: "busy"; source: IngestionSource };

export type ManualIngestionRunRefusal = Exclude<
  ManualIngestionRunStart,
  { status: "started" }
>;

export type ManualIngestionRunDependencies = {
  /** Why the source is paused, or null while it may run. */
  pauseCause: (source: IngestionSource) => Promise<PauseCause | null>;
  /** Claims the source's active slot and records the run. */
  startRun: (
    source: IngestionSource,
  ) => Promise<{ status: "started"; runId: string } | { status: "busy" }>;
  /** Starts the workflow that drives the run. */
  startWorkflow: (runId: string) => Promise<{ runId: string }>;
};

const PAUSED_BY: Record<PauseCause, string> = {
  admin: "paused here",
  flag: "paused by its Vercel flag",
  admin_and_flag: "paused here and by its Vercel flag",
};

export const ManualIngestionRun = {
  async start(
    deps: ManualIngestionRunDependencies,
    source: IngestionSource,
  ): Promise<ManualIngestionRunStart> {
    if (isRetiredIngestionSource(source)) return { status: "retired", source };
    const cause = await deps.pauseCause(source);
    if (cause !== null) return { status: "paused", source, cause };
    const run = await deps.startRun(source);
    if (run.status === "busy") return { status: "busy", source };
    const workflow = await deps.startWorkflow(run.runId);
    return {
      status: "started",
      source,
      runId: run.runId,
      workflowRunId: workflow.runId,
    };
  },

  /** Why no run started, in plain words for the owner and the API. */
  message(refusal: ManualIngestionRunRefusal): string {
    const name = INGESTION_SOURCE_DISPLAY_NAMES[refusal.source];
    switch (refusal.status) {
      case "retired":
        return `${name} is retired: its feed no longer reflects the yards' inventory, so it is not fetched and every ingestion run withdraws its published vehicles. No run was started.`;
      case "paused":
        return `${name} is ${PAUSED_BY[refusal.cause]}, so no run was started. Resume it first, then run it.`;
      case "busy":
        return `${name} already has a run in progress, so no second run was started. The current run keeps going; check its progress under Recent runs.`;
    }
  },
} as const;
