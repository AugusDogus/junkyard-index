// Steps of the search projector workflow. Unlike downstream-steps.ts, these
// may load the search backend: the projector is the search writer.
import type { ConsumerTickOutcome } from "~/server/ingestion/consumer-heartbeats";
import type { ConsumerTickSummary } from "~/server/ingestion/consumer-report";
import { reportConsumerTickNow } from "~/server/ingestion/consumer-report-runtime";
import type { SearchProjectorTick } from "~/server/ingestion/search-projector-consumer";
import { runSearchProjectorTick } from "~/server/ingestion/search-projector-runtime";
import { throwRetryableStepError } from "./step-errors";

/**
 * One projector step. Search failures come back as values (the projector
 * records them and backs off); only a database or unexpected failure throws
 * and is retried, and every retry redoes idempotent writes from the
 * checkpoint.
 */
export async function searchProjectorStep(): Promise<SearchProjectorTick> {
  "use step";

  try {
    const tick = await runSearchProjectorTick();
    console.info("[Workflow] Search projector step", tick);
    return tick;
  } catch (error) {
    throwRetryableStepError("Search projector step", error);
  }
}
searchProjectorStep.maxRetries = 2;

export async function reportSearchProjectorTickStep(
  outcome: ConsumerTickOutcome,
  summary: ConsumerTickSummary,
  notify: boolean,
) {
  "use step";

  await reportConsumerTickNow("search-projector", outcome, summary, {
    notify,
  });
}
