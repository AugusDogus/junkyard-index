import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  isRetiredIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import type { PauseCause } from "~/server/source-control/source-control";
import type { PassHandoff } from "./pass-handoff";

/**
 * Starting one source's ingestion now, outside the daily pass. It counts as
 * one of the day's attempts. Retired and paused sources are refused before
 * anything is written; busy means the source already has an active run,
 * which is left running.
 */
export type ManualIngestionRunStart =
  | ({
      status: "started";
      source: IngestionSource;
      runId: string;
    } & ManualWorkflowStart)
  | { status: "retired"; source: IngestionSource }
  | { status: "paused"; source: IngestionSource; cause: PauseCause }
  | { status: "busy"; source: IngestionSource };

/**
 * How a manual run's workflow starts. `workflow`: its own workflow
 * (`workflowRunId`) starts now. `pass`: the source shares a rate-limited host
 * with other sources (`HostClaims`), so the day's pass (`workflowRunId`)
 * admits it and starts its workflow once those hosts are free.
 * `restarted_pass`: as `pass`, after the listening pass, which ran older
 * code, was replaced by one on current code (`PassHandoff`).
 */
export type ManualWorkflowStart = {
  via: "workflow" | PassHandoff["via"];
  workflowRunId: string;
};

/**
 * Who asked for the run. The admin "Run now" control refuses every paused
 * source. The cron-secret API refuses only a source the owner paused: it
 * still runs a source only its Vercel flag pauses, so an operator can test a
 * fix before turning the flag back on.
 */
export type ManualIngestionRunCaller = "admin" | "cron_api";

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
  /** Starts the workflow that drives the run, or hands the run to the day's
   * pass (see `ManualWorkflowStart`); `runId` is that workflow's run. */
  startWorkflow: (
    runId: string,
    source: IngestionSource,
  ) => Promise<{ via: ManualWorkflowStart["via"]; runId: string }>;
};

function pausedBy(cause: PauseCause, source: IngestionSource): string {
  const flag = `the Vercel flag ingestion-source-${source}`;
  switch (cause) {
    case "admin":
      return "paused here, so no run was started. Resume it first, then run it.";
    case "flag":
      return `paused by ${flag}, so no run was started. Turn the flag on to run it from here, or start a test run with the cron-secret API.`;
    case "admin_and_flag":
      return `paused here and by ${flag}, so no run was started. Resume it and turn the flag on, then run it.`;
  }
}

function refuses(caller: ManualIngestionRunCaller, cause: PauseCause): boolean {
  return caller === "admin" || cause !== "flag";
}

export const ManualIngestionRun = {
  async start(
    deps: ManualIngestionRunDependencies,
    source: IngestionSource,
    caller: ManualIngestionRunCaller,
  ): Promise<ManualIngestionRunStart> {
    if (isRetiredIngestionSource(source)) return { status: "retired", source };
    const cause = await deps.pauseCause(source);
    if (cause !== null && refuses(caller, cause)) {
      return { status: "paused", source, cause };
    }
    const run = await deps.startRun(source);
    if (run.status === "busy") return { status: "busy", source };
    const workflow = await deps.startWorkflow(run.runId, source);
    return {
      status: "started",
      source,
      runId: run.runId,
      workflowRunId: workflow.runId,
      via: workflow.via,
    };
  },

  /** What to add after "Started run …" for a run the pass starts later. */
  startNote(started: Extract<ManualIngestionRunStart, { status: "started" }>) {
    switch (started.via) {
      case "workflow":
        return "";
      case "pass":
        return " The daily pass starts it once the rate-limited hosts it shares with other sources are free.";
      case "restarted_pass":
        return " The daily pass was running older code, so it was restarted on current code; it starts this run once the rate-limited hosts it shares with other sources are free.";
    }
  },

  /** Why no run started, in plain words for the owner and the API. */
  message(refusal: ManualIngestionRunRefusal): string {
    const name = INGESTION_SOURCE_DISPLAY_NAMES[refusal.source];
    switch (refusal.status) {
      case "retired":
        return `${name} is retired: its feed no longer reflects the yards' inventory, so it is not fetched and every ingestion run withdraws its published vehicles. No run was started.`;
      case "paused":
        return `${name} is ${pausedBy(refusal.cause, refusal.source)}`;
      case "busy":
        return `${name} already has a run in progress, so no second run was started. The current run keeps going; check its progress under Recent runs.`;
    }
  },
} as const;
