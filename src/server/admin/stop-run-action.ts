import { z } from "zod";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  isIngestionSource,
  type IngestionSource,
} from "~/lib/ingestion-source";
import type { DurableIngestionAbandonment } from "~/server/ingestion/durable-ingestion";
import {
  ManualIngestionRun,
  type ManualIngestionRunStart,
} from "~/server/ingestion/manual-ingestion-run";
import { RunAbandonment } from "~/server/ingestion/run-abandonment";
import type { SourceControlResult } from "~/server/source-control/source-control-action";

/**
 * What the stop control sends. `force` confirms a full search rebuild: the
 * control sends true only after the admin confirms it for a run past its
 * crawl. `stop_and_run` then starts a fresh run of the same source.
 */
const inputSchema = z.object({
  kind: z.enum(["stop", "stop_and_run"]),
  runId: z.string().trim().min(1, "Name the run to stop."),
  force: z.boolean(),
});

export type StopRunInput = z.infer<typeof inputSchema>;

/** The run as the action reads it before stopping it. */
export type StopRunRecord = {
  runId: string;
  /** A source key, or "all" for a run across every source. */
  source: string;
  status: string;
  stage: string;
};

export type StopRunActionDependencies = {
  readRun: (runId: string) => Promise<StopRunRecord | null>;
  /** abandonDurableIngestion, as the cron-secret abandon route calls it. */
  abandon: (params: {
    runId: string;
    force: boolean;
  }) => Promise<DurableIngestionAbandonment>;
  logStop: (input: {
    source: string;
    userId: string;
    runId: string;
    workflowRunId: string | null;
    stage: string;
    fullRebuild: boolean;
    now: Date;
  }) => Promise<void>;
  startRun: (source: IngestionSource) => Promise<ManualIngestionRunStart>;
  logRun: (input: {
    source: IngestionSource;
    userId: string;
    runId: string;
    workflowRunId: string;
    now: Date;
  }) => Promise<void>;
};

function sourceName(source: string): string {
  return isIngestionSource(source)
    ? INGESTION_SOURCE_DISPLAY_NAMES[source]
    : "Every source";
}

type Abandoned = Extract<DurableIngestionAbandonment, { status: "abandoned" }>;

function cancellationSentence(abandonment: Abandoned): string {
  const workflowRunId = abandonment.abandoned.workflowRunId;
  switch (abandonment.workflowCancellation) {
    case "cancelled":
      return "Its workflow was cancelled, and runs queued behind it can go ahead.";
    case "not_attached":
      return "It had no workflow to cancel. Runs queued behind it can go ahead.";
    case "failed":
      return `Its workflow ${workflowRunId ?? "(unknown)"} could not be cancelled; cancel it in the Vercel dashboard if it still runs. The run is stopped either way, so runs queued behind it can go ahead.`;
  }
}

async function startAgain(
  deps: StopRunActionDependencies,
  userId: string,
  source: IngestionSource,
  stopped: string,
  now: Date,
): Promise<SourceControlResult> {
  let started: ManualIngestionRunStart;
  try {
    started = await deps.startRun(source);
  } catch (error) {
    console.error(
      `Admin stop and run again of ${source} stopped its run, but starting a new run failed`,
      error,
    );
    return {
      status: "failed",
      message: `${stopped} Starting a new run failed. If a new run appears under Recent runs, it was recorded but its workflow may not have started; otherwise use Run now in a minute. The details below say why.`,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  if (started.status !== "started") {
    return {
      status: "done",
      message: `${stopped} ${ManualIngestionRun.message(started)}`,
    };
  }
  const message = `${stopped} Started run ${started.runId} on current code. It appears under Recent runs within a minute.`;
  try {
    await deps.logRun({
      source,
      userId,
      runId: started.runId,
      workflowRunId: started.workflowRunId,
      now,
    });
  } catch (error) {
    console.error(
      `Admin stop and run again of ${source} started run ${started.runId} (workflow ${started.workflowRunId}) but could not log it`,
      error,
    );
    return {
      status: "done",
      message: `${message} The new run was not added to the recent actions, because writing the log failed.`,
    };
  }
  return { status: "done", message };
}

/**
 * Stops (abandons) an active ingestion run from /admin, with the semantics
 * of the cron-secret abandon route: the run is abandoned, its workflow
 * cancelled and its slots freed, and a run past its crawl makes the next run
 * rebuild search in full. Every outcome comes back as a value.
 */
export const StopRunAction = {
  async perform(
    deps: StopRunActionDependencies,
    userId: string,
    rawInput: unknown,
    now: Date,
  ): Promise<SourceControlResult> {
    const parsed = inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        status: "invalid",
        message: `Nothing was stopped: ${parsed.error.issues[0]?.message ?? "the request was not understood"}`,
      };
    }
    const { kind, runId, force } = parsed.data;
    let run: StopRunRecord | null;
    try {
      run = await deps.readRun(runId);
    } catch (error) {
      console.error(`Admin stop of run ${runId} could not read the run`, error);
      return {
        status: "failed",
        message: `Could not read run ${runId}, so nothing was stopped. Try again in a minute; if it keeps failing, the details below say why.`,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (run === null) {
      return {
        status: "refused",
        message: `No ingestion run ${runId} exists, so nothing was stopped. Reload the page to see the current runs.`,
      };
    }
    const label = `${sourceName(run.source)}'s run ${runId}`;
    if (run.status !== "running") {
      return {
        status: "unchanged",
        message: `${label} already ended (${run.status}), so nothing was stopped.`,
      };
    }
    const source = isIngestionSource(run.source) ? run.source : null;
    if (kind === "stop_and_run" && source === null) {
      return {
        status: "refused",
        message: `${label} covers every source, so it cannot be run again from here. Nothing was stopped; use Stop this run instead.`,
      };
    }
    const check = RunAbandonment.check({ runId, stage: run.stage, force });
    switch (check.status) {
      case "move_pending":
        return { status: "refused", message: check.message };
      case "force_required":
        return {
          status: "refused",
          message: `${label} is at the ${run.stage} stage, so stopping it means a full search rebuild. Nothing was stopped. Reload the page and confirm the rebuild to stop it.`,
        };
      case "allowed":
        break;
    }

    let result: DurableIngestionAbandonment;
    try {
      result = await deps.abandon({ runId, force });
    } catch (error) {
      console.error(`Admin stop of ${label} failed`, error);
      return {
        status: "failed",
        message: `Could not stop ${label}. Reload the page: if it still shows as running, nothing was stopped. Try again in a minute; if it keeps failing, the details below say why.`,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    // It ended (or another admin stopped it) after it was read above.
    if (result.status === "already_ended") {
      return {
        status: "unchanged",
        message: `${label} already ended (${result.runStatus}), so nothing was stopped.`,
      };
    }
    const abandonment = result;

    const parts = [
      `Stopped ${label}.`,
      cancellationSentence(abandonment),
      "Vehicles it already published stay.",
      check.fullRebuild
        ? "It had started writing, so a full search rebuild runs next."
        : null,
      kind === "stop"
        ? "Its next scheduled retry is started by today's ingestion pass, which runs the code that pass started on and may be this same old code. Use Run now to restart it on current code."
        : null,
    ];
    try {
      await deps.logStop({
        source: run.source,
        userId,
        runId,
        workflowRunId: abandonment.abandoned.workflowRunId,
        stage: run.stage,
        fullRebuild: check.fullRebuild,
        now,
      });
    } catch (error) {
      console.error(
        `Admin stop of ${label} succeeded but could not be logged`,
        error,
      );
      parts.push(
        "It was not added to the recent actions, because writing the log failed.",
      );
    }
    const stopped = parts.filter((part) => part !== null).join(" ");
    if (kind === "stop" || source === null) {
      return { status: "done", message: stopped };
    }
    return startAgain(deps, userId, source, stopped, now);
  },
} as const;
