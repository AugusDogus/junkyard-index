import * as Sentry from "@sentry/nextjs";
import type { DurableIngestionSource } from "~/server/ingestion/durable-source";

const SOURCE_FAILURE_CATEGORY = "vehicle-ingestion-source-failed";

export type DurableSourceFailure = {
  category: typeof SOURCE_FAILURE_CATEGORY;
  runId: string;
  source: DurableIngestionSource;
  message: string;
};

export const DurableSourceFailure = {
  make(params: {
    runId: string;
    source: DurableIngestionSource;
    message: string;
  }): DurableSourceFailure {
    return { category: SOURCE_FAILURE_CATEGORY, ...params };
  },

  capture(
    failure: DurableSourceFailure,
    captureMessage: typeof Sentry.captureMessage = Sentry.captureMessage,
  ): string {
    return captureMessage(failure.message, {
      level: "error",
      tags: {
        failure_category: failure.category,
        ingestion_source: failure.source,
        workflow: "vehicle-ingestion",
      },
      extra: { runId: failure.runId },
    });
  },
} as const;

export async function recordDurableSourceFailure<Result>(params: {
  failure: DurableSourceFailure;
  markFailed: () => Promise<Result>;
  captureMessage?: typeof Sentry.captureMessage;
}): Promise<Result> {
  const result = await params.markFailed();
  DurableSourceFailure.capture(params.failure, params.captureMessage);
  return result;
}
