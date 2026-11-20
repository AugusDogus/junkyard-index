// Steps for the downstream consumers. Nothing here may import a search
// backend: downstream-consumers-search.test.ts checks this module graph.
import { revalidateTag } from "next/cache";
import { db } from "~/lib/db";
import type { IndexNowSubmission } from "~/lib/indexnow";
import { INVENTORY_CACHE_TAG } from "~/lib/inventory-cache";
import {
  ConsumerFlags,
  type DownstreamConsumer,
} from "~/server/ingestion/consumer-flags";
import type { ConsumerTickOutcome } from "~/server/ingestion/consumer-heartbeats";
import type { ConsumerTickSummary } from "~/server/ingestion/consumer-report";
import { reportConsumerTickNow } from "~/server/ingestion/consumer-report-runtime";
import { InventoryCacheRefresh } from "~/server/ingestion/inventory-cache-refresh";
import { InventoryDownstream } from "~/server/ingestion/inventory-downstream";
import type {
  InventoryDownstreamDue,
  InventoryRefreshFailure,
} from "~/server/ingestion/inventory-downstream-consumer";
import {
  announceInventoryPaths,
  warmChangedInventory,
} from "~/server/indexnow";
import { InventorySnapshot } from "~/server/inventory-snapshot";
import { formatError, throwRetryableStepError } from "./step-errors";

/**
 * Stores the inventory snapshot the homepage and inventory pages read, then
 * revalidates them, each only when behind the latest publication. Not
 * retried on a failed refresh: storing the snapshot reads every vehicle, so a
 * failure costs one attempt per consumer tick. The consumer's checkpoint
 * stays behind, so its next tick retries.
 */
export async function refreshInventoryCachesStep(): Promise<
  { status: "ok" } | InventoryRefreshFailure
> {
  "use step";

  let refresh: InventoryCacheRefresh;
  try {
    refresh = await InventoryCacheRefresh.run({
      database: db,
      source: {
        projectedThrough: () => InventorySnapshot.projectedThrough(db),
        project: () => InventorySnapshot.project(db, new Date()),
      },
      revalidate: () => revalidateTag(INVENTORY_CACHE_TAG, "max"),
    });
  } catch (error) {
    throwRetryableStepError("Refresh the inventory caches", error);
  }
  if (refresh.status !== "failed") return { status: "ok" };
  const message =
    refresh.stage === "project"
      ? `Could not store the inventory snapshot for publication ${refresh.publicationSequence}; the homepage and inventory pages keep the previous inventory until the inventory-downstream consumer's next tick retries; vehicle data is unaffected: ${formatError(refresh.error)}`
      : `Could not revalidate the "${INVENTORY_CACHE_TAG}" cache tag for publication ${refresh.publicationSequence}; the snapshot is stored, and the homepage and inventory pages keep the previous inventory until the inventory-downstream consumer's next tick retries the revalidation: ${formatError(refresh.error)}`;
  console.error(`[Workflow] ${message}`);
  return { status: "failed", stage: refresh.stage, message };
}
refreshInventoryCachesStep.maxRetries = 2;

/** Whether the inventory-downstream consumer has a publication to refresh. */
export async function inventoryDownstreamDueStep(): Promise<InventoryDownstreamDue> {
  "use step";

  try {
    return await InventoryDownstream.due(
      db,
      new Date(),
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
