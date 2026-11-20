import * as Sentry from "@sentry/nextjs";
import type { DurableSourceCursor } from "~/server/ingestion/durable-source";
import type { DurableSourceValidationSummary } from "~/server/ingestion/durable-source-validation";

const SOURCE_REJECTION_CATEGORY = "vehicle-ingestion-source-rejected";
const RUN_FAILURE_CATEGORY = "vehicle-ingestion-run-failed";
const URGIIS_TENANT_BLOCKED_CATEGORY =
  "vehicle-ingestion-urgiis-tenant-blocked";

/** A blocked URG IIS tenant publishes nothing while the rest of the source
 * does, so its yards keep their previous inventory unrefreshed. Report each
 * tenant a chunk newly blocks; the source itself is not rejected for it. */
export function recordUrgiisBlockedTenant(params: {
  runId: string;
  before: DurableSourceCursor;
  after: DurableSourceCursor;
  captureMessage?: typeof Sentry.captureMessage;
}): void {
  const { before, after } = params;
  if (
    before.source !== "urgiis" ||
    after.source !== "urgiis" ||
    after.completed.length !== before.completed.length + 1
  )
    return;
  const done = after.completed.at(-1);
  if (!done || !("blocked" in done)) return;
  try {
    (params.captureMessage ?? Sentry.captureMessage)(
      `urgiis tenant ${done.code} blocked; its yards keep their previous inventory`,
      {
        level: "warning",
        fingerprint: [URGIIS_TENANT_BLOCKED_CATEGORY, done.code],
        tags: {
          failure_category: URGIIS_TENANT_BLOCKED_CATEGORY,
          ingestion_source: "urgiis",
          urgiis_tenant: done.code,
          workflow: "vehicle-ingestion",
        },
        extra: { runId: params.runId, reason: done.blocked },
      },
    );
  } catch (error) {
    console.error(
      `Failed to report blocked URG IIS tenant ${done.code}`,
      error,
    );
  }
}

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
