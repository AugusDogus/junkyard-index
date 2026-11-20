import { createHook, sleep } from "workflow";
import {
  inventoryDownstreamTickOutcome,
  runInventoryDownstream,
  type InventoryDownstreamResult,
} from "~/server/ingestion/inventory-downstream-consumer";
import {
  runIngestionMaintenance,
  summarizeIngestionMaintenance,
  type IngestionMaintenanceResult,
} from "~/server/ingestion/ingestion-maintenance";
import { IngestionTokens } from "./ingestion-tokens";
import {
  announceInventoryStep,
  cleanupStaleSnapshotsStep,
  consumerModeStep,
  deliverVehicleSearchAlertIntentsStep,
  pruneIngestionRunsStep,
  purgeTerminalIntentsStep,
  inventoryDownstreamDueStep,
  recordInventoryDownstreamFailureStep,
  recordInventoryDownstreamStep,
  refreshInventoryCachesStep,
  reportConsumerTickStep,
  warmInventoryAnnouncementStep,
} from "./downstream-steps";

// One live notification delivery workflow, shared with deployments that
// started it from vehicle-ingestion.ts, so old and new runs deduplicate.
const ALERT_DELIVERY_TOKEN = "vehicle-alert-delivery";
// Time for requested pages to finish regenerating in the background.
const PAGE_REGENERATION_DELAY = "2m";

/**
 * The inventory-downstream consumer: the hourly cron starts it when a Turso
 * publication is newer than its checkpoint and the last refresh is at least
 * 3 hours old. It refreshes the homepage snapshot and inventory caches, warms
 * the changed pages and announces them to IndexNow. It never depends on an
 * ingestion pass completing or on search.
 */
export async function inventoryDownstreamWorkflow(checkedAt: string) {
  "use workflow";

  using consumer = createHook({
    token: IngestionTokens.consumer("inventory-downstream"),
  });
  const activeConsumer = await consumer.getConflict();
  if (activeConsumer) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeConsumer.runId,
    };
  }
  let result: InventoryDownstreamResult;
  try {
    result = await runInventoryDownstream({
      // Re-check at the route's time, so the checkpoint is stamped with it.
      due: () => inventoryDownstreamDueStep(checkedAt),
      refresh: refreshInventoryCachesStep,
      warm: warmInventoryAnnouncementStep,
      waitForPages: () => sleep(PAGE_REGENERATION_DELAY),
      announce: announceInventoryStep,
      record: recordInventoryDownstreamStep,
      recordFailure: recordInventoryDownstreamFailureStep,
    });
  } catch (error) {
    await reportConsumerTickStep("inventory-downstream", "failed", {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await reportConsumerTickStep(
    "inventory-downstream",
    inventoryDownstreamTickOutcome(result),
    result,
  );
  return result;
}

/**
 * The daily ingestion-maintenance consumer: run pruning, stale Blob snapshot
 * chunks and old delivered or cancelled intents. Each task's result is
 * reported as a value; a failed task fails the tick's heartbeat, and
 * tomorrow's run retries what is left.
 */
export async function ingestionMaintenanceWorkflow() {
  "use workflow";

  using consumer = createHook({
    token: IngestionTokens.consumer("maintenance"),
  });
  const activeConsumer = await consumer.getConflict();
  if (activeConsumer) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeConsumer.runId,
    };
  }
  let result: IngestionMaintenanceResult;
  try {
    result = await runIngestionMaintenance({
      mode: () => consumerModeStep("maintenance"),
      pruneRuns: pruneIngestionRunsStep,
      staleSnapshots: cleanupStaleSnapshotsStep,
      terminalIntents: purgeTerminalIntentsStep,
    });
  } catch (error) {
    await reportConsumerTickStep("maintenance", "failed", {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  await reportConsumerTickStep(
    "maintenance",
    result.status === "completed" && result.failed ? "failed" : "succeeded",
    summarizeIngestionMaintenance(result),
  );
  return result;
}

/**
 * Sends deliverable saved-search notifications, one recipient group per step,
 * until none is left. Started by the notification-delivery cron, the daily
 * alert check and the alert deadline cron. Each batch rechecks the
 * fail-closed search-alerts-enabled flag.
 */
export async function vehicleNotificationDeliveryWorkflow() {
  "use workflow";

  using alertDelivery = createHook({ token: ALERT_DELIVERY_TOKEN });
  const activeDelivery = await alertDelivery.getConflict();
  if (activeDelivery) {
    return {
      status: "deduplicated" as const,
      activeRunId: activeDelivery.runId,
    };
  }
  let intentsProcessed = 0;
  while (true) {
    const batch = await deliverVehicleSearchAlertIntentsStep();
    intentsProcessed += batch.intentsProcessed;
    if (batch.status === "complete") {
      return { status: "completed" as const, intentsProcessed };
    }
  }
}
