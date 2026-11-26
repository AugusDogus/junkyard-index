// Steps for the downstream consumers. Nothing here may import a search
// backend: downstream-consumers-search.test.ts checks this module graph.
import { deliverDurableAlertIntentsBatch } from "~/server/alerts/durable-alert-delivery-runtime";
import { db } from "~/lib/db";
import type { IndexNowSubmission } from "~/lib/indexnow";
import { INVENTORY_CACHE_TAG } from "~/lib/inventory-cache";
import { expireInventoryCaches } from "~/lib/inventory-cache-expiry";
import { env } from "~/env";
import {
  ConsumerFlags,
  type ConsumerMode,
  type DownstreamConsumer,
} from "~/server/ingestion/consumer-flags";
import type { MaintenanceTaskResult } from "~/server/ingestion/ingestion-maintenance";
import { IngestionMaintenanceTasks } from "~/server/ingestion/ingestion-maintenance-tasks";
import { IngestionSnapshotStore } from "~/server/ingestion/ingestion-snapshot-store";
import type { ConsumerTickOutcome } from "~/server/ingestion/consumer-heartbeats";
import type { ConsumerTickSummary } from "~/server/ingestion/consumer-report";
import { reportConsumerTickNow } from "~/server/ingestion/consumer-report-runtime";
import { InventoryCacheRefresh } from "~/server/ingestion/inventory-cache-refresh";
import { InventoryDownstream } from "~/server/ingestion/inventory-downstream";
import type {
  InventoryDownstreamDue,
  InventoryRefreshBackoff,
  InventoryRefreshFailure,
} from "~/server/ingestion/inventory-downstream-consumer";
import {
  announceInventoryPaths,
  warmChangedInventory,
} from "~/server/indexnow";
import { InventorySnapshot } from "~/server/inventory-snapshot";
import { YardSummaryStore } from "~/server/yard-summary-store";
import { formatError, throwRetryableStepError } from "./step-errors";

/**
 * Stores the inventory snapshot the homepage and inventory pages read, then
 * revalidates them, each only when behind the latest publication. Never
 * retried here: storing the snapshot reads every vehicle, so every failure,
 * thrown or returned, is one attempt that the consumer records and backs off
 * from (3 hours, doubling to a day).
 */
export async function refreshInventoryCachesStep(): Promise<
  { status: "ok" } | InventoryRefreshFailure
> {
  "use step";

  // Before the caches expire, so the pages they rebuild read each yard's
  // summary back (1 row) instead of its vehicles. Rebuilds the yards of
  // runs that ended without publishing too, whose caches the refresh
  // expires. A failure here only costs reads: until the next refresh,
  // pages whose cached slices disagree with the stored summary read the
  // yard.
  const now = new Date();
  try {
    const since = await InventoryCacheRefresh.changesReadAt(db);
    const { stored, changed } = await YardSummaryStore.refresh(
      db,
      now,
      since === null
        ? "all"
        : await InventoryCacheRefresh.unpublishedSources(db, since),
    );
    console.info(
      `[Workflow] Stored ${stored} yard summaries; ${changed.length} yards changed what their pages show`,
    );
  } catch (error) {
    console.error(
      `[Workflow] Could not store yard summaries; yard pages read each yard's vehicles when their cached summary is missing until the next refresh stores them. Vehicle data and the inventory refresh are unaffected: ${formatError(error)}`,
      error,
    );
  }

  let refresh: InventoryCacheRefresh;
  try {
    refresh = await InventoryCacheRefresh.run({
      database: db,
      source: {
        projectedThrough: () => InventorySnapshot.projectedThrough(db),
        // The live deployment's pass: versions before the previous one are
        // retired; the previous one stays for an instant rollback.
        project: () =>
          InventorySnapshot.project(db, new Date(), {
            olderVersions: "retire",
          }),
      },
      revalidate: expireInventoryCaches,
      now,
    });
  } catch (error) {
    // Not retried: a retry would read every vehicle again. The consumer
    // records the failure and backs off.
    const message = `Could not refresh the inventory caches; the homepage and inventory pages keep the previous inventory until the inventory-downstream consumer retries after its backoff: ${formatError(error)}`;
    console.error(`[Workflow] ${message}`, error);
    return { status: "failed", stage: "unexpected", message };
  }
  if (refresh.status !== "failed") return { status: "ok" };
  const message =
    refresh.stage === "project"
      ? `Could not store the inventory snapshot for publication ${refresh.publicationSequence}; the homepage and inventory pages keep the previous inventory until the inventory-downstream consumer retries after its backoff; vehicle data is unaffected: ${formatError(refresh.error)}`
      : `Could not revalidate the "${INVENTORY_CACHE_TAG}" cache tag for publication ${refresh.publicationSequence}; the snapshot is stored, and the homepage and inventory pages keep the previous inventory until the inventory-downstream consumer retries the revalidation after its backoff: ${formatError(refresh.error)}`;
  console.error(`[Workflow] ${message}`);
  return { status: "failed", stage: refresh.stage, message };
}
refreshInventoryCachesStep.maxRetries = 0;

/**
 * Whether the inventory-downstream consumer has a publication to refresh, as
 * of the cron route's check time, so the checkpoint is stamped with the time
 * the route's 3-hour gate compares against.
 */
export async function inventoryDownstreamDueStep(
  checkedAt: string,
): Promise<InventoryDownstreamDue> {
  "use step";

  try {
    return await InventoryDownstream.due(
      db,
      new Date(checkedAt),
      await ConsumerFlags.mode("inventory-downstream"),
    );
  } catch (error) {
    throwRetryableStepError("Check whether inventory-downstream is due", error);
  }
}
inventoryDownstreamDueStep.maxRetries = 2;

/** Advances the inventory-downstream checkpoint once its tick finished. */
export async function recordInventoryDownstreamStep(
  publicationSequence: number,
  checkedAt: string,
) {
  "use step";

  try {
    await InventoryDownstream.record(
      db,
      publicationSequence,
      new Date(checkedAt),
    );
  } catch (error) {
    throwRetryableStepError(
      `Record inventory-downstream through publication ${publicationSequence}`,
      error,
    );
  }
}
recordInventoryDownstreamStep.maxRetries = 2;

/** Records a failed refresh and blocks the consumer for its backoff. */
export async function recordInventoryDownstreamFailureStep(
  failure: InventoryRefreshFailure,
  checkedAt: string,
): Promise<InventoryRefreshBackoff> {
  "use step";

  try {
    return await InventoryDownstream.recordFailure(
      db,
      failure,
      new Date(checkedAt),
    );
  } catch (error) {
    throwRetryableStepError(
      "Record an inventory-downstream refresh failure",
      error,
    );
  }
}
recordInventoryDownstreamFailureStep.maxRetries = 2;

/** Reports a downstream consumer tick to Sentry and Better Stack. */
export async function reportConsumerTickStep(
  consumer: DownstreamConsumer,
  outcome: ConsumerTickOutcome,
  summary: ConsumerTickSummary,
) {
  "use step";

  await reportConsumerTickNow(consumer, outcome, summary);
}

/** Requests each changed page so it regenerates, and returns the pages. */
export async function warmInventoryAnnouncementStep(
  publicationSequence: number,
): Promise<string[]> {
  "use step";

  const { paths, warmed, failed } =
    await warmChangedInventory(publicationSequence);
  console.info("[Workflow] Requested changed inventory pages", {
    publicationSequence,
    pages: paths.length,
    warmed,
    failed,
  });
  return paths;
}
warmInventoryAnnouncementStep.maxRetries = 1;

/**
 * Tells IndexNow engines which pages changed. Not retried, so a submission is
 * never sent twice; a failure leaves the announcement checkpoint behind, and
 * the next publication's announcement includes these pages.
 */
export async function announceInventoryStep(
  publicationSequence: number,
  paths: string[],
): Promise<IndexNowSubmission["status"]> {
  "use step";

  const announcement = await announceInventoryPaths(publicationSequence, paths);
  if (announcement.status === "failed") {
    console.error(
      `[Workflow] IndexNow rejected ${announcement.urls} changed inventory URLs for publication ${publicationSequence} with HTTP ${announcement.httpStatus}; the next publication's announcement retries them, and the sitemaps still list them: ${announcement.detail}`,
    );
  } else {
    console.info("[Workflow] Announced changed inventory", {
      publicationSequence,
      ...announcement,
    });
  }
  return announcement.status;
}
announceInventoryStep.maxRetries = 0;

export async function consumerModeStep(
  consumer: DownstreamConsumer,
): Promise<ConsumerMode> {
  "use step";

  return ConsumerFlags.mode(consumer);
}

/** Prunes old ingestion runs; a failure is returned, not thrown. */
export async function pruneIngestionRunsStep(): Promise<MaintenanceTaskResult> {
  "use step";

  return IngestionMaintenanceTasks.pruneRuns(db, new Date());
}

/** Deletes Blob chunks of runs no longer active; failures are returned. */
export async function cleanupStaleSnapshotsStep(): Promise<MaintenanceTaskResult> {
  "use step";

  return IngestionMaintenanceTasks.staleSnapshots(
    db,
    IngestionSnapshotStore.vercelBlob(env.BLOB_READ_WRITE_TOKEN),
  );
}

/** Deletes outbox changes search no longer needs; failures are returned. */
export async function pruneSearchOutboxStep(): Promise<MaintenanceTaskResult> {
  "use step";

  return IngestionMaintenanceTasks.outboxRetention(db, new Date());
}

/** Purges old delivered or cancelled intents; failures are returned. */
export async function purgeTerminalIntentsStep(): Promise<MaintenanceTaskResult> {
  "use step";

  return IngestionMaintenanceTasks.terminalIntents(db, new Date());
}

export async function deliverVehicleSearchAlertIntentsStep() {
  "use step";

  try {
    return await deliverDurableAlertIntentsBatch();
  } catch (error) {
    throwRetryableStepError("Vehicle search alert delivery", error);
  }
}
deliverVehicleSearchAlertIntentsStep.maxRetries = 2;
