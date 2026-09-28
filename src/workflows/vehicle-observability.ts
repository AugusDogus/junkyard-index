import * as Sentry from "@sentry/nextjs";
import type { DurableSourceValidationSummary } from "~/server/ingestion/durable-source-validation";

const SOURCE_REJECTION_CATEGORY = "vehicle-ingestion-source-rejected";
const RUN_FAILURE_CATEGORY = "vehicle-ingestion-run-failed";

export async function recordDurableSourceRejections(params: {
  runId: string;
  validate: () => Promise<DurableSourceValidationSummary>;
  captureMessage?: typeof Sentry.captureMessage;
}): Promise<DurableSourceValidationSummary> {
  const result = await params.validate();
  if (result.status === "stopped") return result;

  const captureMessage = params.captureMessage ?? Sentry.captureMessage;
  for (const rejection of result.rejectedSources) {
    try {
      captureMessage(`${rejection.source} ingestion rejected`, {
        level: "error",
        fingerprint: [SOURCE_REJECTION_CATEGORY, rejection.source],
        tags: {
          failure_category: SOURCE_REJECTION_CATEGORY,
          ingestion_source: rejection.source,
          workflow: "vehicle-ingestion",
        },
        extra: { runId: params.runId, errors: rejection.errors },
      });
    } catch (error) {
      console.error(
        `Failed to report ingestion rejection for ${rejection.source}`,
        error,
      );
    }
  }
  return result;
}

export async function recordDurableRunFailure(params: {
  runId: string;
  message: string;
  markFailed: () => Promise<void>;
  captureMessage?: typeof Sentry.captureMessage;
}): Promise<void> {
  await params.markFailed();
  try {
    (params.captureMessage ?? Sentry.captureMessage)(params.message, {
      level: "error",
      tags: {
        failure_category: RUN_FAILURE_CATEGORY,
        workflow: "vehicle-ingestion",
      },
      extra: { runId: params.runId },
    });
  } catch (error) {
    console.error(`Failed to report ingestion run ${params.runId}`, error);
  }
}
