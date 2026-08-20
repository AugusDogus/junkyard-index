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
    captureException: typeof Sentry.captureException = Sentry.captureException,
  ): string {
    return captureException(
      new Error(`Vehicle ingestion source ${failure.source} failed`),
      {
        level: "error",
        fingerprint: [failure.category, failure.source],
        tags: {
          failure_category: failure.category,
          ingestion_source: failure.source,
          workflow: "vehicle-ingestion",
        },
        extra: {
          failureMessage: failure.message,
          runId: failure.runId,
        },
      },
    );
  },
} as const;

export async function recordDurableSourceFailure<Result>(params: {
  failure: DurableSourceFailure;
  markFailed: () => Promise<Result>;
  captureException?: typeof Sentry.captureException;
}): Promise<Result> {
  const result = await params.markFailed();
  DurableSourceFailure.capture(params.failure, params.captureException);
  return result;
}
