import { z } from "zod";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  INGESTION_SOURCES,
  type IngestionSource,
} from "~/lib/ingestion-source";
import {
  ManualIngestionRun,
  type ManualIngestionRunStart,
} from "~/server/ingestion/manual-ingestion-run";
import type {
  PauseCause,
  SourceControlApplied,
  SourceControlChange,
} from "./source-control";

/** The longest hide reason the form accepts. */
export const HIDE_REASON_MAX_LENGTH = 500;

const source = z.enum(INGESTION_SOURCES);

/** What the /admin source controls send, checked before anything runs. */
const inputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pause"), source }),
  z.object({ kind: z.literal("resume"), source }),
  z.object({
    kind: z.literal("hide"),
    source,
    reason: z
      .string()
      .trim()
      .min(1, "Say why the source is hidden.")
      .max(
        HIDE_REASON_MAX_LENGTH,
        `Keep the reason under ${HIDE_REASON_MAX_LENGTH} characters.`,
      ),
  }),
  z.object({ kind: z.literal("show"), source }),
  z.object({ kind: z.literal("run"), source }),
]);

export type SourceControlInput = z.infer<typeof inputSchema>;

/**
 * The outcome shown beside the controls. Invalid input and refusals change
 * nothing; failed carries the raw error text for the details toggle.
 */
export type SourceControlResult =
  | { status: "done"; message: string }
  | { status: "unchanged"; message: string }
  | { status: "refused"; message: string }
  | { status: "invalid"; message: string }
  | { status: "failed"; message: string; detail: string };

export type SourceControlActionDependencies = {
  apply: (input: {
    source: IngestionSource;
    change: SourceControlChange;
    userId: string;
    now: Date;
  }) => Promise<SourceControlApplied>;
  pauseCause: (source: IngestionSource) => Promise<PauseCause | null>;
  startRun: (source: IngestionSource) => Promise<ManualIngestionRunStart>;
  logRun: (input: {
    source: IngestionSource;
    userId: string;
    runId: string;
    workflowRunId: string;
    now: Date;
  }) => Promise<void>;
  /** Expires the cached hidden list and the pages built from it. */
  expireHiddenSources: () => void;
};

const VERB: Record<SourceControlInput["kind"], string> = {
  pause: "pause",
  resume: "resume",
  hide: "hide",
  show: "show",
  run: "start a run of",
};

const HIDE_DELAY =
  "Pages and new searches change at once; a search page someone already has open changes within 15 minutes, and make totals on /cars at the next inventory update.";

function changeMessage(
  input: Exclude<SourceControlInput, { kind: "run" }>,
  name: string,
  applied: SourceControlApplied,
  stillPausedBy: PauseCause | null,
): SourceControlResult {
  if (applied.status === "unchanged") {
    const state = {
      pause: "already paused here",
      resume: "already running here",
      hide: "already hidden with that reason",
      show: "already shown",
    }[input.kind];
    return { status: "unchanged", message: `${name} was ${state}.` };
  }
  switch (input.kind) {
    case "pause":
      return {
        status: "done",
        message: `Paused. Daily and manual runs skip ${name} until you resume it. A run already in progress finishes.`,
      };
    case "resume":
      return {
        status: "done",
        message:
          stillPausedBy === "flag"
            ? `Resumed here, but its Vercel flag still pauses ${name}. Turn the flag on to run it again.`
            : `Resumed. ${name} runs again from the next daily pass, or use Run now.`,
      };
    case "hide":
      return {
        status: "done",
        message: `Hidden. ${name} leaves the public site; it keeps updating in the background. ${HIDE_DELAY}`,
      };
    case "show":
      return {
        status: "done",
        message: `Shown again. ${name} returns to the public site. ${HIDE_DELAY}`,
      };
  }
}

async function run(
  deps: SourceControlActionDependencies,
  userId: string,
  source: IngestionSource,
  now: Date,
): Promise<SourceControlResult> {
  const started = await deps.startRun(source);
  if (started.status !== "started") {
    return { status: "refused", message: ManualIngestionRun.message(started) };
  }
  const message = `Started run ${started.runId}. It appears under Recent runs within a minute; reload the page to follow it.`;
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
      `Admin run of ${source} started run ${started.runId} (workflow ${started.workflowRunId}) but could not be logged`,
      error,
    );
    return {
      status: "done",
      message: `${message} It was not added to the recent actions below, because writing the log failed.`,
    };
  }
  return { status: "done", message };
}

export const SourceControlAction = {
  /**
   * Validates and performs one control for an admin the caller has already
   * checked with requireAdmin. Every outcome, failures included, comes back
   * as a value.
   */
  async perform(
    deps: SourceControlActionDependencies,
    userId: string,
    rawInput: unknown,
    now: Date,
  ): Promise<SourceControlResult> {
    const parsed = inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        status: "invalid",
        message: `Nothing was changed: ${parsed.error.issues[0]?.message ?? "the request was not understood"}`,
      };
    }
    const input = parsed.data;
    const name = INGESTION_SOURCE_DISPLAY_NAMES[input.source];
    try {
      if (input.kind === "run")
        return await run(deps, userId, input.source, now);
      const applied = await deps.apply({
        source: input.source,
        change:
          input.kind === "hide"
            ? { kind: "hide", reason: input.reason }
            : { kind: input.kind },
        userId,
        now,
      });
      if (
        applied.status === "changed" &&
        (input.kind === "hide" || input.kind === "show")
      )
        deps.expireHiddenSources();
      const stillPausedBy =
        input.kind === "resume" && applied.status === "changed"
          ? await deps.pauseCause(input.source)
          : null;
      return changeMessage(input, name, applied, stillPausedBy);
    } catch (error) {
      console.error(
        `Admin control "${input.kind}" on ${input.source} failed`,
        error,
      );
      // A run can fail after its row was written, when its workflow did not
      // start, so only a control change is known to have changed nothing.
      const outcome =
        input.kind === "run"
          ? "If a new run appears under Recent runs, it was recorded but its workflow may not have started."
          : "Nothing was changed.";
      return {
        status: "failed",
        message: `Could not ${VERB[input.kind]} ${name}. ${outcome} Try again in a minute; if it keeps failing, the details below say why.`,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  },
} as const;
