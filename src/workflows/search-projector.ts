import { createHook } from "workflow";
import {
  runSearchProjector,
  searchProjectorTickNotifies,
  searchProjectorTickOutcome,
  summarizeSearchProjectorTick,
  type SearchProjectorRun,
} from "~/server/ingestion/search-projector-consumer";
import { IngestionTokens } from "./ingestion-tokens";
import {
  reportSearchProjectorTickStep,
  searchProjectorStep,
} from "./search-projector-steps";

// Each step runs for at most about 3 minutes; a run that is still behind
// after this many ends, and the next cron tick starts a fresh one.
const MAX_STEPS_PER_RUN = 40;

/**
 * The singleton search projector: the only search writer once publication
 * is decoupled. Started every 10 minutes by its cron when it has work, at the
 * end of each decoupled source run, and by the admin route. It projects the
 * `vehicle_change_v2` outbox to the live index until it reaches the horizon
 * or fails, then reports its tick. The search-index migration takes the same
 * token while it writes, so the two never write at once.
 */
export async function searchProjectorWorkflow() {
  "use workflow";

  using projector = createHook({ token: IngestionTokens.searchProjector });
  const activeProjector = await projector.getConflict();
  if (activeProjector) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeProjector.runId,
    };
  }
  let run: SearchProjectorRun;
  try {
    run = await runSearchProjector({
      step: searchProjectorStep,
      maxSteps: MAX_STEPS_PER_RUN,
      progress: (progress) =>
        reportSearchProjectorTickStep(
          "succeeded",
          {
            ...summarizeSearchProjectorTick(progress.last),
            steps: progress.steps,
            changesProjected: progress.changes,
          },
          false,
        ),
    });
  } catch (error) {
    await reportSearchProjectorTickStep(
      "failed",
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      true,
    );
    throw error;
  }
  await reportSearchProjectorTickStep(
    searchProjectorTickOutcome(run.last),
    {
      ...summarizeSearchProjectorTick(run.last),
      steps: run.steps,
      changesProjected: run.changes,
    },
    searchProjectorTickNotifies(run.last),
  );
  return run;
}
